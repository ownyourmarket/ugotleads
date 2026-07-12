"use client";

import { PenLine } from "lucide-react";
import { AgentWorkbench } from "@/components/agency/agent-workbench";

/**
 * Agency-owner Copywriter workbench. Thin wrapper over AgentWorkbench —
 * all behaviour lives in the shared component; this file only supplies
 * the marketing-copywriter voice and examples.
 */
export default function MarketingCopyPage() {
  return (
    <AgentWorkbench
      agentKey="marketing-copywriter"
      title="Copywriter"
      description="Conversion-focused copy in the UGotLeads operator-first voice — landing pages, emails, offers, and CTAs."
      icon={PenLine}
      iconChipClassName="bg-violet-500/10 text-violet-600 dark:text-violet-400"
      taskLabel="What do you need written?"
      taskPlaceholder="e.g. Write three headline options for a lead-gen landing page aimed at local HVAC owners."
      contextPlaceholder="Paste your current draft, the offer details, or the page it will live on."
      examples={[
        "Write a 3-email follow-up sequence for new leads",
        "Rewrite this headline to be more outcome-focused",
        "Draft a short CTA section for a pricing page",
      ]}
    />
  );
}
