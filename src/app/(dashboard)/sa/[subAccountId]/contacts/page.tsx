"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Filter, GitMerge, History, Mail, Search, Tag, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToContacts } from "@/lib/firestore/contacts";
import { serializeCsv, downloadCsv } from "@/lib/csv";
import { toDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { AddContactModal } from "@/components/contacts/add-contact-modal";
import { ImportContactsDialog } from "@/components/contacts/import-contacts-dialog";
import { BulkEmailDialog } from "@/components/contacts/bulk-email-dialog";
import { ImportHistoryDialog } from "@/components/contacts/import-history-dialog";
import type { Contact } from "@/types/contacts";

/**
 * Reads ?import=1 from the URL, opens the import dialog, then strips the
 * param so closing the dialog doesn't get fought by the next render.
 *
 * Lifted into its own component so we can wrap it in <Suspense> —
 * useSearchParams() bails out of static rendering otherwise.
 */
function ImportQueryWatcher({ onOpen }: { onOpen: () => void }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (searchParams.get("import") !== "1") return;
    onOpen();
    // Replace the URL without the import param so this effect doesn't
    // re-open the dialog every time the user closes it.
    const next = new URLSearchParams(searchParams);
    next.delete("import");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, pathname, router, onOpen]);
  return null;
}

export default function ContactsPage() {
  const { user, loading: authLoading } = useAuth();
  const { subAccountId, agencyId, saPath } = useSubAccount();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [contactFilter, setContactFilter] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openImport = useCallback(() => setImportOpen(true), []);

  const activeFilterCount =
    (sourceFilter ? 1 : 0) + (stageFilter ? 1 : 0) + (contactFilter ? 1 : 0);

  function clearFilters() {
    setSourceFilter("");
    setStageFilter("");
    setContactFilter("");
  }

  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    setLoading(true);
    const unsub = subscribeToContacts(
      { agencyId, subAccountId },
      (list) => {
        setContacts(list);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user, agencyId, subAccountId, authLoading]);

  function handleExport() {
    if (contacts.length === 0) {
      toast.error("No contacts to export.");
      return;
    }
    const headers = ["name", "email", "phone", "company", "source", "tags", "pipelineStage", "createdAt"];
    const rows = contacts.map((c) => ({
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      source: c.source,
      tags: c.tags ?? [],
      pipelineStage: c.pipelineStage ?? "",
      createdAt: toDate(c.createdAt)?.toISOString() ?? "",
    }));
    const csv = serializeCsv(headers, rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`leadstack-contacts-${stamp}.csv`, csv);
    toast.success(`Exported ${rows.length} contacts`);
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <ImportQueryWatcher onOpen={openImport} />
      </Suspense>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Everyone in your pipeline, in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            render={<Link href={saPath("/contacts/duplicates")} />}
            disabled={contacts.length === 0}
          >
            <GitMerge className="mr-1 h-4 w-4" />
            Duplicates
          </Button>
          <Button
            variant="outline"
            onClick={() => setBulkEmailOpen(true)}
            disabled={contacts.length === 0}
          >
            <Mail className="mr-1 h-4 w-4" />
            Send bulk email
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="mr-1 h-4 w-4" />
            Import CSV
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHistoryOpen(true)}
            title="Import history"
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={contacts.length === 0}
          >
            <Download className="mr-1 h-4 w-4" />
            Export
          </Button>
          <AddContactModal />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or company"
            className="pl-8"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen((p) => !p)}
          className={activeFilterCount > 0 ? "border-primary text-primary" : ""}
        >
          <Filter className="mr-1 h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {/* Tag filter pills */}
        {(() => {
          const allTags = Array.from(
            new Set(contacts.flatMap((c) => c.tags ?? [])),
          ).sort();
          if (allTags.length === 0) return null;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setTagFilter((prev) => (prev === t ? null : t))
                  }
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    tagFilter === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
              {tagFilter && (
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className="flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* Advanced filter bar */}
      {filtersOpen && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card/50 p-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Source
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="" className="bg-background text-foreground">All sources</option>
              <option value="website-form" className="bg-background text-foreground">Website form</option>
              <option value="web-chat" className="bg-background text-foreground">Web chat</option>
              <option value="website" className="bg-background text-foreground">Website</option>
              <option value="referral" className="bg-background text-foreground">Referral</option>
              <option value="ads" className="bg-background text-foreground">Ads</option>
              <option value="other" className="bg-background text-foreground">Other</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Pipeline stage
            </label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="" className="bg-background text-foreground">All stages</option>
              <option value="new" className="bg-background text-foreground">New</option>
              <option value="contacted" className="bg-background text-foreground">Contacted</option>
              <option value="qualified" className="bg-background text-foreground">Qualified</option>
              <option value="proposal" className="bg-background text-foreground">Proposal</option>
              <option value="won" className="bg-background text-foreground">Won</option>
              <option value="lost" className="bg-background text-foreground">Lost</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Contact info
            </label>
            <select
              value={contactFilter}
              onChange={(e) => setContactFilter(e.target.value)}
              className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="" className="bg-background text-foreground">Any</option>
              <option value="has-email" className="bg-background text-foreground">Has email</option>
              <option value="no-email" className="bg-background text-foreground">Missing email</option>
              <option value="has-phone" className="bg-background text-foreground">Has phone</option>
              <option value="no-phone" className="bg-background text-foreground">Missing phone</option>
            </select>
          </div>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
              <X className="mr-1 h-3 w-3" />
              Clear filters
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : contacts.length === 0 ? (
        <EmptyState onImport={() => setImportOpen(true)} />
      ) : (
        <ContactsTable
          contacts={contacts}
          search={search}
          tagFilter={tagFilter}
          sourceFilter={sourceFilter}
          stageFilter={stageFilter}
          contactFilter={contactFilter}
        />
      )}

      <ImportContactsDialog open={importOpen} onOpenChange={setImportOpen} />
      <BulkEmailDialog
        open={bulkEmailOpen}
        onOpenChange={setBulkEmailOpen}
        contacts={contacts}
      />
      <ImportHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b bg-muted/40 px-4 py-3">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="divide-y">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-5 w-16 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Users className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-base font-semibold">No contacts yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Add your first lead or import a CSV from your old CRM.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <AddContactModal />
        <Button variant="outline" onClick={onImport}>
          <Upload className="mr-1 h-4 w-4" />
          Import CSV
        </Button>
      </div>
    </div>
  );
}
