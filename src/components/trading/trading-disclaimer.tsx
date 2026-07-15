import { AlertTriangle } from "lucide-react";

/**
 * Non-dismissible compliance banner shown on every Trading OS surface.
 * The Trading OS module is a research/educational workspace — never
 * investment advice, never discretionary management. This copy must not be
 * softened without a compliance-reviewer pass.
 */
export function TradingDisclaimer() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <strong>For research and educational purposes only.</strong> This tool
        generates market research, strategy ideas, and backtests. It is{" "}
        <strong>not investment advice</strong> and does not manage money or
        place trades on your behalf. Past performance does not guarantee future
        results. Trading involves risk of loss. You are responsible for your own
        decisions — consult a licensed professional before investing.
      </p>
    </div>
  );
}
