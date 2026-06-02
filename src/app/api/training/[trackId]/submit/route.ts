import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { DEFAULT_TRACK_MODULES } from "@/lib/training/content";
import type { MemberStatus, Role } from "@/types";

/**
 * POST /api/training/[trackId]/submit
 *
 * Server-validated certification track submission. Sets status to "completed"
 * (awaiting agency owner review) only when ALL modules are confirmed complete.
 *
 * ── Why server-side ──────────────────────────────────────────────────────────
 * The client SDK Firestore rules block partners from setting status to
 * "completed" directly. This route uses the Admin SDK to bypass those rules
 * AFTER independently verifying that the progress doc contains a completed
 * module index for every module slot (0 .. totalModules-1).
 *
 * ── What this route does NOT do ─────────────────────────────────────────────
 * - Does NOT approve the certification.
 * - Does NOT update partnerProfile.completedTrackIds.
 * - Does NOT create commission events.
 * - Does NOT activate checkout or Stripe.
 * - No MLM, genealogy, binary, unilevel, downline, rank, or compensation logic.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * x-user-uid is injected by the Next.js middleware from a verified Firebase
 * session cookie — the client cannot spoof it.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyId?: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  }

  const { trackId } = await params;
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required." }, { status: 400 });
  }

  const db = getAdminDb();

  // ── Verify partner profile exists ─────────────────────────────────────────
  const partnerSnap = await db.doc(`partner_profiles/${uid}`).get().catch(() => null);
  if (!partnerSnap?.exists) {
    return NextResponse.json(
      { error: "Partner profile not found. You must be enrolled as a partner to submit." },
      { status: 404 },
    );
  }

  const partner = partnerSnap.data() as { status: string; agencyId: string };
  if (partner.status !== "active" && partner.status !== "approved") {
    return NextResponse.json(
      { error: `Partner status "${partner.status}" is not eligible to submit certifications.` },
      { status: 403 },
    );
  }

  // ── Load track progress ───────────────────────────────────────────────────
  const progressId = `${uid}_${trackId}`;
  const progressSnap = await db.doc(`track_progress/${progressId}`).get().catch(() => null);

  if (!progressSnap?.exists) {
    return NextResponse.json(
      { error: "No progress found for this track. Start the track and complete the modules first." },
      { status: 404 },
    );
  }

  const progress = progressSnap.data() as {
    uid: string;
    status: string;
    completedModuleIndices: number[];
    totalModules: number;
    agencyId: string;
  };

  // Ownership check — progress doc must belong to this user
  if (progress.uid !== uid) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // Agency match
  if (progress.agencyId !== partner.agencyId) {
    return NextResponse.json({ error: "Agency mismatch." }, { status: 403 });
  }

  // Already at a terminal/in-review state
  if (progress.status === "completed") {
    return NextResponse.json(
      { skipped: true, reason: "Already submitted for review. Awaiting agency owner approval." },
    );
  }
  if (progress.status === "approved") {
    return NextResponse.json(
      { skipped: true, reason: "Already certified and approved." },
    );
  }

  // ── Validate all modules complete ─────────────────────────────────────────
  // We use totalModules stored in the progress doc as the authoritative count.
  // That value was set when the partner first checked a module and reflects
  // the actual module count at that time (Firestore milestones or defaults).
  // As a secondary cross-check we also look up DEFAULT_TRACK_MODULES.

  const totalModules = progress.totalModules;

  if (totalModules === 0) {
    // If somehow totalModules was stored as 0, fall back to DEFAULT_TRACK_MODULES
    const defaultCount = DEFAULT_TRACK_MODULES[trackId]?.length ?? 0;
    if (defaultCount === 0) {
      return NextResponse.json(
        { error: "This track has no modules configured. Contact your agency owner." },
        { status: 422 },
      );
    }
    // Update the progress doc with the correct count so it doesn't get stuck
    await db.doc(`track_progress/${progressId}`).update({
      totalModules: defaultCount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json(
      {
        error: `Module count was corrected to ${defaultCount}. Please refresh and complete all modules.`,
        correctedTotalModules: defaultCount,
      },
      { status: 422 },
    );
  }

  const completedSet = new Set<number>(progress.completedModuleIndices ?? []);
  const missingModules: number[] = [];

  for (let i = 0; i < totalModules; i++) {
    if (!completedSet.has(i)) {
      missingModules.push(i);
    }
  }

  if (missingModules.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot submit: ${missingModules.length} module${missingModules.length !== 1 ? "s" : ""} not yet completed.`,
        missingModuleIndices: missingModules,
        completedCount: completedSet.size,
        totalModules,
        note: "Complete all modules before submitting for review.",
      },
      { status: 422 },
    );
  }

  // ── All modules complete — set to "completed" (awaiting review) ───────────
  await db.doc(`track_progress/${progressId}`).update({
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.info(
    `[training/submit] Partner ${uid} submitted track ${trackId} for review (progress: ${progressId})`,
  );

  return NextResponse.json({
    ok: true,
    progressId,
    trackId,
    status: "completed",
    completedModules: completedSet.size,
    totalModules,
    message:
      "All modules verified. Your submission is now awaiting agency owner approval. " +
      "You will be notified when your certification is approved.",
  });
}
