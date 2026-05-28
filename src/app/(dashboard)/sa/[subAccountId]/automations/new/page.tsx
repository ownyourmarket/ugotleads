"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  ArrowLeft,
  Mail,
  MessageSquare,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { getFirebaseDb } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LeadNurtureConfig, MessageTemplateDoc } from "@/types";
import type { LeadForm } from "@/types/forms";

interface StepDraft {
  key: string;
  channel: "email" | "sms";
  templateId: string;
  delayDays: number;
  delayHours: number;
}

let nextKey = 0;
function makeKey() {
  return `step-${++nextKey}`;
}

const DEFAULT_STEPS: StepDraft[] = [
  { key: makeKey(), channel: "email", templateId: "", delayDays: 2, delayHours: 0 },
  { key: makeKey(), channel: "email", templateId: "", delayDays: 5, delayHours: 0 },
  { key: makeKey(), channel: "sms", templateId: "", delayDays: 10, delayHours: 0 },
];

export default function NewAutomationPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { agencyId, subAccountId, isAdmin, saPath } = useSubAccount();
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [smsTemplates, setSmsTemplates] = useState<MessageTemplateDoc[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<MessageTemplateDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("Lead Nurture Sequence");
  const [formId, setFormId] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>(DEFAULT_STEPS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    const db = getFirebaseDb();
    let formsReady = false;
    let tplReady = false;
    const settle = () => {
      if (formsReady && tplReady) setLoading(false);
    };

    const unsubForms = onSnapshot(
      query(collection(db, "forms"), where("subAccountId", "==", subAccountId)),
      (snap) => {
        setForms(snap.docs.map((d) => d.data() as LeadForm));
        formsReady = true;
        settle();
      },
      () => { formsReady = true; settle(); },
    );

    const unsubTpl = onSnapshot(
      query(
        collection(db, "message_templates"),
        where("subAccountId", "==", subAccountId),
      ),
      (snap) => {
        const all = snap.docs.map((d) => d.data() as MessageTemplateDoc);
        setSmsTemplates(all.filter((t) => t.type === "sms"));
        setEmailTemplates(all.filter((t) => t.type === "email"));
        tplReady = true;
        settle();
      },
      () => { tplReady = true; settle(); },
    );

    return () => { unsubForms(); unsubTpl(); };
  }, [user, agencyId, subAccountId, authLoading]);

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { key: makeKey(), channel: "email", templateId: "", delayDays: 0, delayHours: 0 },
    ]);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function updateStep(key: string, patch: Partial<StepDraft>) {
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Name is required."); return; }
    if (!formId) { toast.error("Pick a form trigger."); return; }

    const configuredSteps = steps.filter((s) => s.templateId);
    if (configuredSteps.length === 0) {
      toast.error("Add at least one step with a template.");
      return;
    }

    setSaving(true);
    try {
      const config: LeadNurtureConfig = {
        steps: configuredSteps.map((s) => ({
          channel: s.channel,
          templateId: s.templateId,
          delaySeconds: s.delayDays * 86400 + s.delayHours * 3600,
        })),
      };

      const ref = await addDoc(collection(getFirebaseDb(), "automations"), {
        agencyId,
        subAccountId,
        recipeType: "lead_nurture",
        name: name.trim(),
        enabled: false,
        trigger: { type: "form_submit", formId },
        config,
        createdByUid: user?.uid ?? "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(getFirebaseDb(), "automations", ref.id), {
        id: ref.id,
      });

      toast.success("Lead Nurture automation created.");
      router.push(saPath("/automations"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Only sub-account admins can create automations.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={saPath("/automations")}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to automations
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          New Lead Nurture automation
        </h1>
        <p className="text-sm text-muted-foreground">
          Build a multi-step drip sequence that fires over days after a form
          submission.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name + trigger */}
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="auto-name">Automation name</Label>
            <Input
              id="auto-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lead Nurture Sequence"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-trigger">Form trigger</Label>
            <select
              id="form-trigger"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Select a form —</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {forms.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No forms yet.{" "}
                <Link
                  href={saPath("/forms")}
                  className="text-primary underline"
                >
                  Create one first
                </Link>
                .
              </p>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Nurture steps</h2>
              <p className="text-xs text-muted-foreground">
                Each step fires at a set delay from the form submission. Steps
                without a template are skipped.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addStep}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add step
            </Button>
          </div>

          {steps.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No steps yet. Click &quot;Add step&quot; to begin.
            </p>
          )}

          <div className="space-y-3">
            {steps.map((step, i) => {
              const templates =
                step.channel === "email" ? emailTemplates : smsTemplates;
              return (
                <div
                  key={step.key}
                  className="rounded-lg border bg-background p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {step.channel === "email" ? (
                        <Mail className="h-4 w-4 text-blue-500" />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-emerald-500" />
                      )}
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Step {i + 1}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeStep(step.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Remove step</span>
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Channel</Label>
                      <select
                        value={step.channel}
                        onChange={(e) =>
                          updateStep(step.key, {
                            channel: e.target.value as "email" | "sms",
                            templateId: "",
                          })
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Template</Label>
                      <select
                        value={step.templateId}
                        onChange={(e) =>
                          updateStep(step.key, { templateId: e.target.value })
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">— Select —</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      {templates.length === 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          No {step.channel} templates.{" "}
                          <Link
                            href={saPath("/automations/templates/new")}
                            className="text-primary underline"
                          >
                            Create one
                          </Link>
                          .
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Delay from form submission</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={step.delayDays}
                        onChange={(e) =>
                          updateStep(step.key, {
                            delayDays: Number(e.target.value) || 0,
                          })
                        }
                        className="max-w-[100px]"
                      />
                      <span className="text-sm text-muted-foreground">days</span>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={step.delayHours}
                        onChange={(e) =>
                          updateStep(step.key, {
                            delayHours: Number(e.target.value) || 0,
                          })
                        }
                        className="max-w-[100px]"
                      />
                      <span className="text-sm text-muted-foreground">hours</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      How long after the trigger should this step fire?
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            render={<Link href={saPath("/automations")} />}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="mr-1 h-3.5 w-3.5" />
            {saving ? "Creating…" : "Create automation"}
          </Button>
        </div>
      </form>
    </div>
  );
}
