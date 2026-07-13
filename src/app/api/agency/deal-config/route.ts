import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAgencyOwner } from "@/lib/auth/require-agency-owner";
import {
  DEAL_NAME_MAX,
  DEAL_MEMBER_NOUN_MAX,
  DEAL_SEATS_MIN,
  DEAL_SEATS_MAX,
} from "@/lib/deal-config";

/**
 * Agency-owner-only editor for the live deal campaign (name, member noun,
 * seat count). Writes onto the EXISTING `appConfig/foundersCohort` doc —
 * publicly readable by the unauthenticated landing page via
 * `useFoundersCohort` — through the Admin SDK (bypasses the
 * `allow write: if false` rule). Mirrors the updates-modal-config route.
 *
 * Deliberately never touches `soldCount` / `currentWave` — those belong to
 * the Stripe webhook. Reset them in the Firebase console when starting a
 * fresh campaign.
 */

const DOC_PATH = "appConfig/foundersCohort";

interface PatchBody {
  dealName?: string;
  memberNoun?: string;
  slotsTotal?: number;
}

export async function PATCH(request: Request) {
  const auth = await requireAgencyOwner(request);
  if (auth instanceof NextResponse) return auth;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: auth.uid,
  };

  if (body.dealName !== undefined) {
    const dealName =
      typeof body.dealName === "string" ? body.dealName.trim() : "";
    if (!dealName || dealName.length > DEAL_NAME_MAX) {
      return NextResponse.json(
        { error: `\`dealName\` must be 1–${DEAL_NAME_MAX} characters.` },
        { status: 400 },
      );
    }
    updates.dealName = dealName;
  }

  if (body.memberNoun !== undefined) {
    const memberNoun =
      typeof body.memberNoun === "string" ? body.memberNoun.trim() : "";
    if (!memberNoun || memberNoun.length > DEAL_MEMBER_NOUN_MAX) {
      return NextResponse.json(
        {
          error: `\`memberNoun\` must be 1–${DEAL_MEMBER_NOUN_MAX} characters.`,
        },
        { status: 400 },
      );
    }
    updates.memberNoun = memberNoun;
  }

  if (body.slotsTotal !== undefined) {
    const s = body.slotsTotal;
    if (
      typeof s !== "number" ||
      !Number.isInteger(s) ||
      s < DEAL_SEATS_MIN ||
      s > DEAL_SEATS_MAX
    ) {
      return NextResponse.json(
        {
          error: `\`slotsTotal\` must be a whole number between ${DEAL_SEATS_MIN} and ${DEAL_SEATS_MAX}.`,
        },
        { status: 400 },
      );
    }
    updates.slotsTotal = s;
  }

  // Require at least one real field beyond the two audit stamps.
  if (Object.keys(updates).length <= 2) {
    return NextResponse.json(
      { error: "No valid fields to update." },
      { status: 400 },
    );
  }

  try {
    await getAdminDb().doc(DOC_PATH).set(updates, { merge: true });
  } catch (err) {
    console.error("[agency/deal-config] write failed", err);
    return NextResponse.json({ error: "Save failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
