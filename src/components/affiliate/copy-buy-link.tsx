"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Admin-side copy-to-clipboard control for an affiliate's direct "Buy now"
 * link (/buy?ref=CODE). Rendered in the affiliates table so the owner can
 * grab any affiliate's link and hand it over on request.
 */
export function CopyBuyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin / permissions). The URL is
      // in the title tooltip as a manual fallback, so this is non-fatal.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
