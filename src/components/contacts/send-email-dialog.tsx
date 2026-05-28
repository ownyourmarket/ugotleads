"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Contact } from "@/types/contacts";

const QUICK_TEMPLATES = [
  {
    label: "Follow-up after call",
    subject: "Great chatting with you!",
    body: "Hi {{name}},\n\nThanks for taking the time to speak with me today. I really enjoyed learning more about your business.\n\nAs discussed, I'll follow up with the details shortly. In the meantime, don't hesitate to reach out if you have any questions.\n\nBest regards",
  },
  {
    label: "Introduction",
    subject: "Quick introduction — let's connect",
    body: "Hi {{name}},\n\nMy name is [Your Name] and I help businesses like yours [brief value prop].\n\nI'd love to learn more about what you're working on and see if there's a way I can help. Would you be open to a quick 15-minute call this week?\n\nLooking forward to hearing from you!",
  },
  {
    label: "Check-in",
    subject: "Just checking in",
    body: "Hi {{name}},\n\nHope you're doing well! I wanted to check in and see how things are going.\n\nIs there anything I can help with? I'm always just a message away.\n\nBest regards",
  },
  {
    label: "Thank you",
    subject: "Thank you!",
    body: "Hi {{name}},\n\nJust a quick note to say thank you for your business. We truly appreciate your trust and support.\n\nIf there's ever anything else we can do for you, please don't hesitate to reach out.\n\nWarm regards",
  },
  {
    label: "Meeting request",
    subject: "Can we schedule a quick call?",
    body: "Hi {{name}},\n\nI'd love to set up a brief call to discuss how we can help you achieve your goals.\n\nWould any of these times work for you?\n- [Option 1]\n- [Option 2]\n- [Option 3]\n\nLooking forward to connecting!",
  },
];

interface SendEmailDialogProps {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendEmailDialog({
  contact,
  open,
  onOpenChange,
}: SendEmailDialogProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setSubject("");
      setBody("");
      setApiError(null);
      setErrors({});
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!subject.trim()) next.subject = "Subject is required";
    if (!body.trim()) next.body = "Message is required";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSending(true);
    setApiError(null);
    try {
      const res = await fetch("/api/comms/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId: contact.id,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setApiError(data.error ?? "Couldn't send. Try again.");
        return;
      }
      toast.success(`Email sent to ${contact.email}`);
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setApiError("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Mail className="h-4 w-4" />
            </span>
            Send email
          </DialogTitle>
          <DialogDescription>
            Replies go straight to your inbox — the recipient sees your email
            address on the Reply-To header.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-to">To</Label>
            <Input
              id="email-to"
              value={contact.email}
              disabled
              className="cursor-not-allowed text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Quick template</Label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => {
                    const firstName = contact.name?.split(" ")[0] ?? "there";
                    setSubject(tpl.subject);
                    setBody(tpl.body.replace(/\{\{name\}\}/g, firstName));
                  }}
                  className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-subject">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Following up on our call"
              aria-invalid={!!errors.subject}
            />
            {errors.subject && (
              <p className="text-xs text-destructive">{errors.subject}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-body">
              Message <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi there,&#10;&#10;Thanks for chatting today…"
              rows={8}
              aria-invalid={!!errors.body}
            />
            {errors.body && (
              <p className="text-xs text-destructive">{errors.body}</p>
            )}
          </div>

          {apiError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {apiError}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send email"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
