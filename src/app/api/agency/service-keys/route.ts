import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { readAgencyOwner } from "@/lib/auth/read-agency-owner";
import { getAdminDb } from "@/lib/firebase/admin";
import { generateServiceKey } from "@/lib/agent-api/keys";
import type { ServiceScope } from "@/types/service-keys";

const VALID_SCOPES: ServiceScope[] = [
  "contacts:read", "contacts:write", "deals:write", "templates:read",
  "templates:write", "sends:execute", "reports:read", "sequences:write",
  "sequences:enroll", "replies:read", "replies:write",
];

export async function POST(request: Request) {
  const owner = await readAgencyOwner(request);
  if (owner instanceof NextResponse) return owner;

  const body = (await request.json().catch(() => null)) as {
    label?: string;
    allowedSubAccounts?: string[];
    scopes?: string[];
  } | null;

  const label = body?.label?.trim().slice(0, 100);
  const allowedSubAccounts = body?.allowedSubAccounts;
  const scopes = body?.scopes;
  if (
    !label ||
    !Array.isArray(allowedSubAccounts) || allowedSubAccounts.length === 0 ||
    !Array.isArray(scopes) || scopes.length === 0 ||
    !scopes.every((s) => (VALID_SCOPES as string[]).includes(s))
  ) {
    return NextResponse.json(
      { error: "label, allowedSubAccounts[], and valid scopes[] are required." },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  // Every allowed sub-account must belong to the owner's agency.
  for (const saId of allowedSubAccounts) {
    const sa = await db.doc(`subAccounts/${saId}`).get();
    if (!sa.exists || sa.data()?.agencyId !== owner.agencyId) {
      return NextResponse.json(
        { error: `Sub-account ${saId} not found in your agency.` },
        { status: 400 },
      );
    }
  }

  const { key, keyHash, keyPrefix } = generateServiceKey();
  const ref = await db.collection("agencyServiceKeys").add({
    agencyId: owner.agencyId,
    label,
    keyHash,
    keyPrefix,
    allowedSubAccounts,
    scopes,
    status: "active",
    createdByUid: owner.uid,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });

  // Plaintext key is returned exactly once and never persisted.
  return NextResponse.json(
    { data: { id: ref.id, key, keyPrefix } },
    { status: 201 },
  );
}

export async function GET(request: Request) {
  const owner = await readAgencyOwner(request);
  if (owner instanceof NextResponse) return owner;

  const snap = await getAdminDb()
    .collection("agencyServiceKeys")
    .where("agencyId", "==", owner.agencyId)
    .get();

  const data = snap.docs.map((d) => {
    const k = d.data();
    return {
      id: d.id,
      label: k.label,
      keyPrefix: k.keyPrefix,
      allowedSubAccounts: k.allowedSubAccounts,
      scopes: k.scopes,
      status: k.status,
      createdAt: k.createdAt ?? null,
      lastUsedAt: k.lastUsedAt ?? null,
    };
  });
  return NextResponse.json({ data });
}
