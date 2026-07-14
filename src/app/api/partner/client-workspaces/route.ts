import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { seedDefaultTemplates } from "@/lib/automations/seed-templates";
import { resolveClientWorkspaceLimit } from "@/lib/tiers/capabilities";
import type { PartnerProfile, PartnerStatus, PartnerTier } from "@/types/partner";

/**
 * Partner-facing client-workspace provisioning — the white-label resell path.
 *
 * A partner whose tier (or per-partner override) allows it can create
 * sub-accounts for THEIR OWN clients, capped at their allowance. Each created
 * workspace:
 *   - lives in the SAME agency (single-agency deployment, unchanged),
 *   - is stamped with resellerPartnerProfileId = the partner's uid,
 *   - optionally carries whiteLabelBrandName (the partner's brand, shown in
 *     the sidebar to everyone inside the workspace),
 *   - gets the partner written as an active "admin" member, so every
 *     existing membership-based rule and flow (invites, settings, member
 *     management) works unchanged.
 *
 * 🔐 Multi-tenant boundary note: this adds a SECOND provisioning path for
 * sub-accounts (previously agency-owner-only). Isolation is preserved
 * because access still flows exclusively through subAccountMembers rows —
 * resellerPartnerProfileId is attribution + quota only, never an access
 * grant. The partner has no access to any workspace they aren't a member of.
 *
 * GET  → list the caller's reseller workspaces + allowance.
 * POST → create one. Body: { name, brandName?, timezone? }
 */

const STARTING_ACCOUNT_NUMBER = 1000;

type PartnerAccess =
  | { profile: PartnerProfile; uid: string; email: string; displayName: string }
  | NextResponse;

const ACTIVE_PARTNER_STATUSES: PartnerStatus[] = ["approved", "active"];

async function requireActivePartner(request: Request): Promise<PartnerAccess> {
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const record = await getAdminAuth()
    .getUser(uid)
    .catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const claims = (record.customClaims ?? {}) as { status?: string };
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }

  const snap = await getAdminDb().doc(`partner_profiles/${uid}`).get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: "No partner profile. Contact the agency owner." },
      { status: 403 },
    );
  }
  const profile = snap.data() as PartnerProfile;
  if (!ACTIVE_PARTNER_STATUSES.includes(profile.status)) {
    return NextResponse.json(
      { error: `Partner status is "${profile.status}" — must be approved or active.` },
      { status: 403 },
    );
  }
  return {
    profile,
    uid,
    email: record.email ?? "",
    displayName: record.displayName ?? profile.fullName ?? "",
  };
}

interface WorkspaceRow {
  subAccountId: string;
  accountNumber: number | null;
  name: string;
  whiteLabelBrandName: string | null;
  status: string;
  createdAt: string | null;
}

async function listResellerWorkspaces(uid: string): Promise<WorkspaceRow[]> {
  const snap = await getAdminDb()
    .collection("subAccounts")
    .where("resellerPartnerProfileId", "==", uid)
    .get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        subAccountId: d.id,
        accountNumber: (data.accountNumber as number | undefined) ?? null,
        name: (data.name as string | undefined) ?? "",
        whiteLabelBrandName:
          (data.whiteLabelBrandName as string | undefined) ?? null,
        status: (data.status as string | undefined) ?? "active",
        createdAt:
          data.createdAt?.toDate?.()?.toISOString?.() ?? null,
      };
    })
    .sort((a, b) => (a.accountNumber ?? 0) - (b.accountNumber ?? 0));
}

export async function GET(request: Request) {
  const access = await requireActivePartner(request);
  if (access instanceof NextResponse) return access;

  const workspaces = await listResellerWorkspaces(access.uid);
  const limit = resolveClientWorkspaceLimit(access.profile);
  return NextResponse.json({
    workspaces,
    limit,
    used: workspaces.length,
    tier: access.profile.tier as PartnerTier,
  });
}

export async function POST(request: Request) {
  const access = await requireActivePartner(request);
  if (access instanceof NextResponse) return access;
  const { profile, uid } = access;

  const limit = resolveClientWorkspaceLimit(profile);
  if (limit <= 0) {
    return NextResponse.json(
      {
        error:
          "Your partner tier doesn't include client workspaces. Ask the agency owner about upgrading.",
      },
      { status: 403 },
    );
  }

  let body: { name?: string; brandName?: string; timezone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
  }
  const brandName = body.brandName?.trim().slice(0, 80) || null;
  const timezone = body.timezone?.trim() || "UTC";

  const existing = await listResellerWorkspaces(uid);
  const activeCount = existing.filter((w) => w.status !== "archived").length;
  if (activeCount >= limit) {
    return NextResponse.json(
      {
        error: `You've reached your limit of ${limit} client workspace${limit === 1 ? "" : "s"}. Ask the agency owner to raise it.`,
      },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const agencyId = profile.agencyId;
  const subRef = db.collection("subAccounts").doc();
  const subAccountId = subRef.id;
  const counterRef = db.doc(`agencies/${agencyId}/counters/subAccount`);

  // Same transactional counter pattern as the agency-owner create route so
  // both provisioning paths share one account-number sequence.
  const accountNumber = await db.runTransaction<number>(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const current = counterSnap.exists
      ? (counterSnap.data()?.next as number | undefined) ?? STARTING_ACCOUNT_NUMBER
      : STARTING_ACCOUNT_NUMBER;
    tx.set(counterRef, { next: current + 1 });

    tx.set(subRef, {
      id: subAccountId,
      agencyId,
      accountNumber: current,
      name,
      slug: subAccountId.slice(0, 8),
      status: "active",
      timezone,
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      twilioConfig: null,
      resendConfig: null,
      bookingConfig: null,
      sendWindow: null,
      bookingLink: null,
      replyToEmail: null,
      automationsPaused: false,
      accountContact: null,
      resellerPartnerProfileId: uid,
      whiteLabelBrandName: brandName,
    });

    // The reselling partner runs this workspace: admin membership + switcher
    // index. Their clients get invited via the existing invite flow.
    tx.set(subRef.collection("subAccountMembers").doc(uid), {
      uid,
      subAccountId,
      agencyId,
      role: "admin",
      status: "active",
      email: access.email,
      displayName: access.displayName,
      addedAt: FieldValue.serverTimestamp(),
      addedByUid: uid,
    });

    tx.set(db.doc(`userMemberships/${uid}/subAccounts/${subAccountId}`), {
      subAccountId,
      agencyId,
      accountNumber: current,
      role: "admin",
      name,
      addedAt: FieldValue.serverTimestamp(),
    });

    seedDefaultTemplates(db, (ref, data) => tx.set(ref, data), {
      agencyId,
      subAccountId,
      createdByUid: uid,
    });

    return current;
  });

  return NextResponse.json({
    subAccountId,
    accountNumber,
    name,
    whiteLabelBrandName: brandName,
    agencyId,
  });
}
