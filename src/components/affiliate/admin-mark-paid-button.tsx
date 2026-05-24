"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MarkPaidButton({ referralId }: { referralId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function markPaid() {
    const note = window.prompt(
      "Payout note (optional — e.g. 'PayPal txn ABC123' or 'Wise transfer')",
      "",
    );
    if (note === null) return; // user cancelled prompt
    setSubmitting(true);
    try {
      const res = await fetch("/api/agency/affiliates/payouts/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId, note: note.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Failed to mark paid");
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={markPaid}
      disabled={submitting}
      className="gap-1.5"
    >
      {submitting ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Check className="h-3 w-3" />
      )}
      Mark paid
    </Button>
  );
}
