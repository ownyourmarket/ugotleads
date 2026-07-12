"use client";

import { ShieldCheck } from "lucide-react";
import { AgentWorkbench } from "@/components/agency/agent-workbench";

/**
 * Agency-owner Compliance Reviewer workbench. Thin wrapper over
 * AgentWorkbench — this file only supplies the compliance-reviewer
 * voice and examples.
 */
export default function CompliancePage() {
  return (
    <AgentWorkbench
      agentKey="compliance-reviewer"
      title="Compliance"
      description="Reviews outbound copy for risky claims — income promises, guarantees, and legal language that needs softening."
      icon={ShieldCheck}
      iconChipClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      taskLabel="What should be reviewed?"
      taskPlaceholder="e.g. Review this sales page section for income claims and FTC risk."
      contextPlaceholder="Paste the copy to review — email, landing page, ad, or offer terms."
      examples={[
        "Review this email for income or guarantee claims",
        "Flag anything on this page that needs a disclaimer",
        "Check this ad copy for FTC red flags",
      ]}
    />
  );
}
