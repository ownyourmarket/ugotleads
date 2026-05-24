"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AffiliateStatus } from "@/types/affiliate";

interface Props {
  affiliateId: string;
  currentStatus: AffiliateStatus;
}

const NEXT_STATUS: Record<AffiliateStatus, AffiliateStatus> = {
  active: "paused",
  paused: "active",
  banned: "active",
};

const ACTION_LABEL: Record<AffiliateStatus, string> = {
  active: "Pause affiliate",
  paused: "Reactivate",
  banned: "Reactivate",
};

export function AffiliateStatusControl({ affiliateId, currentStatus }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function toggleStatus() {
    setSubmitting(true);
    try {
      const target = NEXT_STATUS[currentStatus];
      const res = await fetch(`/api/agency/affiliates/${affiliateId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Failed to update status");
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleStatus}
      disabled={submitting}
    >
      {submitting ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Updating…
        </>
      ) : (
        ACTION_LABEL[currentStatus]
      )}
    </Button>
  );
}
