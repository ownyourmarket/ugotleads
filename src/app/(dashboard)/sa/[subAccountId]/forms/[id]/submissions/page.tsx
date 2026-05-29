"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Inbox, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import {
  subscribeToForm,
  subscribeToSubmissions,
} from "@/lib/firestore/forms";
import { subscribeToContacts } from "@/lib/firestore/contacts";
import { toDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { LeadForm, FormSubmission } from "@/types/forms";
import type { Contact } from "@/types/contacts";

export default function FormSubmissionsPage({
  params,
}: {
  params: Promise<{ id: string; subAccountId: string }>;
}) {
  const { id } = use(params);
  const { user, loading: authLoading } = useAuth();
  const { agencyId, saPath } = useSubAccount();
  const [form, setForm] = useState<LeadForm | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    let formReady = false;
    let subsReady = false;
    const settle = () => {
      if (formReady && subsReady) setLoading(false);
    };
    const unsubForm = subscribeToForm(id, (f) => {
      setForm(f);
      formReady = true;
      settle();
    });
    const unsubSubs = subscribeToSubmissions(id, (list) => {
      setSubmissions(list);
      subsReady = true;
      settle();
    });
    return () => {
      unsubForm();
      unsubSubs();
    };
  }, [id, user, agencyId, authLoading]);

  // Subscribe to contacts so we can show linked contact names
  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    const unsub = subscribeToContacts(
      { agencyId, subAccountId: form?.subAccountId ?? "" },
      setContacts,
    );
    return () => unsub();
  }, [user, agencyId, form?.subAccountId, authLoading]);

  const contactsById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  // Derive ordered field labels from the form definition
  const fieldLabels = useMemo(() => {
    if (!form) return [];
    return form.fields.map((f) => ({ id: f.id, label: f.label }));
  }, [form]);

  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" render={<Link href={saPath("/forms")} />}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to forms
        </Button>
        <p className="text-sm text-muted-foreground">Form not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" render={<Link href={saPath(`/forms/${id}`)} />}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {form.name} — Submissions
            </h1>
            <p className="text-sm text-muted-foreground">
              {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Inbox className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold">No submissions yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Share the public form link — submissions will appear here in real time.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  {fieldLabels.map((f) => (
                    <th key={f.id} className="px-4 py-3 font-semibold">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub, idx) => {
                  const contact = sub.contactId
                    ? contactsById.get(sub.contactId)
                    : null;
                  const date = toDate(sub.createdAt);
                  return (
                    <tr
                      key={sub.id}
                      className="border-b last:border-b-0 transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {submissions.length - idx}
                      </td>
                      {fieldLabels.map((f) => (
                        <td key={f.id} className="max-w-[200px] truncate px-4 py-3">
                          {sub.values[f.id] || (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {contact ? (
                          <Link
                            href={saPath(`/contacts/${contact.id}`)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                          >
                            <User className="h-3 w-3" />
                            {contact.name || contact.email || "Contact"}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {date
                          ? date.toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="space-y-3 md:hidden">
            {submissions.map((sub, idx) => {
              const contact = sub.contactId
                ? contactsById.get(sub.contactId)
                : null;
              const date = toDate(sub.createdAt);
              const isOpen = expanded === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : sub.id)}
                  className="w-full rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        #{submissions.length - idx}
                        {" · "}
                        {sub.values[fieldLabels[0]?.id] || "Submission"}
                      </p>
                      {date && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {date.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                    {contact && (
                      <Link
                        href={saPath(`/contacts/${contact.id}`)}
                        className="text-xs text-muted-foreground hover:text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {contact.name || contact.email || "Contact"}
                      </Link>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-1.5 border-t pt-3">
                      {fieldLabels.map((f) => (
                        <div key={f.id} className="flex gap-2 text-sm">
                          <span className="shrink-0 font-medium text-muted-foreground">
                            {f.label}:
                          </span>
                          <span className="min-w-0 break-words">
                            {sub.values[f.id] || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// React 19 use() for unwrapping the params promise
import { use } from "react";
