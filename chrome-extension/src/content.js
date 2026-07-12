// Task B5: content script — inserts resolved prompt/skill-output text into the
// active editable element on AI chat pages (ChatGPT, Claude, Gemini).
//
// Vanilla JS, no imports — this is an esbuild entry with zero deps so it
// bundles trivially into dist/content.js (see manifest content_scripts mapping).

function isEditable(e) {
  if (!e) return false;
  return (
    e.isContentEditable ||
    e.tagName === "TEXTAREA" ||
    (e.tagName === "INPUT" && /text|search/.test(e.type))
  );
}

function firstEditable() {
  return document.querySelector('textarea, [contenteditable="true"], div[role="textbox"]');
}

// contenteditable path: try the standard command first (works on
// chatgpt.com/claude.ai's Lexical/ProseMirror-ish editors because it goes
// through the browser's native beforeinput/input pipeline). Some hosts or
// browser versions report execCommand as unsupported or it silently no-ops —
// fall back to a manual textContent write + synthetic input event so the
// host's framework still picks up the change.
function insertIntoContentEditable(target, text) {
  let handled = false;
  try {
    handled = document.execCommand && document.execCommand("insertText", false, text);
  } catch {
    handled = false;
  }

  if (!handled) {
    target.textContent = (target.textContent || "") + text;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: text }));
  }
  return true;
}

// textarea/input path: splice text in at the current selection, then fire
// both `input` and `change` — React-controlled inputs listen for `input`,
// but some host code (blur handlers, form validators) only wires up
// `change`, so dispatch both to be safe.
function insertIntoField(target, text) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.value = target.value.slice(0, start) + text + target.value.slice(end);

  const newCaret = start + text.length;
  if (typeof target.setSelectionRange === "function") {
    target.setSelectionRange(newCaret, newCaret);
  }

  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function insertIntoActive(text) {
  const active = document.activeElement;
  const target = isEditable(active) ? active : firstEditable();
  if (!target) return false;

  target.focus();

  if (target.isContentEditable) {
    return insertIntoContentEditable(target, text);
  }
  return insertIntoField(target, text);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PE_INSERT") {
    let ok = false;
    try {
      ok = insertIntoActive(msg.text ?? "");
    } catch {
      ok = false;
    }
    sendResponse({ ok });
  }
  return true; // keep the message channel open for the async sendResponse
});
