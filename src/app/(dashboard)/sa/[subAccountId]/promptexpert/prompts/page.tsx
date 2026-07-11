"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Sparkles } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToPePrompts, createPePrompt, updatePePrompt } from "@/lib/firestore/promptexpert";
import type { PePrompt } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";

/** Split prompt text so [Variable] slots can be rendered highlighted. */
export function splitSlots(content: string): Array<{ text: string; isSlot: boolean }> {
  const parts: Array<{ text: string; isSlot: boolean }> = [];
  const re = /\[([A-Za-z0-9_ ]+)\]/g;
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), isSlot: false });
    parts.push({ text: m[0], isSlot: true });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last), isSlot: false });
  return parts;
}

export default function PromptsPage() {
  const { subAccountId, agencyId, isAdmin } = useSubAccount();
  const { user } = useAuth();
  const [rows, setRows] = useState<PePrompt[] | null>(null);
  const [editing, setEditing] = useState<PePrompt | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("General");
  const [tagsRaw, setTagsRaw] = useState("");

  const scope = useMemo(
    () => ({ agencyId: agencyId ?? "", subAccountId }),
    [agencyId, subAccountId],
  );

  useEffect(() => {
    if (!agencyId || !subAccountId) return;
    return subscribeToPePrompts(scope, setRows);
  }, [scope, agencyId, subAccountId]);

  function openFor(p: PePrompt | null) {
    setEditing(p);
    setTitle(p?.title ?? "");
    setContent(p?.content ?? "");
    setCategory(p?.category ?? "General");
    setTagsRaw(p?.tags?.join(", ") ?? "");
    setOpen(true);
  }

  async function save() {
    if (!title.trim() || !content.trim()) { toast.error("Title and content are required."); return; }
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      if (editing) {
        await updatePePrompt(scope, editing.id, { title: title.trim(), content, category: category.trim() || "General", tags });
        toast.success("Prompt updated");
      } else {
        await createPePrompt(scope, user!.uid, { title: title.trim(), content, category: category.trim() || "General", tags });
        toast.success("Prompt created");
      }
      setOpen(false);
    } catch { toast.error("Save failed — check your permissions and try again."); }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prompts</h1>
            <p className="text-sm text-muted-foreground">
              Reusable templates with [Variable] slots your team can fill in fast.
            </p>
          </div>
          {isAdmin && (
            <SheetTrigger render={<Button onClick={() => openFor(null)} />}>
              <Plus className="mr-1 h-4 w-4" />
              New prompt
            </SheetTrigger>
          )}
        </div>

        {rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState isAdmin={isAdmin} onCreate={() => openFor(null)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isAdmin={isAdmin}
                onEdit={() => openFor(prompt)}
              />
            ))}
          </div>
        )}
      </div>

      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit prompt" : "New prompt"}</SheetTitle>
          <SheetDescription>
            Use square brackets like [First_Name] to mark fill-in-the-blank slots.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 overflow-y-auto p-4 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="prompt-title">Title</Label>
            <Input
              id="prompt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cold outreach opener"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-category">Category</Label>
              <Input
                id="prompt-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="General"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-tags">Tags</Label>
              <Input
                id="prompt-tags"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="sales, onboarding"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prompt-content">Content</Label>
            <Textarea
              id="prompt-content"
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"Hello [First_Name], welcome to [Company]!"}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Preview</Label>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {content.trim() ? (
                splitSlots(content).map((part, i) =>
                  part.isSlot ? (
                    <span
                      key={i}
                      className="rounded bg-amber-500/10 px-1 text-amber-600 dark:text-amber-400"
                    >
                      {part.text}
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )
              ) : (
                <span className="text-muted-foreground">Nothing to preview yet.</span>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PromptCard({
  prompt,
  isAdmin,
  onEdit,
}: {
  prompt: PePrompt;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="group flex flex-col rounded-2xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
          <Sparkles className="h-4 w-4" />
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {prompt.category}
        </Badge>
      </div>
      <h3 className="mt-3 truncate font-semibold">{prompt.title}</h3>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {splitSlots(prompt.content).map((part, i) =>
          part.isSlot ? (
            <span
              key={i}
              className="rounded bg-amber-500/10 px-1 text-amber-600 dark:text-amber-400"
            >
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      {prompt.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {prompt.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}

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
        <Sparkles className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold">
        {isAdmin ? "Create your first prompt" : "No prompts yet"}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Build a reusable template with [Variable] slots your team can fill in fast."
          : "An admin hasn't added any prompt templates for this sub-account yet."}
      </p>
      {isAdmin && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <SheetTrigger render={<Button onClick={onCreate} />}>
            <Plus className="mr-1 h-4 w-4" />
            New prompt
          </SheetTrigger>
        </div>
      )}
    </div>
  );
}
