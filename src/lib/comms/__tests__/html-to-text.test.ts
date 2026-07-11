import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/comms/html-to-text";

describe("htmlToText", () => {
  it("returns empty string for null/undefined/empty input", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText("")).toBe("");
  });

  it("converts a Gmail-style reply div", () => {
    expect(
      htmlToText('<div dir="ltr">Yes — let&#39;s talk <b>Tuesday</b>.<br></div>')
    ).toBe("Yes — let's talk Tuesday.");
  });

  it("turns block boundaries into newlines and collapses runs", () => {
    expect(
      htmlToText("<p>line one</p><p>line two</p><br><br><br><div>line three</div>")
    ).toBe("line one\nline two\n\nline three");
  });

  it("drops script/style/head blocks and comments entirely", () => {
    expect(
      htmlToText(
        "<style>p{color:red}</style><script>alert(1)</script><!-- hi -->body text"
      )
    ).toBe("body text");
  });

  it("decodes common entities, &amp; last", () => {
    expect(htmlToText("a &lt;b&gt; &quot;c&quot; &nbsp; d &amp;lt;")).toBe(
      'a <b> "c" d &lt;'
    );
    expect(htmlToText("&#8212; and &#128512;")).toBe("— and 😀");
  });

  it("survives malformed html without throwing", () => {
    expect(htmlToText("<div><p>unclosed <b>tags")).toBe("unclosed tags");
  });
});
