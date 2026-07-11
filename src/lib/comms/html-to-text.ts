import "server-only";

/**
 * Minimal, dependency-free HTML → plain-text conversion for inbound reply
 * bodies. Some senders (Gmail replies among them — observed live
 * 2026-07-11) deliver an html part with no text part, which left
 * `inbound_emails.text` empty and made GET /api/agent/v1/replies useless
 * for reading the reply. This is a *fallback for human/agent triage*, not
 * a faithful renderer: scripts/styles are dropped, block boundaries become
 * newlines, tags are stripped, common entities are decoded.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html;
  // Drop non-content blocks wholesale (case-insensitive, dotall via [\s\S]).
  s = s.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Block-level boundaries → newlines before tags are stripped.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|pre|table)>/gi, "\n");
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, "");
  // Decode the entities that actually occur in email bodies.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&amp;/gi, "&"); // last, so &amp;lt; decodes to &lt; not <
  // Collapse whitespace: spaces/tabs within lines, 3+ newlines to 2.
  s = s.replace(/[^\S\n]+/g, " ");
  s = s.replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
