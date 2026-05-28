import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  searchPlaces,
  googlePlacesIsConfigured,
  type ScrapedLead,
} from "@/lib/lead-scraper/google-places";

/**
 * POST /api/sub-accounts/[id]/leads/scrape
 *
 * Scrape leads from Google Places based on a search query + location.
 * Optionally auto-imports results as contacts in the sub-account CRM.
 *
 * Request body:
 *   {
 *     query: string,          // e.g. "HVAC contractors"
 *     location: string,       // e.g. "Atlanta, GA"
 *     maxResults?: number,    // 1-20, default 20
 *     autoImport?: boolean,   // true → create contacts immediately
 *   }
 *
 * Response:
 *   { leads: ScrapedLead[], imported?: number }
 */

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!googlePlacesIsConfigured()) {
    return NextResponse.json(
      {
        error: "unconfigured",
        message:
          "Lead scraping requires a Google Places API key. Ask your admin to set GOOGLE_PLACES_API_KEY.",
      },
      { status: 503 },
    );
  }

  let body: {
    query?: string;
    location?: string;
    maxResults?: number;
    autoImport?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const searchQuery = body.query?.trim();
  const location = body.location?.trim();
  if (!searchQuery) {
    return NextResponse.json(
      { error: "query_required", message: "Enter a search query (e.g. 'plumbers')." },
      { status: 400 },
    );
  }
  if (!location) {
    return NextResponse.json(
      { error: "location_required", message: "Enter a location (e.g. 'Atlanta, GA')." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await searchPlaces({
      searchQuery,
      location,
      maxResults: body.maxResults,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[leads/scrape] failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "scrape_failed", message: msg.slice(0, 400) },
      { status: 502 },
    );
  }

  let imported = 0;

  if (body.autoImport && result.leads.length > 0) {
    const db = getAdminDb();
    const subSnap = await db.doc(`subAccounts/${id}`).get();
    const subData = subSnap.data();
    if (!subData) {
      return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
    }

    const batch = db.batch();
    for (const lead of result.leads) {
      // Dedup by placeId — check if a contact with this googlePlaceId already exists.
      const existing = await db
        .collection("contacts")
        .where("subAccountId", "==", id)
        .where("googlePlaceId", "==", lead.placeId)
        .limit(1)
        .get();
      if (!existing.empty) continue;

      const ref = db.collection("contacts").doc();
      batch.set(ref, {
        subAccountId: id,
        agencyId: subData.agencyId,
        createdByUid: auth.uid,
        name: lead.name,
        firstName: null,
        lastName: null,
        email: null,
        phone: lead.phone,
        company: lead.name,
        source: "lead-scraper",
        tags: ["scraped"],
        address: lead.address,
        website: lead.website,
        googlePlaceId: lead.placeId,
        googleMapsUrl: lead.googleMapsUrl,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        location: lead.latitude && lead.longitude
          ? { lat: lead.latitude, lng: lead.longitude }
          : null,
        emailOptedOut: false,
        smsOptedOut: false,
        attribution: {
          source: "lead-scraper",
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          utmContent: null,
          utmTerm: null,
          fbclid: null,
          gclid: null,
          landingPage: null,
          referrer: null,
        },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      imported++;
    }
    if (imported > 0) {
      await batch.commit();
    }
  }

  return NextResponse.json({
    leads: result.leads,
    resultCount: result.resultCount,
    source: result.source,
    ...(body.autoImport ? { imported } : {}),
  });
}
