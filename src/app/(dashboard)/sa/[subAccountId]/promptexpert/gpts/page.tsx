"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Bot, MessageSquare } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { useAuth } from "@/hooks/use-auth";
import {
  subscribeToPeGpts,
  subscribeToPePrompts,
  subscribeToPeGems,
  subscribeToPeSkills,
} from "@/lib/firestore/promptexpert";
import type { PeGpt, PePrompt, PeGem, PeSkill } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";

const MAX_REFS = 20;

/** Toggles `id` in `list`, refusing to add past `MAX_REFS`. */
function toggleRef(list: string[], id: string): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (list.length >= MAX_REFS) return list;
  return [...list, id];
}

export default function GptsPage() {
  const { subAccountId, agencyId, isAdmin, saPath } = useSubAccount();
  const { user } = useAuth();
  const [rows, setRows] = useState<PeGpt[] | null>(null);
  const [prompts, setPrompts] = useState<PePrompt[]>([]);
  const [gems, setGems] = useState<PeGem[]>([]);
  const [skills, setSkills] = useState<PeSkill[]>([]);
  const [editing, setEditing] = useState<PeGpt | null>(null);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basePromptId, setBasePromptId] = useState("");
  const [pinnedGemIds, setPinnedGemIds] = useState<string[]>([]);
  const [allowedSkillIds, setAllowedSkillIds] = useState<string[]>([]);
  const [creditCostPerMessage, setCreditCostPerMessage] = useState("1");
  const [saving, setSaving] = useState(false);

  const saveGeneration = useRef(0);

  const scope = useMemo(
    () => ({ agencyId: agencyId ?? "", subAccountId }),
    [agencyId, subAccountId],
  );

  useEffect(() => {
    if (!agencyId || !subAccountId) return;
    return subscribeToPeGpts(scope, setRows);
  }, [scope, agencyId, subAccountId]);

  // Prompts/gems/skills are only needed to populate the admin-only builder
  // Sheet, so skip these reads entirely for non-admin members.
  useEffect(() => {
    if (!agencyId || !subAccountId || !isAdmin) return;
    return subscribeToPePrompts(scope, setPrompts);
  }, [scope, agencyId, subAccountId, isAdmin]);

  useEffect(() => {
    if (!agencyId || !subAccountId || !isAdmin) return;
    return subscribeToPeGems(scope, setGems);
  }, [scope, agencyId, subAccountId, isAdmin]);

  useEffect(() => {
    if (!agencyId || !subAccountId || !isAdmin) return;
    return subscribeToPeSkills(scope, setSkills);
  }, [scope, agencyId, subAccountId, isAdmin]);

  function openFor(g: PeGpt | null) {
    saveGeneration.current += 1;
    setEditing(g);
    setName(g?.name ?? "");
    setDescription(g?.description ?? "");
    setBasePromptId(g?.basePromptId ?? "");
    setPinnedGemIds(g?.pinnedGemIds ?? []);
    setAllowedSkillIds(g?.allowedSkillIds ?? []);
    setCreditCostPerMessage(g ? String(g.creditCostPerMessage) : "1");
    setOpen(true);
  }

  async function save() {
    if (!user || !agencyId) { toast.error("Still loading your workspace — try again in a second."); return; }
    if (!name.trim()) { toast.error("Name is required."); return; }
    const gen = saveGeneration.current;
    setSaving(true);
    try {
      const parsedCreditCost = Math.max(0, Math.trunc(Number(creditCostPerMessage) || 0));
      const body = {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        basePromptId: basePromptId || null,
        pinnedGemIds,
        allowedSkillIds,
        creditCostPerMessage: parsedCreditCost,
      };
      const res = await fetch(`/api/sub-accounts/${subAccountId}/promptexpert/gpts`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...body, gptId: editing.id } : body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (gen !== saveGeneration.current) return;
      if (res.ok) {
        toast.success(editing ? "GPT updated" : "GPT created");
        setOpen(false);
      } else if (res.status === 422) {
        toast.error(`Reference problem: ${resBody.detail}`);
      } else {
        toast.error("Save failed — check your input and try again.");
      }
    } catch {
      if (gen !== saveGeneration.current) return;
      toast.error("Network error — please try again.");
    } finally {
      if (gen === saveGeneration.current) setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">GPTs</h1>
            <p className="text-sm text-muted-foreground">
              Chat assistants built from a base prompt, pinned gems, and a per-message credit price.
            </p>
          </div>
          {isAdmin && (
            <SheetTrigger render={<Button onClick={() => openFor(null)} />}>
              <Plus className="mr-1 h-4 w-4" />
              New GPT
            </SheetTrigger>
          )}
        </div>

        {rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState isAdmin={isAdmin} onCreate={() => openFor(null)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((gpt) => (
              <GptCard
                key={gpt.id}
                gpt={gpt}
                isAdmin={isAdmin}
                chatHref={saPath(`/promptexpert/gpts/${gpt.id}`)}
                onEdit={() => openFor(gpt)}
              />
            ))}
          </div>
        )}
      </div>

      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit GPT" : "New GPT"}</SheetTitle>
          <SheetDescription>
            Combine a base prompt, pinned gems, and a credit price into a runnable chat assistant.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 overflow-y-auto p-4 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="gpt-name">Name</Label>
            <Input
              id="gpt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sales Coach"
              autoFocus
              aria-required="true"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gpt-description">Description</Label>
            <Input
              id="gpt-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — what this GPT is for"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gpt-base-prompt">Base prompt</Label>
            <select
              id="gpt-base-prompt"
              value={basePromptId}
              onChange={(e) => setBasePromptId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">None</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Pinned gems</Label>
            <p className="text-xs text-muted-foreground">Up to {MAX_REFS} gems.</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
              {gems.length === 0 ? (
                <p className="p-1 text-xs text-muted-foreground">No gems yet.</p>
              ) : (
                gems.map((gem) => {
                  const checked = pinnedGemIds.includes(gem.id);
                  const disabled = !checked && pinnedGemIds.length >= MAX_REFS;
                  return (
                    <label
                      key={gem.id}
                      htmlFor={`gpt-gem-${gem.id}`}
                      className={`flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50${disabled ? " opacity-50" : ""}`}
                    >
                      <input
                        id={`gpt-gem-${gem.id}`}
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => setPinnedGemIds((v) => toggleRef(v, gem.id))}
                        className="h-4 w-4 rounded border-input"
                      />
                      {gem.name}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Skills (reserved for tool use — coming soon)</Label>
            <p className="text-xs text-muted-foreground">Up to {MAX_REFS} skills.</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
              {skills.length === 0 ? (
                <p className="p-1 text-xs text-muted-foreground">No skills yet.</p>
              ) : (
                skills.map((skill) => {
                  const checked = allowedSkillIds.includes(skill.id);
                  const disabled = !checked && allowedSkillIds.length >= MAX_REFS;
                  return (
                    <label
                      key={skill.id}
                      htmlFor={`gpt-skill-${skill.id}`}
                      className={`flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50${disabled ? " opacity-50" : ""}`}
                    >
                      <input
                        id={`gpt-skill-${skill.id}`}
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => setAllowedSkillIds((v) => toggleRef(v, skill.id))}
                        className="h-4 w-4 rounded border-input"
                      />
                      {skill.name}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gpt-credit-cost">Credit cost per message</Label>
            <Input
              id="gpt-credit-cost"
              type="number"
              min={0}
              step={1}
              value={creditCostPerMessage}
              onChange={(e) => setCreditCostPerMessage(e.target.value)}
              aria-describedby="gpt-credit-cost-hint"
            />
            <p id="gpt-credit-cost-hint" className="text-xs text-muted-foreground">
              Whole number, minimum 0 — decimals are rounded down.
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

function GptCard({
  gpt,
  isAdmin,
  chatHref,
  onEdit,
}: {
  gpt: PeGpt;
  isAdmin: boolean;
  chatHref: string;
  onEdit: () => void;
}) {
  return (
    <div className="group flex flex-col rounded-2xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
          <Bot className="h-4 w-4" />
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {gpt.pinnedGemIds.length} gems
        </Badge>
      </div>
      <h3 className="mt-3 truncate font-semibold">{gpt.name}</h3>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {gpt.description ?? "No description"}
      </p>
      <div className="mt-3">
        <Badge variant="outline">{gpt.creditCostPerMessage} credit/message</Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Button size="sm" render={<Link href={chatHref} />}>
          <MessageSquare className="mr-1 h-3.5 w-3.5" />
          Chat
        </Button>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>
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
        <Bot className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold">
        {isAdmin ? "Create your first GPT" : "No GPTs yet"}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Combine a base prompt, pinned gems, and a credit price into a runnable chat assistant."
          : "An admin hasn't added any GPTs for this sub-account yet."}
      </p>
      {isAdmin && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <SheetTrigger render={<Button onClick={onCreate} />}>
            <Plus className="mr-1 h-4 w-4" />
            New GPT
          </SheetTrigger>
        </div>
      )}
    </div>
  );
}
