"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Sparkles } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToPeSkills, createPeSkill, updatePeSkill } from "@/lib/firestore/promptexpert";
import { SKILL_OUTPUT_FORMATS, type PeSkill, type SkillOutputFormat } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";

export default function SkillsPage() {
  const { subAccountId, agencyId, isAdmin } = useSubAccount();
  const { user } = useAuth();
  const [rows, setRows] = useState<PeSkill[] | null>(null);
  const [editing, setEditing] = useState<PeSkill | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemInstruction, setSystemInstruction] = useState("");
  const [outputFormat, setOutputFormat] = useState<SkillOutputFormat>("Markdown");
  const [creditCost, setCreditCost] = useState("0");
  const [saving, setSaving] = useState(false);

  const scope = useMemo(
    () => ({ agencyId: agencyId ?? "", subAccountId }),
    [agencyId, subAccountId],
  );

  useEffect(() => {
    if (!agencyId || !subAccountId) return;
    return subscribeToPeSkills(scope, setRows);
  }, [scope, agencyId, subAccountId]);

  function openFor(s: PeSkill | null) {
    setEditing(s);
    setName(s?.name ?? "");
    setDescription(s?.description ?? "");
    setSystemInstruction(s?.systemInstruction ?? "");
    setOutputFormat(s?.outputFormat ?? "Markdown");
    setCreditCost(s ? String(s.creditCost) : "0");
    setOpen(true);
  }

  async function save() {
    if (!user || !agencyId) { toast.error("Still loading your workspace — try again in a second."); return; }
    if (!name.trim() || !systemInstruction.trim()) { toast.error("Name and system instruction are required."); return; }
    setSaving(true);
    try {
      const parsedCreditCost = Math.max(0, Math.trunc(Number(creditCost) || 0));
      const data = {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        systemInstruction,
        outputFormat,
        creditCost: parsedCreditCost,
      };
      if (editing) {
        await updatePeSkill(scope, editing.id, data);
        toast.success("Skill updated");
      } else {
        await createPeSkill(scope, user.uid, data);
        toast.success("Skill created");
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
            <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
            <p className="text-sm text-muted-foreground">
              Runnable actions with a system instruction, output format, and credit cost.
            </p>
          </div>
          {isAdmin && (
            <SheetTrigger render={<Button onClick={() => openFor(null)} />}>
              <Plus className="mr-1 h-4 w-4" />
              New skill
            </SheetTrigger>
          )}
        </div>

        {rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState isAdmin={isAdmin} onCreate={() => openFor(null)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isAdmin={isAdmin}
                onEdit={() => openFor(skill)}
              />
            ))}
          </div>
        )}
      </div>

      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit skill" : "New skill"}</SheetTitle>
          <SheetDescription>
            Define a runnable action with a system instruction, output format, and credit price.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 overflow-y-auto p-4 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cold Email Opener"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — what this skill is for"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-instruction">System instruction</Label>
            <Textarea
              id="skill-instruction"
              rows={10}
              value={systemInstruction}
              onChange={(e) => setSystemInstruction(e.target.value)}
              placeholder="You are an expert at…"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Supports [Variables] and @Gem mentions.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-output-format">Output format</Label>
            <select
              id="skill-output-format"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as SkillOutputFormat)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {SKILL_OUTPUT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-credit-cost">Credit cost</Label>
            <Input
              id="skill-credit-cost"
              type="number"
              min={0}
              step={1}
              value={creditCost}
              onChange={(e) => setCreditCost(e.target.value)}
            />
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

function SkillCard({
  skill,
  isAdmin,
  onEdit,
}: {
  skill: PeSkill;
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
          {skill.outputFormat}
        </Badge>
      </div>
      <h3 className="mt-3 truncate font-semibold">{skill.name}</h3>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {skill.description ?? "No description"}
      </p>
      <div className="mt-3">
        <Badge variant="outline">{skill.creditCost} credits / run</Badge>
      </div>

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
        {isAdmin ? "Create your first skill" : "No skills yet"}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Define a runnable action with a system instruction, output format, and credit price."
          : "An admin hasn't added any skills for this sub-account yet."}
      </p>
      {isAdmin && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <SheetTrigger render={<Button onClick={onCreate} />}>
            <Plus className="mr-1 h-4 w-4" />
            New skill
          </SheetTrigger>
        </div>
      )}
    </div>
  );
}
