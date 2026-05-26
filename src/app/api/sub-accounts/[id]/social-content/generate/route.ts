import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import { publishCallback, qstashIsConfigured } from "@/lib/automations/qstash";
import { aiIsConfigured } from "@/lib/comms/ai/openrouter";
import type {
  BusinessProfile,
  ContentCadence,
  SocialPlatform,
  SocialVoice,
} from "@/types/social-content";

/**
 * POST /api/sub-accounts/[id]/social-content/generate
 *
 * Creates a batch doc + schedules the first QStash week-callback. The
 * remaining weeks are scheduled by each preceding step. Returns the
 * batchId immediately; the UI subscribes to the doc via onSnapshot to
 * see progressive results.
 */

const VALID_PLATFORMS = new Set<SocialPlatform>([
  "facebook",
  "instagram",
  "linkedin",
  "x",
]);
const VALID_VOICES = new Set<SocialVoice>([
  "professional",
  "casual",
  "bold",
  "warm",
  "expert",
]);

interface RequestBody {
  businessProfile?: Partial<BusinessProfile>;
  cadence?: Partial<ContentCadence>;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!aiIsConfigured()) {
    return NextResponse.json(
      { error: "ai_unconfigured", message: "OPENROUTER_API_KEY not set on this deployment." },
      { status: 503 },
    );
  }
  if (!qstashIsConfigured()) {
    return NextResponse.json(
      {
        error: "qstash_unconfigured",
        message: "QStash isn't configured — content generation needs a job queue.",
      },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Validate businessProfile.
  const bp = body.businessProfile ?? {};
  if (!str(bp.industry) || !str(bp.location) || !str(bp.products) || !str(bp.audience)) {
    return NextResponse.json(
      { error: "missing_business_profile_fields", required: ["industry", "location", "products", "audience"] },
      { status: 400 },
    );
  }
  if (!bp.voice || !VALID_VOICES.has(bp.voice as SocialVoice)) {
    return NextResponse.json(
      { error: "invalid_voice", validValues: Array.from(VALID_VOICES) },
      { status: 400 },
    );
  }

  // Validate cadence.
  const cad = body.cadence ?? {};
  const platforms = Array.isArray(cad.platforms) ? cad.platforms : [];
  const validPlatforms = platforms.filter((p): p is SocialPlatform =>
    VALID_PLATFORMS.has(p as SocialPlatform),
  );
  if (validPlatforms.length === 0) {
    return NextResponse.json(
      { error: "platforms_required", validValues: Array.from(VALID_PLATFORMS) },
      { status: 400 },
    );
  }
  const postsPerWeek = (cad.postsPerWeek ?? 5) as ContentCadence["postsPerWeek"];
  if (![3, 5, 7].includes(postsPerWeek as number)) {
    return NextResponse.json(
      { error: "invalid_posts_per_week", validValues: [3, 5, 7] },
      { status: 400 },
    );
  }
  const weeks = Math.max(1, Math.min(8, Math.floor(cad.weeks ?? 4)));

  // Create batch doc.
  const db = getAdminDb();
  const subAccountSnap = await db.doc(`subAccounts/${id}`).get();
  const subAccountData = subAccountSnap.data();
  if (!subAccountData) {
    return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
  }

  const batchRef = db.collection(`subAccounts/${id}/socialContent`).doc();
  const totalPosts = validPlatforms.length * postsPerWeek * weeks;

  await batchRef.set({
    id: batchRef.id,
    agencyId: subAccountData.agencyId,
    subAccountId: id,
    createdByUid: auth.uid,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    businessProfile: {
      industry: str(bp.industry),
      location: str(bp.location),
      voice: bp.voice as SocialVoice,
      products: str(bp.products),
      audience: str(bp.audience),
      websiteUrl: bp.websiteUrl?.trim() || null,
    },
    cadence: {
      platforms: validPlatforms,
      postsPerWeek,
      weeks,
    },
    status: "queued",
    progress: { completed: 0, total: totalPosts },
    generatedPosts: [],
    tokensUsed: 0,
    modelUsed: "",
  });

  // Schedule the first week's QStash callback.
  const published = await publishCallback({
    pathname: "/api/social-content/generate-step",
    body: { batchId: batchRef.id, subAccountId: id, weekIndex: 0 },
    delaySeconds: 0,
    deduplicationId: `socialContent_${batchRef.id}_0`,
  });

  if (!published) {
    await batchRef.update({
      status: "failed",
      errorMessage: "Failed to schedule first generation step",
      updatedAt: Timestamp.now(),
    });
    return NextResponse.json(
      { error: "schedule_failed", message: "Couldn't enqueue the generation job." },
      { status: 500 },
    );
  }

  return NextResponse.json({ batchId: batchRef.id, totalPosts });
}

function str(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, 1000);
}
