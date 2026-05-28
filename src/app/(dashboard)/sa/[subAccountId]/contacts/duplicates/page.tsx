"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  GitMerge,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToContacts } from "@/lib/firestore/contacts";
import { formatContactDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { Contact } from "@/types/contacts";

interface DuplicateGroup {
  key: string;
  matchType: "email" | "phone";
  matchValue: string;
  contacts: Contact[];
}

function findDuplicates(contacts: Contact[]): DuplicateGroup[] {
  const emailMap = new Map<string, Contact[]>();
  const phoneMap = new Map<string, Contact[]>();

  for (const c of contacts) {
    const email = c.email?.trim().toLowerCase();
    if (email) {
      const list = emailMap.get(email) ?? [];
      list.push(c);
      emailMap.set(email, list);
    }
    const phone = c.phone?.trim().replace(/\s+/g, "");
    if (phone && phone.length >= 7) {
      const list = phoneMap.get(phone) ?? [];
      list.push(c);
      phoneMap.set(phone, list);
    }
  }

  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();

  for (const [email, list] of emailMap) {
    if (list.length < 2) continue;
    const key = `email:${email}`;
    groups.push({ key, matchType: "email", matchValue: email, contacts: list });
    for (const c of list) seen.add(c.id);
  }

  for (const [phone, list] of phoneMap) {
    if (list.length < 2) continue;
    // Skip if all contacts in this phone group are already in an email group
    if (list.every((c) => seen.has(c.id))) continue;
    const key = `phone:${phone}`;
    groups.push({ key, matchType: "phone", matchValue: phone, contacts: list });
  }

  return groups;
}

export default function DuplicatesPage() {
  const { user, loading: authLoading } = useAuth();
  const { subAccountId, agencyId, isAdmin, saPath } = useSubAccount();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);
  const [merged, setMerged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    const unsub = subscribeToContacts({ agencyId, subAccountId }, (list) => {
      setContacts(list);
      setLoading(false);
    });
    return () => unsub();
  }, [user, agencyId, subAccountId, authLoading]);

  const groups = useMemo(() => findDuplicates(contacts), [contacts]);
  const activeGroups = groups.filter((g) => !merged.has(g.key));

  async function handleMerge(group: DuplicateGroup, keepId: string) {
    if (!isAdmin) return;
    setMerging(group.key);
    const removeIds = group.contacts
      .filter((c) => c.id !== keepId)
      .map((c) => c.id);
    try {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keepId, removeIds }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Merge failed");
      toast.success(`Merged ${removeIds.length + 1} contacts into one.`);
      setMerged((prev) => new Set(prev).add(group.key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not merge.");
    } finally {
      setMerging(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={saPath("/contacts")}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to contacts
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Duplicate contacts
        </h1>
        <p className="text-sm text-muted-foreground">
          Contacts that share the same email or phone number. Pick one to keep —
          deals, notes, and activities from the others get moved over, then the
          duplicates are deleted.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/40" />
          ))}
        </div>
      ) : activeGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-base font-semibold">No duplicates found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your contact list is clean — no contacts share an email or phone
            number.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Found <strong>{activeGroups.length}</strong> group
            {activeGroups.length === 1 ? "" : "s"} of potential duplicates.
          </p>

          {activeGroups.map((group) => (
            <div
              key={group.key}
              className="rounded-2xl border bg-card p-5 space-y-3"
            >
              <div className="flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Matching {group.matchType}
                </span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {group.matchValue}
                </code>
              </div>

              <div className="space-y-2">
                {group.contacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={saPath(`/contacts/${c.id}`)}
                        className="text-sm font-medium hover:text-primary hover:underline"
                      >
                        {c.name || "Unnamed"}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.email || "no email"}
                        {c.phone ? ` · ${c.phone}` : ""}
                        {c.company ? ` · ${c.company}` : ""}
                        {" · "}
                        Added {formatContactDate(c.createdAt)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Source: {c.source || "unknown"}
                        {c.tags?.length ? ` · Tags: ${c.tags.join(", ")}` : ""}
                      </p>
                    </div>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-xs"
                        disabled={merging === group.key}
                        onClick={() => handleMerge(group, c.id)}
                      >
                        {merging === group.key ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3 w-3" />
                        )}
                        Keep this one
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
