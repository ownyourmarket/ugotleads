"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Gem as GemIcon } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToPeGems, createPeGem, updatePeGem } from "@/lib/firestore/promptexpert";
import { GEM_TYPES, PE_GEM_MAX_CHARS, type PeGem, type GemType } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";

export default function GemsPage() {
  const { subAccountId, agencyId, isAdmin } = useSubAccount();
  const { user } = useAuth();
  const [rows, setRows] = useState<PeGem[] | null>(null);
  const [editing, setEditing] = useState<PeGem | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [gemType, setGemType] = useState<GemType>("Custom Data");
  const [dataContent, setDataContent] = useState("");
  const [saving, setSaving] = useState(false);

  const scope = useMemo(
    () => ({ agencyId: agencyId ?? "", subAccountId }),
    [agencyId, subAccountId],
  );

  useEffect(() => {
    if (!agencyId || !subAccountId) return;
    return subscribeToPeGems(scope, setRows);
  }, [scope, agencyId, subAccountId]);

  function openFor(g: PeGem | null) {
    setEditing(g);
    setName(g?.name ?? "");
    setGemType(g?.gemType ?? "Custom Data");
    setDataContent(g?.dataContent ?? "");
    setOpen(true);
  }

  async function save() {
    if (!user || !agencyId) { toast.error("Still loading your workspace — try again in a second."); return; }
    if (!name.trim() || !dataContent.trim()) { toast.error("Name and content are required."); return; }
    if (dataContent.length > PE_GEM_MAX_CHARS) { toast.error("Gem is over the 50,000 character limit."); return; }
    setSaving(true);
    try {
      if (editing) {
        await updatePeGem(scope, editing.id, { name: name.trim(), gemType, dataContent });
        toast.success("Gem updated");
      } else {
        await createPeGem(scope, user.uid, { name: name.trim(), gemType, dataContent });
        toast.success("Gem created");
      }
      setOpen(false);
    } catch { toast.error("Save failed — check your permissions and try again."); }
    finally { setSaving(false); }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Gems</h1>
            <p className="text-sm text-muted-foreground">
              Reusable context blocks you can pull into prompts and skills with @mentions.
            </p>
          </div>
          {isAdmin && (
            <SheetTrigger render={<Button onClick={() => openFor(null)} />}>
              <Plus className="mr-1 h-4 w-4" />
              New gem
            </SheetTrigger>
          )}
        </div>

        {rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState isAdmin={isAdmin} onCreate={() => openFor(null)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((gem) => (
              <GemCard
                key={gem.id}
                gem={gem}
                isAdmin={isAdmin}
                onEdit={() => openFor(gem)}
              />
            ))}
          </div>
        )}
      </div>

      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit gem" : "New gem"}</SheetTitle>
          <SheetDescription>
            Store context once, then pull it into any prompt or skill with @mentions.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 overflow-y-auto p-4 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="gem-name">Name</Label>
            <Input
              id="gem-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Brand Bio"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              You&apos;ll reference this as @Name in prompts and skills.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gem-type">Type</Label>
            <select
              id="gem-type"
              value={gemType}
              onChange={(e) => setGemType(e.target.value as GemType)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {GEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gem-content">Content</Label>
            <Textarea
              id="gem-content"
              rows={14}
              value={dataContent}
              onChange={(e) => setDataContent(e.target.value)}
              placeholder="Paste the context you want available via @mention…"
              className="font-mono"
            />
            <p className={dataContent.length > PE_GEM_MAX_CHARS ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {dataContent.length.toLocaleString()} / {PE_GEM_MAX_CHARS.toLocaleString()} characters
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function GemCard({
  gem,
  isAdmin,
  onEdit,
}: {
  gem: PeGem;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="group flex flex-col rounded-2xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
          <GemIcon className="h-4 w-4" />
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {gem.gemType}
        </Badge>
      </div>
      <h3 className="mt-3 truncate font-semibold">{gem.name}</h3>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {gem.dataContent}
      </p>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {gem.dataContent.length.toLocaleString()} / {PE_GEM_MAX_CHARS.toLocaleString()} characters
      </p>

      {isAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-2xl border bg-muted/30"
        />
      ))}
    </div>
  );
}

function EmptyState({
  isAdmin,
  onCreate,
}: {
  isAdmin: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-pink-500/5 p-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
        <GemIcon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold">
        {isAdmin ? "Create your first gem" : "No gems yet"}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Store reusable context — brand bios, personas, technical docs — your team can pull in with @mentions."
          : "An admin hasn't added any gems for this sub-account yet."}
      </p>
      {isAdmin && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <SheetTrigger render={<Button onClick={onCreate} />}>
            <Plus className="mr-1 h-4 w-4" />
            New gem
          </SheetTrigger>
        </div>
      )}
    </div>
  );
}
