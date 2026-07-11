import "server-only";

import { NextResponse } from "next/server";
import { FieldValue, type Firestore, type DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";

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
 * No DELETE in v1 — see brief.
 */

const PE_PROMPTS = "pe_prompts";
const PE_GEMS = "pe_gems";
const PE_SKILLS = "pe_skills";
const PE_GPTS = "pe_gpts";

const MAX_NAME_LENGTH = 120;
const MAX_REF_ARRAY_LENGTH = 20;

interface RawGptBody {
  gptId?: unknown;
  name?: unknown;
  description?: unknown;
  basePromptId?: unknown;
  pinnedGemIds?: unknown;
  allowedSkillIds?: unknown;
  creditCostPerMessage?: unknown;
}

interface ValidatedFields {
  name?: string;
  description?: string | null;
  basePromptId?: string | null;
  pinnedGemIds?: string[];
  allowedSkillIds?: string[];
  creditCostPerMessage?: number;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validates the subset of fields present in `body`. `requireName` controls
 * whether a missing `name` is an error (POST) or simply left unvalidated
 * (PATCH, where the field is optional and omission means "don't change").
 */
function validateFields(
  body: RawGptBody,
  requireName: boolean,
): { fields: ValidatedFields } | { error: NextResponse } {
  const fields: ValidatedFields = {};

  if (requireName || body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length === 0 || body.name.length > MAX_NAME_LENGTH) {
      return {
        error: NextResponse.json(
          { error: "invalid_name", detail: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters` },
          { status: 400 },
        ),
      };
    }
    fields.name = body.name;
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return { error: NextResponse.json({ error: "invalid_description" }, { status: 400 }) };
    }
    fields.description = body.description ?? null;
  } else if (requireName) {
    // POST: description is optional in the request but always stored, so
    // default to null when the caller omits it.
    fields.description = null;
  }

  if (body.basePromptId !== undefined) {
    if (body.basePromptId !== null && typeof body.basePromptId !== "string") {
      return { error: NextResponse.json({ error: "invalid_basePromptId" }, { status: 400 }) };
    }
    fields.basePromptId = body.basePromptId ?? null;
  } else if (requireName) {
    fields.basePromptId = null;
  }

  if (body.pinnedGemIds !== undefined) {
    if (!isStringArray(body.pinnedGemIds) || body.pinnedGemIds.length > MAX_REF_ARRAY_LENGTH) {
      return {
        error: NextResponse.json(
          { error: "invalid_pinnedGemIds", detail: `must be an array of at most ${MAX_REF_ARRAY_LENGTH} string ids` },
          { status: 400 },
        ),
      };
    }
    fields.pinnedGemIds = body.pinnedGemIds;
  } else if (requireName) {
    fields.pinnedGemIds = [];
  }

  if (body.allowedSkillIds !== undefined) {
    if (!isStringArray(body.allowedSkillIds) || body.allowedSkillIds.length > MAX_REF_ARRAY_LENGTH) {
      return {
        error: NextResponse.json(
          { error: "invalid_allowedSkillIds", detail: `must be an array of at most ${MAX_REF_ARRAY_LENGTH} string ids` },
          { status: 400 },
        ),
      };
    }
    fields.allowedSkillIds = body.allowedSkillIds;
  } else if (requireName) {
    fields.allowedSkillIds = [];
  }

  if (body.creditCostPerMessage !== undefined || requireName) {
    fields.creditCostPerMessage = Math.max(
      0,
      Math.trunc(Number(body.creditCostPerMessage ?? 1) || 0),
    );
  }

  return { fields };
}

interface RefEntry {
  collection: string;
  id: string;
  ref: DocumentReference;
}

/**
 * Batch-loads every referenced doc (basePromptId + pinnedGemIds +
 * allowedSkillIds) via a single `getAll` and rejects the whole request if
 * any referenced doc is missing or belongs to a different sub-account.
 * Only fields actually present in `fields` are checked, so PATCH calls that
 * don't touch a given ref array skip validating it.
 */
async function validateCrossTenantRefs(
  db: Firestore,
  subAccountId: string,
  fields: Pick<ValidatedFields, "basePromptId" | "pinnedGemIds" | "allowedSkillIds">,
): Promise<NextResponse | null> {
  const entries: RefEntry[] = [];

  if (fields.basePromptId != null) {
    entries.push({
      collection: PE_PROMPTS,
      id: fields.basePromptId,
      ref: db.collection(PE_PROMPTS).doc(fields.basePromptId),
    });
  }
  for (const id of fields.pinnedGemIds ?? []) {
    entries.push({ collection: PE_GEMS, id, ref: db.collection(PE_GEMS).doc(id) });
  }
  for (const id of fields.allowedSkillIds ?? []) {
    entries.push({ collection: PE_SKILLS, id, ref: db.collection(PE_SKILLS).doc(id) });
  }

  if (entries.length === 0) return null;

  const snaps = await db.getAll(...entries.map((e) => e.ref));
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    const entry = entries[i];
    if (!snap.exists || snap.data()?.subAccountId !== subAccountId) {
      return NextResponse.json(
        { error: "cross_tenant_ref", detail: `${entry.collection}/${entry.id}` },
        { status: 422 },
      );
    }
  }
  return null;
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

  const validated = validateFields(body, /* requireName */ true);
  if ("error" in validated) return validated.error;
  const { fields } = validated;

  const db = getAdminDb();

  const refError = await validateCrossTenantRefs(db, subAccountId, fields);
  if (refError) return refError;

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

  const validated = validateFields(body, /* requireName */ false);
  if ("error" in validated) return validated.error;
  const { fields } = validated;

  const db = getAdminDb();

  const gptRef = db.collection(PE_GPTS).doc(body.gptId);
  const gptSnap = await gptRef.get();
  if (!gptSnap.exists || gptSnap.data()?.subAccountId !== subAccountId) {
    return NextResponse.json({ error: "gpt_not_found" }, { status: 404 });
  }

  const refError = await validateCrossTenantRefs(db, subAccountId, fields);
  if (refError) return refError;

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
