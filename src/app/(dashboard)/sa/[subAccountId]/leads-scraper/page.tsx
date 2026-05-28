"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

interface ScrapedLead {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  types: string[];
  googleMapsUrl: string | null;
  placeId: string;
}

export default function LeadScraperPage() {
  const { subAccountId } = useParams<{ subAccountId: string }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useState("");
  const [scraping, setScraping] = useState(false);
  const [leads, setLeads] = useState<ScrapedLead[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  async function scrape() {
    if (!searchQuery.trim() || !location.trim()) {
      toast.error("Enter a search query and location.");
      return;
    }
    setScraping(true);
    setLeads([]);
    setHasSearched(false);
    setImportedCount(null);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/leads/scrape`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery.trim(),
            location: location.trim(),
          }),
        },
      );
      const data = (await res.json()) as {
        leads?: ScrapedLead[];
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setLeads(data.leads ?? []);
      setHasSearched(true);
      toast.success(`Found ${data.leads?.length ?? 0} leads.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scrape failed");
      setHasSearched(true);
    } finally {
      setScraping(false);
    }
  }

  async function importAll() {
    if (leads.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/leads/scrape`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery.trim(),
            location: location.trim(),
            autoImport: true,
          }),
        },
      );
      const data = (await res.json()) as {
        imported?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setImportedCount(data.imported ?? 0);
      toast.success(
        `Imported ${data.imported ?? 0} new contacts. Duplicates were skipped.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lead Scraper</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search for local businesses on Google Maps and import them as contacts.
          Great for finding prospects in your target market.
        </p>
      </div>

      {/* Search form */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Search</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="search-query" className="block text-sm font-medium mb-1">
              Business type <span className="text-red-500">*</span>
            </label>
            <input
              id="search-query"
              type="text"
              placeholder="e.g. HVAC contractors, auto dealers, dentists"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm"
            />
          </div>
          <div>
            <label htmlFor="search-location" className="block text-sm font-medium mb-1">
              Location <span className="text-red-500">*</span>
            </label>
            <input
              id="search-location"
              type="text"
              placeholder="e.g. Atlanta, GA or 30301"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={scrape}
            disabled={scraping || !searchQuery.trim() || !location.trim()}
            className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {scraping ? "Searching…" : "Search Google Maps"}
          </button>
          {leads.length > 0 && (
            <button
              type="button"
              onClick={importAll}
              disabled={importing}
              className="h-10 px-5 rounded-md border text-sm font-semibold hover:bg-muted/50 disabled:opacity-50"
            >
              {importing
                ? "Importing…"
                : importedCount != null
                  ? `✓ ${importedCount} imported`
                  : `Import all ${leads.length} as contacts`}
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {hasSearched && (
        <div className="rounded-xl border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Results ({leads.length})
            </h2>
            {importedCount != null && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                ✓ {importedCount} imported to contacts
              </span>
            )}
          </div>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No results found. Try a broader search query or different location.
            </p>
          ) : (
            <div className="space-y-2">
              {leads.map((lead) => (
                <LeadCard key={lead.placeId} lead={lead} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: ScrapedLead }) {
  const stars =
    lead.rating != null
      ? "★".repeat(Math.round(lead.rating)) +
        "☆".repeat(Math.max(0, 5 - Math.round(lead.rating)))
      : null;

  return (
    <div className="rounded-md border p-4 text-sm space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{lead.name}</div>
          {lead.address && (
            <div className="text-muted-foreground text-xs">{lead.address}</div>
          )}
        </div>
        {stars && (
          <div className="shrink-0 text-right">
            <span className="text-amber-500 text-xs tracking-wider">
              {stars}
            </span>
            {lead.reviewCount != null && (
              <div className="text-xs text-muted-foreground">
                {lead.reviewCount} reviews
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            className="text-primary underline"
          >
            {lead.phone}
          </a>
        )}
        {lead.website && (
          <a
            href={lead.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline truncate max-w-[200px]"
          >
            {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
        {lead.googleMapsUrl && (
          <a
            href={lead.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground underline"
          >
            View on Maps
          </a>
        )}
      </div>
    </div>
  );
}
