"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { Copy, Mail, Plus, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { getFirebaseDb } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InviteDocV2, SubAccountMemberDoc } from "@/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SubAccountMembersSection() {
  const { user } = useAuth();
  const { subAccountId, isAdmin } = useSubAccount();

  const [members, setMembers] = useState<SubAccountMemberDoc[]>([]);
  const [invites, setInvites] = useState<(InviteDocV2 & { id: string })[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "collaborator">(
    "collaborator",
  );
  const [submitting, setSubmitting] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  useEffect(() => {
    if (!subAccountId || !isAdmin) return;
    const db = getFirebaseDb();
    const unsubMembers = onSnapshot(
      collection(db, `subAccounts/${subAccountId}/subAccountMembers`),
      (snap) => {
        setMembers(
          snap.docs
            .map((d) => d.data() as SubAccountMemberDoc)
            .filter((m) => m.status === "active"),
        );
      },
    );
    const unsubInvites = onSnapshot(
      query(
        collection(db, "invites"),
        where("subAccountId", "==", subAccountId),
        where("acceptedByUid", "==", null),
        where("revokedAt", "==", null),
      ),
      (snap) => {
        setInvites(
          snap.docs.map((d) => {
            const data = d.data() as InviteDocV2;
            return { ...data, id: d.id };
          }),
        );
      },
      () => setInvites([]),
    );
    return () => {
      unsubMembers();
      unsubInvites();
    };
  }, [subAccountId, isAdmin]);

  if (!isAdmin) return null;

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      toast.error("Enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        mailed?: boolean;
        inviteUrl?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "Could not invite");

      if (payload.mailed) {
        toast.success(`Invite emailed to ${email}`);
      } else if (payload.inviteUrl) {
        // Resend isn't configured (or send failed) — copy the link so the
        // admin can share it manually without leaving the page.
        try {
          await navigator.clipboard.writeText(payload.inviteUrl);
          toast.success(
            `Invite created — link copied (set RESEND_API_KEY to email automatically)`,
          );
        } catch {
          toast.success(
            `Invite created — copy the link from "Pending invites" below`,
          );
        }
      } else {
        toast.success(`Invited ${email}`);
      }
      setInviteEmail("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not invite.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyInviteLink(email: string) {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/signup?email=${encodeURIComponent(email)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access");
    }
  }

  async function revokeInvite(inviteId: string, email: string) {
    if (!confirm(`Cancel the invite for ${email}?`)) return;
    setBusyInviteId(inviteId);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/invite/${inviteId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not cancel invite");
      }
      toast.success(`Invite for ${email} cancelled`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not cancel invite.",
      );
    } finally {
      setBusyInviteId(null);
    }
  }

  async function handleRoleChange(
    uid: string,
    role: "admin" | "collaborator",
  ) {
    setBusyUid(uid);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/members/${uid}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not change role");
      }
      toast.success("Role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusyUid(null);
    }
  }

  async function handleRemove(uid: string, displayName: string) {
    if (!confirm(`Remove ${displayName} from this sub-account?`)) return;
    setBusyUid(uid);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/members/${uid}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not remove");
      }
      toast.success(`Removed ${displayName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Users className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Members</h2>
          <p className="text-xs text-muted-foreground">
            Invite teammates to this sub-account.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleInvite}
        className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border bg-background p-3"
      >
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="invite-email" className="text-xs">
            Invite by email
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role" className="text-xs">
            Role
          </Label>
          <select
            id="invite-role"
            value={inviteRole}
            onChange={(e) =>
              setInviteRole(e.target.value as "admin" | "collaborator")
            }
            className="h-9 w-36 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="collaborator">Collaborator</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          <UserPlus className="mr-1 h-4 w-4" />
          {submitting ? "Inviting…" : "Send invite"}
        </Button>
      </form>

      {invites.length > 0 && (
        <div className="mb-5 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pending invites
          </p>
          <ul className="space-y-1.5">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{inv.email}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {inv.subAccountRole}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copyInviteLink(inv.email)}
                    aria-label="Copy invite link"
                    className="h-7 px-2 text-[11px]"
                    disabled={busyInviteId === inv.id}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    Copy link
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeInvite(inv.id, inv.email)}
                    aria-label="Cancel invite"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    disabled={busyInviteId === inv.id}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Active members
        </p>
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
            No active members.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => {
              const isMe = m.uid === user?.uid;
              return (
                <li
                  key={m.uid}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {m.displayName || m.email}
                      {isMe && (
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email}
                    </p>
                  </div>
                  <select
                    value={m.role}
                    onChange={(e) =>
                      handleRoleChange(
                        m.uid,
                        e.target.value as "admin" | "collaborator",
                      )
                    }
                    disabled={isMe || busyUid === m.uid}
                    className="h-8 w-32 shrink-0 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                  >
                    <option value="collaborator">Collaborator</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isMe || busyUid === m.uid}
                    onClick={() =>
                      handleRemove(m.uid, m.displayName || m.email)
                    }
                    className="text-destructive hover:text-destructive"
                    aria-label="Remove member"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="pt-1 text-[11px] text-muted-foreground">
          <Shield className="mr-1 inline h-3 w-3" />
          Admins can invite, change roles, and remove members.
          Collaborators can read and edit data.
        </p>
      </div>
    </section>
  );
}
