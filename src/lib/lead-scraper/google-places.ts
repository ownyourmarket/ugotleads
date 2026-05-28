import "server-only";

/**
 * Google Places API (New) — lead scraper backend.
 *
 * Uses the Google Places Text Search (New) endpoint to find businesses
 * by query + location, then enriches each result with details (phone,
 * website, rating, reviews count).
 *
 * Requires GOOGLE_PLACES_API_KEY env var (a Google Cloud API key with
 * Places API enabled). Free $200/month credit covers ~1,000 searches.
 *
 * Fallback: when the key is missing the scraper returns an empty set
 * with a "not configured" message — the UI shows a friendly prompt.
 */

const PLACES_BASE = "https://places.googleapis.com/v1/places:searchText";

export function googlePlacesIsConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY?.trim();
}

export interface ScrapedLead {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  types: string[];
  googleMapsUrl: string | null;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ScrapeResult {
  leads: ScrapedLead[];
  source: "google_places";
  resultCount: number;
}

/**
 * Search Google Places for businesses matching a query + location.
 *
 * @param searchQuery e.g. "HVAC contractors"
 * @param location e.g. "Atlanta, GA"
 * @param maxResults 1-20, default 20
 */
export async function searchPlaces(opts: {
  searchQuery: string;
  location: string;
  maxResults?: number;
}): Promise<ScrapeResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("google_places_unconfigured: GOOGLE_PLACES_API_KEY env var not set");
  }

  const textQuery = `${opts.searchQuery} in ${opts.location}`;
  const maxResults = Math.min(opts.maxResults ?? 20, 20);

  const res = await fetch(PLACES_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
        "places.types",
        "places.googleMapsUri",
        "places.location",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: maxResults,
      languageCode: "en",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Google Places API error (${res.status}): ${errText.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      internationalPhoneNumber?: string;
      websiteUri?: string;
      rating?: number;
      userRatingCount?: number;
      types?: string[];
      googleMapsUri?: string;
      location?: { latitude: number; longitude: number };
    }>;
  };

  const leads: ScrapedLead[] = (data.places ?? []).map((p) => ({
    name: p.displayName?.text ?? "Unknown",
    address: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    types: p.types ?? [],
    googleMapsUrl: p.googleMapsUri ?? null,
    placeId: p.id,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
  }));

  return {
    leads,
    source: "google_places",
    resultCount: leads.length,
  };
}
