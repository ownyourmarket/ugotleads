import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { validateGptFields, assertSameTenantRefs, type RefEntry } from "@/lib/promptexpert/gpt-validation";

/**
 * POST/PATCH /api/sub-accounts/[id]/promptexpert/gpts
 *
 * Server-validated CRUD for `pe_gpts` (SERVER-WRITTEN ONLY per the type
 * doc — Firestore rules do not allow client writes to this collection).
 *
 * The core job here is cross-tenant reference validation: `basePromptId`,
 * `pinnedGemIds`, and `allowedSkillIds` each point at documents in other
 * PromptExpert collections that are themselves tenant-scoped. Nothing in
 * Firestore enforces that those refs stay within the same sub-account (no
 * server-side join constraint exists), so this route is the equivalent of
 * the design's Postgres FK-with-tenant-check trigger: every referenced id
 * is batch-loaded and must both exist and carry a matching subAccountId,
 * or the whole write is rejected with 422 `cross_tenant_ref`.
 *
 * The actual validation logic (field shape + malformed-ref-id rejection +
 * dedupe) lives in `src/lib/promptexpert/gpt-validation.ts` as a pure,
 * DI'd, unit-tested module with no firebase imports — this route is a
 * thin adapter wiring `assertSameTenantRefs`'s `loadRefs` to `db.getAll`.
 *
 * No DELETE in v1 — see brief.
 */

const PE_GPTS = "pe_gpts";

interface RawGptBody {
  gptId?: unknown;
  name?: unknown;
  description?: unknown;
  basePromptId?: unknown;
  pinnedGemIds?: unknown;
  allowedSkillIds?: unknown;
  creditCostPerMessage?: unknown;
}

async function loadRefsFromFirestore(db: ReturnType<typeof getAdminDb>, refs: RefEntry[]) {
  if (refs.length === 0) return [];
  const snaps = await db.getAll(...refs.map((r) => db.collection(r.collection).doc(r.id)));
  return snaps.map((snap) => ({ exists: snap.exists, subAccountId: snap.data()?.subAccountId }));
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: subAccountId } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, subAccountId);
  if (auth instanceof NextResponse) return auth;

  let body: RawGptBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validated = validateGptFields(body, { requireName: true });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, detail: validated.detail }, { status: validated.status });
  }
  const { fields, refs } = validated;

  const db = getAdminDb();

  const refCheck = await assertSameTenantRefs((r) => loadRefsFromFirestore(db, r), refs, subAccountId);
  if (!refCheck.ok) {
    return NextResponse.json({ error: "cross_tenant_ref", detail: refCheck.detail }, { status: 422 });
  }

  const subSnap = await db.doc(`subAccounts/${subAccountId}`).get();
  if (!subSnap.exists) {
    return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
  }
  const agencyId = subSnap.data()?.agencyId ?? null;

  const docRef = db.collection(PE_GPTS).doc();
  await docRef.set({
    name: fields.name,
    description: fields.description ?? null,
    basePromptId: fields.basePromptId ?? null,
    pinnedGemIds: fields.pinnedGemIds ?? [],
    allowedSkillIds: fields.allowedSkillIds ?? [],
    creditCostPerMessage: fields.creditCostPerMessage ?? 1,
    agencyId,
    subAccountId,
    createdByUid: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ id: docRef.id }, { status: 201 });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: subAccountId } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, subAccountId);
  if (auth instanceof NextResponse) return auth;

  let body: RawGptBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.gptId !== "string" || body.gptId.length === 0) {
    return NextResponse.json({ error: "gptId_required" }, { status: 400 });
  }

  const validated = validateGptFields(body, { requireName: false });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, detail: validated.detail }, { status: validated.status });
  }
  const { fields, refs } = validated;

  const db = getAdminDb();

  const gptRef = db.collection(PE_GPTS).doc(body.gptId);
  const gptSnap = await gptRef.get();
  if (!gptSnap.exists || gptSnap.data()?.subAccountId !== subAccountId) {
    return NextResponse.json({ error: "gpt_not_found" }, { status: 404 });
  }

  const refCheck = await assertSameTenantRefs((r) => loadRefsFromFirestore(db, r), refs, subAccountId);
  if (!refCheck.ok) {
    return NextResponse.json({ error: "cross_tenant_ref", detail: refCheck.detail }, { status: 422 });
  }

  // Tenant fields (agencyId/subAccountId/createdByUid) are intentionally
  // never accepted from the request body — only the whitelisted content
  // fields below are ever written by PATCH.
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.basePromptId !== undefined) patch.basePromptId = fields.basePromptId;
  if (fields.pinnedGemIds !== undefined) patch.pinnedGemIds = fields.pinnedGemIds;
  if (fields.allowedSkillIds !== undefined) patch.allowedSkillIds = fields.allowedSkillIds;
  if (fields.creditCostPerMessage !== undefined) patch.creditCostPerMessage = fields.creditCostPerMessage;

  await gptRef.update(patch);

  return NextResponse.json({ ok: true });
}
