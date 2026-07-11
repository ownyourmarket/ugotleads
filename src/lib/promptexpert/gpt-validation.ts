/**
 * Pure, DI'd validation engine for `pe_gpts` CRUD (no firebase imports —
 * see src/lib/promptexpert/run-skill.ts for the house pattern this
 * follows). The route (src/app/api/sub-accounts/[id]/promptexpert/gpts/
 * route.ts) is a thin adapter that wires `assertSameTenantRefs`'s
 * `loadRefs` to `db.getAll` and turns these results into NextResponses.
 */

const PE_PROMPTS = "pe_prompts";
const PE_GEMS = "pe_gems";
const PE_SKILLS = "pe_skills";

const MAX_NAME_LENGTH = 120;
const MAX_REF_ARRAY_LENGTH = 20;

export interface RefEntry {
  collection: "pe_prompts" | "pe_gems" | "pe_skills";
  id: string;
}

export interface ValidatedGptFields {
  name?: string;
  description?: string | null;
  basePromptId?: string | null;
  pinnedGemIds?: string[];
  allowedSkillIds?: string[];
  creditCostPerMessage?: number;
}

export type ValidateGptFieldsResult =
  | { ok: true; fields: ValidatedGptFields; refs: RefEntry[] }
  | { ok: false; status: 400 | 422; error: string; detail?: string };

/**
 * A ref id is only acceptable if it's a non-empty, non-whitespace string.
 * `db.collection(x).doc("")` throws synchronously in the Firestore admin
 * SDK, so an empty/whitespace id must be rejected here — before any ref
 * ever reaches a `.doc(id)` call — rather than allowed to crash the route
 * into an unhandled 500.
 */
function isValidRefId(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isValidRefIdArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_REF_ARRAY_LENGTH && v.every(isValidRefId);
}

/**
 * Validates the subset of fields present in `raw`. `opts.requireName`
 * controls whether a missing `name` is an error (POST) or simply left
 * unvalidated (PATCH, where the field is optional and omission means
 * "don't change"). Also returns the deduped list of cross-tenant refs
 * (`basePromptId` + `pinnedGemIds` + `allowedSkillIds`) so the caller can
 * batch-load them without loading the same doc twice.
 */
export function validateGptFields(
  raw: unknown,
  opts: { requireName: boolean },
): ValidateGptFieldsResult {
  const { requireName } = opts;
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields: ValidatedGptFields = {};

  if (requireName || body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length === 0 || body.name.length > MAX_NAME_LENGTH) {
      return {
        ok: false,
        status: 400,
        error: "invalid_name",
        detail: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`,
      };
    }
    fields.name = body.name;
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return { ok: false, status: 400, error: "invalid_description" };
    }
    fields.description = body.description ?? null;
  } else if (requireName) {
    // POST: description is optional in the request but always stored, so
    // default to null when the caller omits it.
    fields.description = null;
  }

  if (body.basePromptId !== undefined) {
    if (body.basePromptId !== null && !isValidRefId(body.basePromptId)) {
      return {
        ok: false,
        status: 422,
        error: "cross_tenant_ref",
        detail: `${PE_PROMPTS}/invalid`,
      };
    }
    fields.basePromptId = body.basePromptId ?? null;
  } else if (requireName) {
    fields.basePromptId = null;
  }

  if (body.pinnedGemIds !== undefined) {
    if (!isValidRefIdArray(body.pinnedGemIds)) {
      return {
        ok: false,
        status: 422,
        error: "cross_tenant_ref",
        detail: `${PE_GEMS}/invalid`,
      };
    }
    fields.pinnedGemIds = body.pinnedGemIds;
  } else if (requireName) {
    fields.pinnedGemIds = [];
  }

  if (body.allowedSkillIds !== undefined) {
    if (!isValidRefIdArray(body.allowedSkillIds)) {
      return {
        ok: false,
        status: 422,
        error: "cross_tenant_ref",
        detail: `${PE_SKILLS}/invalid`,
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

  const refs = dedupeRefs([
    ...(fields.basePromptId != null ? [{ collection: PE_PROMPTS, id: fields.basePromptId } as RefEntry] : []),
    ...(fields.pinnedGemIds ?? []).map((id): RefEntry => ({ collection: PE_GEMS, id })),
    ...(fields.allowedSkillIds ?? []).map((id): RefEntry => ({ collection: PE_SKILLS, id })),
  ]);

  return { ok: true, fields, refs };
}

/** Dedupes refs by `collection/id` so a repeated id is only fetched once. */
function dedupeRefs(refs: RefEntry[]): RefEntry[] {
  const seen = new Set<string>();
  const out: RefEntry[] = [];
  for (const r of refs) {
    const key = `${r.collection}/${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Batch-loads every referenced doc via the injected `loadRefs` and rejects
 * the whole request if any referenced doc is missing or belongs to a
 * different sub-account. `loadRefs` is expected to return results in the
 * same order as `refs` (the route wires this to a single `db.getAll`
 * call).
 */
export async function assertSameTenantRefs(
  loadRefs: (refs: RefEntry[]) => Promise<Array<{ exists: boolean; subAccountId?: string }>>,
  refs: RefEntry[],
  subAccountId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (refs.length === 0) return { ok: true };

  const results = await loadRefs(refs);
  for (let i = 0; i < refs.length; i++) {
    const result = results[i];
    const entry = refs[i];
    if (!result?.exists || result.subAccountId !== subAccountId) {
      return { ok: false, detail: `${entry.collection}/${entry.id}` };
    }
  }
  return { ok: true };
}
