import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberStatus, Role } from "@/types";

/**
 * GET /api/agency/readiness
 *
 * Owner-gated production-readiness snapshot. Combines server-only env-flag
 * presence (never the secret values) with point-in-time data checks (products,
 * purchases, commissions) into a single checklist the cockpit renders.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Auth → active → agencyRole === "owner". Data reads scoped to caller's agency.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 * Returns booleans only for secrets (set / not set, test vs live prefix).
 * Never returns key material.
 *
 * ── Not auto-detectable ───────────────────────────────────────────────────────
 * Firestore rules-deployed and indexes-deployed cannot be reliably detected from
 * app code, so they are returned as "info" items the owner confirms manually.
 *
 * No checkout/Stripe activation, no commission math, no MLM logic.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

type Severity = "ok" | "warn" | "blocked" | "info";

interface ChecklistItem {
  key: string;
  label: string;
  severity: Severity;
  detail: string;
}

export async function GET(request: Request) {
  // Auth + role
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json({ error: "Agency owner access required." }, { status: 403 });
  }
  const agencyId = claims.agencyId;

  // ── Env flags (presence only) ──────────────────────────────────────────────
  const isProd = process.env.NODE_ENV === "production";
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const stripeKeySet = stripeKey.length > 0;
  const stripeTestMode = stripeKey.startsWith("sk_test_");
  const webhookSecretSet = (process.env.STRIPE_WEBHOOK_SECRET ?? "").length > 0;
  const checkoutEnabled = process.env.MARKETPLACE_CHECKOUT_ENABLED === "true";
  const commissionsEnabled = process.env.PARTNER_COMMISSIONS_ENABLED === "true";
  const byokSecretSet = (process.env.BYOK_KEY_ENCRYPTION_SECRET ?? "").length > 0;

  // ── Data checks (point-in-time) ────────────────────────────────────────────
  const db = getAdminDb();

  const productsSnap = await db
    .collection("products")
    .where("agencyId", "==", agencyId)
    .get()
    .catch(() => null);

  const products = (productsSnap?.docs ?? []).map((d) => ({
    id: d.id,
    ...(d.data() as {
      name?: string;
      status?: string;
      isPublic?: boolean;
      accessModel?: string;
      stripePriceIdMonthly?: string | null;
      stripePriceIdAnnual?: string | null;
    }),
  }));

  const subscriptionProducts = products.filter((p) => p.accessModel === "subscription");
  const missingPrices = subscriptionProducts.filter(
    (p) => p.status !== "archived" && !p.stripePriceIdMonthly && !p.stripePriceIdAnnual,
  );
  const activePublic = products.filter((p) => p.status === "active" && p.isPublic);

  // CRM Pro guard: any product whose name matches /crm pro/i
  const crmPro = products.find((p) => /crm\s*pro/i.test(p.name ?? ""));
  const crmProRisky =
    crmPro &&
    crmPro.status === "active" &&
    crmPro.isPublic &&
    !crmPro.stripePriceIdMonthly &&
    !crmPro.stripePriceIdAnnual;

  const purchasesSnap = await db
    .collection("marketplace_purchases")
    .where("agencyId", "==", agencyId)
    .get()
    .catch(() => null);
  const paidMissingFulfillment = (purchasesSnap?.docs ?? []).filter((d) => {
    const data = d.data() as { paymentStatus?: string; fulfilledAt?: unknown };
    return data.paymentStatus === "paid" && !data.fulfilledAt;
  }).length;

  const pendingCommSnap = await db
    .collection("commission_events")
    .where("agencyId", "==", agencyId)
    .where("status", "==", "pending")
    .get()
    .catch(() => null);
  const pendingCommissions = pendingCommSnap?.size ?? 0;

  // ── Build checklist ────────────────────────────────────────────────────────
  const checklist: ChecklistItem[] = [
    {
      key: "firestore_rules",
      label: "Firestore rules deployed",
      severity: "info",
      detail: "Run: firebase deploy --only firestore:rules (not auto-detectable — confirm manually).",
    },
    {
      key: "firestore_indexes",
      label: "Firestore indexes deployed",
      severity: "info",
      detail: "Run: firebase deploy --only firestore:indexes (not auto-detectable — confirm manually).",
    },
    {
      key: "stripe_keys",
      label: "Stripe secret key set",
      severity: stripeKeySet ? (stripeTestMode ? "ok" : "warn") : "warn",
      detail: !stripeKeySet
        ? "STRIPE_SECRET_KEY is not set."
        : stripeTestMode
          ? "Test-mode key (sk_test_) configured."
          : "LIVE-mode key detected — do not use until live launch is approved.",
    },
    {
      key: "webhook_secret",
      label: "Stripe webhook secret set",
      severity: webhookSecretSet ? "ok" : "warn",
      detail: webhookSecretSet
        ? "STRIPE_WEBHOOK_SECRET configured."
        : "STRIPE_WEBHOOK_SECRET not set — webhook fulfillment will not run.",
    },
    {
      key: "checkout_flag",
      label: "Marketplace checkout flag (production)",
      severity: isProd && checkoutEnabled ? "blocked" : "ok",
      detail: isProd
        ? checkoutEnabled
          ? "MARKETPLACE_CHECKOUT_ENABLED=true in PRODUCTION — live checkout is open."
          : "Off in production (correct until launch approved)."
        : `Dev/test env. Flag is ${checkoutEnabled ? "ON (test checkout enabled)" : "OFF"}.`,
    },
    {
      key: "commissions_flag",
      label: "Partner commissions flag (production)",
      severity: isProd && commissionsEnabled ? "blocked" : "ok",
      detail: isProd
        ? commissionsEnabled
          ? "PARTNER_COMMISSIONS_ENABLED=true in PRODUCTION — commission events will be created."
          : "Off in production (correct until approved)."
        : `Dev/test env. Flag is ${commissionsEnabled ? "ON" : "OFF"}.`,
    },
    {
      key: "byok_secret",
      label: "BYOK encryption secret configured",
      severity: byokSecretSet ? "ok" : "warn",
      detail: byokSecretSet
        ? "BYOK_KEY_ENCRYPTION_SECRET configured."
        : "Not set — BYOK key saves will return a 500 config error until set.",
    },
    {
      key: "crm_pro",
      label: "CRM Pro draft/hidden unless prices set",
      severity: crmProRisky ? "blocked" : "ok",
      detail: !crmPro
        ? "No 'CRM Pro' product found."
        : crmProRisky
          ? `CRM Pro ("${crmPro.name}") is active + public with NO Stripe price IDs.`
          : `CRM Pro ("${crmPro.name}") is safe (status=${crmPro.status}, public=${crmPro.isPublic}).`,
    },
    {
      key: "missing_prices",
      label: "Subscription products with Stripe price IDs",
      severity: missingPrices.length > 0 ? "warn" : "ok",
      detail:
        missingPrices.length > 0
          ? `${missingPrices.length} active subscription product(s) missing price IDs: ${missingPrices.map((p) => p.name ?? p.id).join(", ")}`
          : "All active subscription products have at least one price ID.",
    },
    {
      key: "active_public",
      label: "Active + public products",
      severity: "info",
      detail: `${activePublic.length} product(s) are active and public in the marketplace.`,
    },
    {
      key: "paid_unfulfilled",
      label: "Paid purchases missing fulfillment",
      severity: paidMissingFulfillment > 0 ? "warn" : "ok",
      detail:
        paidMissingFulfillment > 0
          ? `${paidMissingFulfillment} paid purchase(s) have no entitlement — use Repair Fulfillment.`
          : "No paid purchases are missing fulfillment.",
    },
    {
      key: "pending_commissions",
      label: "Pending commissions on hold",
      severity: "info",
      detail: `${pendingCommissions} commission event(s) in pending status.`,
    },
  ];

  const blockers = checklist.filter((c) => c.severity === "blocked").length;
  const warnings = checklist.filter((c) => c.severity === "warn").length;

  return NextResponse.json({
    ok: true,
    env: { isProd },
    summary: { blockers, warnings, total: checklist.length },
    checklist,
  });
}
