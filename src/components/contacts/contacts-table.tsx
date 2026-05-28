"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Download,
  Loader2,
  Mail,
  Phone,
  Building2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Contact } from "@/types/contacts";
import { SourceBadge } from "@/components/contacts/source-badge";
import { formatContactDate, toDate } from "@/lib/format";
import { serializeCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useSubAccount } from "@/context/sub-account-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
interface Props {
  contacts: Contact[];
  search: string;
  tagFilter?: string | null;
}

export function ContactsTable({ contacts, search, tagFilter }: Props) {
  const { saPath } = useSubAccount();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const columns = useMemo<ColumnDef<Contact>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomePageRowsSelected();
            }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            aria-label="Select all"
            className="h-4 w-4 accent-primary rounded"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select row"
            className="h-4 w-4 accent-primary rounded"
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: "Name",
        enableSorting: true,
        cell: ({ row }) => (
          <Link
            href={saPath(`/contacts/${row.original.id}`)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.name || "Unnamed"}
          </Link>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.email ? (
            <span className="text-sm text-muted-foreground">
              {row.original.email}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.phone ? (
            <span className="text-sm text-muted-foreground">
              {row.original.phone}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "company",
        header: "Company",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.company ? (
            <span className="text-sm">{row.original.company}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "source",
        header: "Source",
        enableSorting: false,
        cell: ({ row }) => <SourceBadge source={row.original.source} />,
      },
      {
        accessorKey: "tags",
        header: "Tags",
        enableSorting: false,
        cell: ({ row }) => {
          const tags = row.original.tags ?? [];
          if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 3).map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                  {t}
                </span>
              ))}
              {tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "Added",
        enableSorting: true,
        sortingFn: (a, b) => {
          const aVal = toMillis(a.original.createdAt);
          const bVal = toMillis(b.original.createdAt);
          return aVal - bVal;
        },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatContactDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [saPath],
  );

  const filtered = useMemo(() => {
    let result = contacts;
    if (tagFilter) {
      result = result.filter((c) => (c.tags ?? []).includes(tagFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((c) => {
        return (
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.company?.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [contacts, search, tagFilter]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const selectedContacts = filtered.filter((c) => selectedIds.includes(c.id));

  /* ── Bulk action state ───────────────────────────────────── */
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  async function handleBulkTag() {
    const tag = bulkTagValue.trim();
    if (!tag) { toast.error("Enter a tag name."); return; }
    setBulkBusy(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tag", contactIds: selectedIds, tag }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; updated?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed");
      toast.success(`Tagged ${data.updated} contacts with "${tag}"`);
      setRowSelection({});
      setBulkTagOpen(false);
      setBulkTagValue("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not tag.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkDelete() {
    if (
      !confirm(
        `Permanently delete ${selectedIds.length} contact(s) and all their deals, notes, and activities? This cannot be undone.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", contactIds: selectedIds }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; deleted?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed");
      toast.success(`Deleted ${data.deleted} contacts.`);
      setRowSelection({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBulkBusy(false);
    }
  }

  function handleExportSelected() {
    const headers = ["name", "email", "phone", "company", "source", "tags", "createdAt"];
    const rows = selectedContacts.map((c) => ({
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      source: c.source,
      tags: c.tags ?? [],
      createdAt: toDate(c.createdAt)?.toISOString() ?? "",
    }));
    const csv = serializeCsv(headers, rows);
    downloadCsv(`contacts-export-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(`Exported ${rows.length} contacts.`);
  }

  if (contacts.length === 0) {
    return null;
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No contacts match &ldquo;{search}&rdquo;.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CheckSquare className="h-4 w-4 text-primary" />
            {selectedIds.length} selected
          </span>
          <span className="mx-1 h-4 w-px bg-border" />
          {bulkTagOpen ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={bulkTagValue}
                onChange={(e) => setBulkTagValue(e.target.value)}
                placeholder="Tag name"
                className="h-7 w-36 text-xs"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleBulkTag(); }
                  if (e.key === "Escape") setBulkTagOpen(false);
                }}
              />
              <Button size="sm" className="h-7 text-xs" onClick={handleBulkTag} disabled={bulkBusy}>
                {bulkBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Tag className="mr-1 h-3 w-3" />}
                Apply
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkTagOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBulkTagOpen(true)}>
              <Tag className="mr-1 h-3 w-3" />
              Tag
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportSelected}>
            <Download className="mr-1 h-3 w-3" />
            Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-destructive hover:bg-destructive/10"
            onClick={handleBulkDelete}
            disabled={bulkBusy}
          >
            {bulkBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
            Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setRowSelection({})}>
            Clear selection
          </Button>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "px-4 py-3 font-semibold",
                        canSort && "cursor-pointer select-none hover:text-foreground",
                      )}
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {canSort &&
                          (sorted === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          ))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b last:border-b-0 transition-colors hover:bg-muted/30"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {table.getRowModel().rows.map((row) => {
          const c = row.original;
          return (
            <Link
              key={c.id}
              href={saPath(`/contacts/${c.id}`)}
              className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name || "Unnamed"}</p>
                  {c.email && (
                    <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      {c.email}
                    </p>
                  )}
                  {c.phone && (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      {c.phone}
                    </p>
                  )}
                  {c.company && (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      {c.company}
                    </p>
                  )}
                </div>
                <SourceBadge source={c.source} />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const maybe = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === "function") return maybe.toDate().getTime();
  if (typeof maybe.seconds === "number") return maybe.seconds * 1000;
  return 0;
}
