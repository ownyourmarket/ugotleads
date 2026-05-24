import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { isHeroVariantId } from "@/lib/hero-variants";

export const dynamic = "force-dynamic";

const DOC_PATH = "appConfig/landingMetrics";
const ALLOWED_EVENTS = new Set(["pageView", "ctaClick"] as const);
type LandingEvent = "pageView" | "ctaClick";

/**
 * Public landing-page counter. Anonymous POSTs increment `pageViews` or
 * `ctaClicks` on `appConfig/landingMetrics`. The doc is publicly readable
 * (via Firestore rules) so the footer can render the totals live.
 *
 * Counts are approximate by design — there's no auth, no IP rate-limit,
 * and the only client-side dedupe is a session-storage guard for
 * pageViews. They're for the owner's gut-feel on traffic + conversions,
 * not a billing-grade ledger.
 *
 * Variant bucketing (optional): when the caller includes `variant`, the
 * same event also bumps `pageViews_A` / `ctaClicks_B` / etc, letting the
 * admin compare conversion rate per hero variant. Legacy aggregate fields
 * (pageViews, ctaClicks) keep incrementing too so the footer ticker keeps
 * working without changes.
 */
export async function POST(req: Request) {
  let body: { event?: string; variant?: string } = {};
  try {
    body = (await req.json()) as { event?: string; variant?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = body.event;
  if (!event || !ALLOWED_EVENTS.has(event as LandingEvent)) {
    return NextResponse.json(
      { error: "event must be 'pageView' or 'ctaClick'" },
      { status: 400 },
    );
  }

  const baseField = event === "pageView" ? "pageViews" : "ctaClicks";
  const updates: Record<string, FieldValue | Date> = {
    [baseField]: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (isHeroVariantId(body.variant)) {
    updates[`${baseField}_${body.variant}`] = FieldValue.increment(1);
  }

  try {
    await getAdminDb().doc(DOC_PATH).set(updates, { merge: true });
  } catch (err) {
    console.error("[landing/metrics] increment failed", err);
    return NextResponse.json({ error: "Counter write failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
