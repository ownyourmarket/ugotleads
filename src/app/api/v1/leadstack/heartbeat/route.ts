import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

/**
 * Mothership heartbeat RECEIVER.
 *
 * Every LeadStack deployment (this one + every buyer clone) POSTs a small
 * liveness payload here on cold start and once daily. We upsert one row per
 * `instanceId` into `leadstackInstances/{instanceId}` so the agency owner's
 * "Instances" fleet view can show which deployments are live, their bootstrap
 * email, platform, version, and last-seen time.
 *
 * Auth model: intentionally open (machine-to-machine from arbitrary buyer
 * deployments — there's no shared secret to distribute). It's low-risk write-
 * only telemetry: idempotent per `instanceId`, all fields length-capped, and
 * the collection is server-only in Firestore rules. Worst case is a junk row,
 * which the fleet view's last-seen filtering ages out.
 *
 * The response mirrors the shape the sender expects
 * (`{ ok, gitpageStatus: { agency } }`) so a deployment that points its whole
 * heartbeat here (via GITPAGE_API_URL) still parses a valid response. We don't
 * gate anything on `agency` from the mothership — it's always false here; the
 * real gitpage subscription check stays with gitpage.
 *
 * Public path: covered by the `/api/v1` prefix already in middleware
 * PUBLIC_PATHS (auth happens in-route, not via session cookie).
 */

const OK_RESPONSE = { ok: true, gitpageStatus: { agency: false } } as const;

/** Trim + hard-cap a string field so a malformed payload can't bloat a doc. */
function cap(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function finiteInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const instanceId = cap(body.instanceId, 128);
  const ownerEmail = cap(body.ownerEmail, 320);

  // instanceId is the doc key; ownerEmail is the whole point of the record.
  // Missing either → accept the ping (so the sender never treats us as down)
  // but persist nothing.
  if (!instanceId || !ownerEmail) {
    return NextResponse.json(OK_RESPONSE);
  }
  // Reject an instanceId with characters that can't be a Firestore doc id.
  if (instanceId.includes("/") || instanceId === "." || instanceId === "..") {
    return NextResponse.json(OK_RESPONSE);
  }

  const version = cap(body.version, 32);
  const platform = cap(body.platform, 32);
  const subAccountCount = finiteInt(body.subAccountCount);
  const hasGitpageKey = body.hasGitpageKey === true;

  try {
    const ref = getAdminDb().collection("leadstackInstances").doc(instanceId);
    const existing = await ref.get();

    const fields: Record<string, unknown> = {
      instanceId,
      ownerEmail,
      version,
      platform,
      hasGitpageKey,
      lastSeenAt: FieldValue.serverTimestamp(),
      heartbeatCount: FieldValue.increment(1),
    };
    // subAccountCount is only present on the daily cron ping — don't overwrite
    // a known count back to null on a boot ping that omits it.
    if (subAccountCount !== null) fields.subAccountCount = subAccountCount;

    if (!existing.exists) {
      fields.firstSeenAt = FieldValue.serverTimestamp();
      if (subAccountCount === null) fields.subAccountCount = null;
    }

    await ref.set(fields, { merge: true });
  } catch (err) {
    // Never fail the sender — telemetry ingestion must not error a deploy's
    // boot path. Log and return OK.
    console.warn("[mothership/heartbeat] persist failed", err);
  }

  return NextResponse.json(OK_RESPONSE);
}
