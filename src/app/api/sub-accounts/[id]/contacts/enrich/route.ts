import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import { scrapeUrl, firecrawlIsConfigured } from "@/lib/firecrawl/client";
import { resolveAiCallContext, CapExceededError } from "@/lib/comms/ai/provider-resolver";

/**
 * POST /api/sub-accounts/[id]/contacts/enrich
 *
 * Enrich a contact by scraping their website for email addresses and
 * additional business details using Firecrawl + AI extraction.
 *
 * Request body:
 *   { contactId: string }
 *
 * Requires the contact to have a `website` field. Scrapes the site,
 * uses OpenRouter to extract emails/phones from the page content,
 * and updates the contact doc.
 */

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!firecrawlIsConfigured()) {
    return NextResponse.json(
      { error: "firecrawl_unconfigured", message: "Contact enrichment requires FIRECRAWL_API_KEY." },
      { status: 503 },
    );
  }

  let body: { contactId?: string; placeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.contactId && !body.placeId) {
    return NextResponse.json(
      { error: "contact_required", message: "Provide a contactId or placeId." },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  let contactRef;
  let contact;

  if (body.contactId) {
    contactRef = db.doc(`contacts/${body.contactId}`);
    const contactSnap = await contactRef.get();
    contact = contactSnap.data();
    if (!contact || contact.subAccountId !== id) {
      return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
    }
  } else {
    // Look up by googlePlaceId
    const q = await db
      .collection("contacts")
      .where("subAccountId", "==", id)
      .where("googlePlaceId", "==", body.placeId)
      .limit(1)
      .get();
    if (q.empty) {
      return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
    }
    contactRef = q.docs[0].ref;
    contact = q.docs[0].data();
  }

  const website = contact.website as string | null;
  if (!website) {
    return NextResponse.json(
      { error: "no_website", message: "This contact has no website to enrich from." },
      { status: 400 },
    );
  }

  // Scrape the website
  let markdown: string;
  try {
    const result = await scrapeUrl(website);
    markdown = result.markdown.slice(0, 4000); // cap to control token usage
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scrape failed";
    return NextResponse.json(
      { error: "scrape_failed", message: msg.slice(0, 300) },
      { status: 502 },
    );
  }

  // Use AI to extract contact info
  let aiCtx;
  try {
    aiCtx = await resolveAiCallContext(id);
  } catch (err) {
    if (err instanceof CapExceededError) {
      return NextResponse.json(
        { error: "cap_exceeded", message: "AI usage cap reached." },
        { status: 429 },
      );
    }
    throw err;
  }

  const extractionPrompt = `Extract business contact information from this website content. Return ONLY a JSON object with these fields (use null for any not found):
{
  "emails": ["array of email addresses found"],
  "phones": ["array of phone numbers found"],
  "ownerName": "business owner or contact person name",
  "description": "one-sentence business description"
}

Website content:
${markdown}`;

  try {
    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiCtx.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ugotleads.io",
        "X-Title": "UGotLeads",
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4.5",
        messages: [{ role: "user", content: extractionPrompt }],
        max_tokens: 500,
      }),
    });

    const aiData = (await aiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = aiData.choices?.[0]?.message?.content ?? "";
    const tokens = aiData.usage?.total_tokens ?? 500;
    await aiCtx.recordUsage(tokens);

    // Parse the AI response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        ok: true,
        enriched: false,
        message: "Could not extract structured data from the website.",
      });
    }

    let extracted: {
      emails?: string[] | null;
      phones?: string[] | null;
      ownerName?: string | null;
      description?: string | null;
    };
    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({
        ok: true,
        enriched: false,
        message: "AI returned malformed data.",
      });
    }

    // Update the contact with found data
    const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };
    let fieldsUpdated = 0;

    if (extracted.emails?.length && !contact.email) {
      updates.email = extracted.emails[0];
      fieldsUpdated++;
    }
    if (extracted.phones?.length && !contact.phone) {
      updates.phone = extracted.phones[0];
      fieldsUpdated++;
    }
    if (extracted.ownerName && !contact.firstName) {
      const parts = extracted.ownerName.split(" ");
      updates.firstName = parts[0] ?? null;
      updates.lastName = parts.slice(1).join(" ") || null;
      fieldsUpdated++;
    }
    if (extracted.description) {
      updates.enrichmentDescription = extracted.description;
      fieldsUpdated++;
    }
    // Store all found data for reference
    updates.enrichment = {
      emails: extracted.emails ?? [],
      phones: extracted.phones ?? [],
      ownerName: extracted.ownerName ?? null,
      description: extracted.description ?? null,
      enrichedAt: Timestamp.now(),
      source: website,
    };

    await contactRef.update(updates);

    return NextResponse.json({
      ok: true,
      enriched: true,
      fieldsUpdated,
      found: {
        emails: extracted.emails ?? [],
        phones: extracted.phones ?? [],
        ownerName: extracted.ownerName ?? null,
        description: extracted.description ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[contacts/enrich] AI extraction failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "extraction_failed", message: msg.slice(0, 300) },
      { status: 502 },
    );
  }
}
