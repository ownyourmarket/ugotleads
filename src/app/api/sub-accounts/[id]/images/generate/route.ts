import { NextResponse } from "next/server";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { resolveAiCallContext, CapExceededError } from "@/lib/comms/ai/provider-resolver";
import { generateImage, imageGenIsConfigured } from "@/lib/fal/client";

/**
 * POST /api/sub-accounts/[id]/images/generate
 *
 * Generate an AI image from a text prompt using OpenRouter's image
 * generation models. Uses the same API key + cap system as all other
 * AI features.
 *
 * Request body:
 *   { prompt: string, aspectRatio?: string, imageSize?: string }
 *
 * Response:
 *   { url: string }   — base64 data URL or hosted URL
 */

const IMAGE_TOKEN_EQUIVALENT = 1_000; // cap accounting per image

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!imageGenIsConfigured()) {
    return NextResponse.json(
      { error: "unconfigured", message: "AI image generation requires OPENROUTER_API_KEY." },
      { status: 503 },
    );
  }

  // Check AI cap before spending money on an image.
  let aiCtx;
  try {
    aiCtx = await resolveAiCallContext(id);
  } catch (err) {
    if (err instanceof CapExceededError) {
      return NextResponse.json(
        { error: "cap_exceeded", message: "Your AI usage cap has been reached for this billing period. Upgrade your plan or wait for the next cycle." },
        { status: 429 },
      );
    }
    throw err;
  }

  let body: { prompt?: string; aspectRatio?: string; imageSize?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt || prompt.length < 5) {
    return NextResponse.json(
      { error: "prompt_required", message: "Provide an image prompt (at least 5 characters)." },
      { status: 400 },
    );
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { error: "prompt_too_long", message: "Keep image prompts under 2,000 characters." },
      { status: 400 },
    );
  }

  try {
    const result = await generateImage({
      prompt,
      apiKey: aiCtx.apiKey,
      aspectRatio: body.aspectRatio ?? "16:9",
      imageSize: body.imageSize ?? "1K",
    });

    // Record usage against cap.
    await aiCtx.recordUsage(IMAGE_TOKEN_EQUIVALENT);

    return NextResponse.json({ url: result.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[images/generate] failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "generation_failed", message: msg.slice(0, 400) },
      { status: 502 },
    );
  }
}
