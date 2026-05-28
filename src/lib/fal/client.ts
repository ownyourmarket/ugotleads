import "server-only";

/**
 * AI Image Generation via OpenRouter.
 *
 * Uses the same OpenRouter API key + chat completions endpoint the rest
 * of the platform already uses. Supports any image-capable model on
 * OpenRouter (Flux, Gemini image, GPT-image, etc.).
 *
 * Returns a base64 data URL from the model response — callers can use
 * this directly as an <img> src or pass it to Zernio as a media URL.
 *
 * Default model: black-forest-labs/flux.2-pro (fast, cheap, high quality).
 * Override via IMAGE_GENERATION_MODEL env var.
 */

const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-pro";

export function imageGenIsConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export interface GenerateImageResult {
  /** Base64 data URL (data:image/png;base64,...) or hosted URL */
  url: string;
}

export async function generateImage(opts: {
  prompt: string;
  apiKey: string;
  /** Default "16:9" */
  aspectRatio?: string;
  /** Default "1K" */
  imageSize?: string;
  /** OpenRouter model id. Default from IMAGE_GENERATION_MODEL env or flux.2-pro */
  model?: string;
}): Promise<GenerateImageResult> {
  const model =
    opts.model ??
    process.env.IMAGE_GENERATION_MODEL ??
    DEFAULT_IMAGE_MODEL;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ugotleads.io",
      "X-Title": "UGotLeads",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: opts.prompt,
        },
      ],
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: opts.aspectRatio ?? "16:9",
        image_size: opts.imageSize ?? "1K",
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter image generation failed (${res.status}): ${errBody.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type: string; image_url?: { url: string }; text?: string }>;
      };
    }>;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(`OpenRouter: ${data.error.message}`);
  }

  // Extract image URL from response — could be in multipart content array
  // or as a base64 data URL embedded in the message content.
  const msg = data.choices?.[0]?.message;
  if (!msg) {
    throw new Error("OpenRouter returned no message in response");
  }

  // Multipart content array format
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === "image_url" && part.image_url?.url) {
        return { url: part.image_url.url };
      }
    }
  }

  // Check if content is a string containing a data URL
  if (typeof msg.content === "string") {
    const dataUrlMatch = msg.content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (dataUrlMatch) {
      return { url: dataUrlMatch[1] };
    }
  }

  throw new Error(
    "OpenRouter image generation returned no image. The model may not support image output.",
  );
}
