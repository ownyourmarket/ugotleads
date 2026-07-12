// PromptExpert popup — vanilla-DOM UI state machine.
//
// Auth + all Firestore/API calls happen HERE (in the popup), never in the
// content script — a content-script auth session would run in the host
// page's origin and would not see the popup's signed-in session. The
// content script (B5) only receives {type:"PE_INSERT", text} messages and
// inserts text into the active page's editable field.
//
// NOTE: esbuild's "iife" output format (required so popup.html can load
// this via a plain <script> tag) does not support top-level await. All
// async work below happens inside functions/handlers, never at module
// top-level.
import { signIn, doSignOut, onUser } from "./auth.js";
import { listSubAccounts, listPrompts, listGems, listSkills } from "./data.js";
import { resolveMentions } from "./resolve-mentions.js";
import { extractVars } from "./slots.js";
import { runSkill } from "./run.js";

const LAST_SA_KEY = "pe_lastSubAccountId";
const root = document.getElementById("app");

const state = {
  authResolved: false,
  user: null,
  authError: null,
  signingIn: false,
  emailDraft: "",

  subAccounts: [],
  selectedSaId: null,

  activeTab: "prompts", // "prompts" | "skills"
  loadingList: false,
  listError: null,
  prompts: [],
  gems: [],
  skills: [],

  selectedPromptId: null,
  selectedSkillId: null,
  selectedGemIds: new Set(),
  variables: {},

  running: false,
  runResult: null,
  runError: null,

  toast: null,
};

// A membership doc may omit `subAccountId` on some rows; fall back to the
// Firestore doc id (per prior task review notes).
function saIdOf(item) {
  return item.subAccountId ?? item.id;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function storageGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([key], (result) => resolve(result ? result[key] : undefined));
    } catch {
      resolve(undefined);
    }
  });
}

function storageSet(key, value) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    } catch {
      resolve();
    }
  });
}

let toastTimer = null;
function showToast(message, ms = 2200) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, ms);
}

// Sends resolved text to the active tab's content script. If the content
// script isn't present (e.g. the user is on a non-AI-chat tab),
// chrome.tabs.sendMessage rejects — caught and surfaced as a toast.
async function insertText(text) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("no-active-tab");
    await chrome.tabs.sendMessage(tab.id, { type: "PE_INSERT", text });
    showToast("Inserted");
  } catch {
    showToast("Open an AI chat page (ChatGPT, Claude, Gemini) to insert.", 3500);
  }
}

// ---------------------------------------------------------------------------
// Data loading (each async loader captures the sa/tab it started for and
// bails out if the user has since switched — the stale-guard).
// ---------------------------------------------------------------------------

async function loadSubAccounts() {
  const uid = state.user.uid;
  state.loadingList = true;
  state.listError = null;
  render();

  let list = [];
  try {
    list = await listSubAccounts(uid);
  } catch {
    if (state.user?.uid !== uid) return;
    state.loadingList = false;
    state.listError = "Failed to load sub-accounts.";
    render();
    return;
  }
  if (state.user?.uid !== uid) return; // signed out / user changed mid-flight

  state.subAccounts = list;
  const validIds = list.map(saIdOf);
  const stored = await storageGet(LAST_SA_KEY);
  if (state.user?.uid !== uid) return;

  state.selectedSaId = validIds.includes(stored) ? stored : validIds[0] ?? null;
  state.loadingList = false;
  render();

  if (state.selectedSaId) await loadTabData();
}

async function loadTabData() {
  const saId = state.selectedSaId;
  const tab = state.activeTab;
  if (!saId) return;

  state.loadingList = true;
  state.listError = null;
  render();

  try {
    if (tab === "prompts") {
      const [prompts, gems] = await Promise.all([listPrompts(saId), listGems(saId)]);
      if (state.selectedSaId !== saId || state.activeTab !== tab) return;
      state.prompts = prompts;
      state.gems = gems;
    } else {
      const skills = await listSkills(saId);
      if (state.selectedSaId !== saId || state.activeTab !== tab) return;
      state.skills = skills;
    }
  } catch {
    if (state.selectedSaId !== saId || state.activeTab !== tab) return;
    state.listError = "Failed to load data.";
  }
  if (state.selectedSaId !== saId || state.activeTab !== tab) return;
  state.loadingList = false;
  render();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function resetSelections() {
  state.selectedPromptId = null;
  state.selectedSkillId = null;
  state.selectedGemIds = new Set();
  state.variables = {};
  state.runResult = null;
  state.runError = null;
  state.listError = null;
}

async function handleSignIn(email, password) {
  state.signingIn = true;
  state.authError = null;
  render();
  try {
    await signIn(email, password);
    // onUser(...) below picks up the new session and renders the signed-in UI.
  } catch {
    state.signingIn = false;
    state.authError = "Sign in failed — check your email and password.";
    render();
  }
}

async function handleSignOut() {
  await doSignOut();
}

async function handleSelectSubAccount(saId) {
  if (saId === state.selectedSaId) return;
  state.selectedSaId = saId;
  resetSelections();
  state.prompts = [];
  state.skills = [];
  state.gems = [];
  await storageSet(LAST_SA_KEY, saId);
  render();
  await loadTabData();
}

async function handleSelectTab(tab) {
  if (tab === state.activeTab) return;
  state.activeTab = tab;
  resetSelections();
  render();
  await loadTabData();
}

function handleSelectPrompt(id) {
  const prompt = state.prompts.find((p) => p.id === id);
  state.selectedPromptId = id;
  state.selectedGemIds = new Set();
  state.variables = {};
  for (const v of extractVars(prompt?.content ?? "")) state.variables[v] = "";
  render();
}

function handleSelectSkill(id) {
  const skill = state.skills.find((s) => s.id === id);
  state.selectedSkillId = id;
  state.variables = {};
  for (const v of extractVars(skill?.systemInstruction ?? "")) state.variables[v] = "";
  state.runResult = null;
  state.runError = null;
  render();
}

async function handleInsertPrompt() {
  const prompt = state.prompts.find((p) => p.id === state.selectedPromptId);
  if (!prompt) return;
  const chosenGems = state.gems
    .filter((g) => state.selectedGemIds.has(g.id))
    .map((g) => ({ name: g.name, dataContent: g.dataContent }));
  const { resolved } = resolveMentions({ content: prompt.content, gems: chosenGems, variables: state.variables });
  await insertText(resolved);
}

async function handleRunSkill() {
  const skill = state.skills.find((s) => s.id === state.selectedSkillId);
  if (!skill || state.running) return;
  const saId = state.selectedSaId;
  const skillId = skill.id;

  state.running = true;
  state.runResult = null;
  state.runError = null;
  render();

  const result = await runSkill(saId, skillId, state.variables);
  if (state.selectedSaId !== saId || state.selectedSkillId !== skillId) return; // stale guard

  state.running = false;
  if (result.ok) {
    state.runResult = result;
  } else {
    state.runError = mapRunError(result);
  }
  render();
}

function mapRunError(result) {
  switch (result.status) {
    case 402:
      return `Not enough credits: you have ${result.currentBalance}, this run needs ${result.required}.`;
    case 403:
      return "PromptExpert is an add-on for BYOK plans — see the marketplace to unlock it.";
    case 429:
      return "Monthly AI usage cap reached for this workspace.";
    case 401:
      return "Please sign in again.";
    default:
      return "Run failed — please try again.";
  }
}

// ---------------------------------------------------------------------------
// Rendering — vanilla DOM, no framework. Full teardown/rebuild on every
// render() call; variable/gem inputs update `state` directly on their own
// input/change listeners (without calling render()) so typing never loses
// focus, and their `value=` is sourced from `state` so a later render (e.g.
// a toast) reflects what was typed.
// ---------------------------------------------------------------------------

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function bindActivate(button, handler) {
  button.addEventListener("click", handler);
}

function render() {
  root.innerHTML = "";

  if (!state.authResolved) {
    root.appendChild(el(`<div class="pe-loading">Loading…</div>`));
  } else if (!state.user) {
    root.appendChild(renderLogin());
  } else {
    root.appendChild(renderSignedIn());
  }

  if (state.toast) {
    root.appendChild(el(`<div class="pe-toast" role="status" aria-live="polite">${escapeHtml(state.toast)}</div>`));
  }
}

function renderLogin() {
  const wrap = el(`
    <div class="pe-login">
      <div class="pe-brand">
        <span class="pe-brand-mark">PE</span>
        <span class="pe-brand-name">PromptExpert</span>
      </div>
      <form class="pe-form" id="pe-login-form">
        <label class="pe-field">
          <span>Email</span>
          <input type="email" id="pe-email" autocomplete="username" value="${escapeHtml(state.emailDraft)}" required />
        </label>
        <label class="pe-field">
          <span>Password</span>
          <input type="password" id="pe-password" autocomplete="current-password" required />
        </label>
        ${state.authError ? `<div class="pe-error" role="alert">${escapeHtml(state.authError)}</div>` : ""}
        <button type="submit" class="pe-btn pe-btn-primary" ${state.signingIn ? "disabled" : ""}>
          ${state.signingIn ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  `);

  const emailInput = wrap.querySelector("#pe-email");
  emailInput.addEventListener("input", (e) => {
    state.emailDraft = e.target.value;
  });

  wrap.querySelector("#pe-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = wrap.querySelector("#pe-password").value;
    if (!email || !password || state.signingIn) return;
    handleSignIn(email, password);
  });

  return wrap;
}

function renderSignedIn() {
  const wrap = el(`<div class="pe-app"></div>`);
  wrap.appendChild(renderHeader());
  wrap.appendChild(renderSubAccountSelect());
  wrap.appendChild(renderTabs());
  wrap.appendChild(renderTabContent());
  return wrap;
}

function renderHeader() {
  const header = el(`
    <div class="pe-header">
      <span class="pe-user-email" title="${escapeHtml(state.user.email ?? "")}">${escapeHtml(state.user.email ?? "")}</span>
      <button type="button" class="pe-btn pe-btn-ghost" id="pe-signout">Sign out</button>
    </div>
  `);
  bindActivate(header.querySelector("#pe-signout"), handleSignOut);
  return header;
}

function renderSubAccountSelect() {
  if (state.subAccounts.length === 0 && !state.loadingList) {
    return el(`<div class="pe-empty-note">No sub-accounts found for this account.</div>`);
  }
  const options = state.subAccounts
    .map((sa) => {
      const id = saIdOf(sa);
      const label = sa.accountNumber ? `${sa.name ?? "Sub-account"} #${sa.accountNumber}` : sa.name ?? id;
      return `<option value="${escapeHtml(id)}" ${id === state.selectedSaId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");

  const wrap = el(`
    <div class="pe-field pe-sa-field">
      <select class="pe-select" id="pe-sa-select" aria-label="Sub-account">${options}</select>
    </div>
  `);
  wrap.querySelector("#pe-sa-select").addEventListener("change", (e) => {
    handleSelectSubAccount(e.target.value);
  });
  return wrap;
}

function renderTabs() {
  const wrap = el(`
    <div class="pe-tabs" role="tablist">
      <button type="button" class="pe-tab ${state.activeTab === "prompts" ? "pe-tab-active" : ""}" role="tab" aria-selected="${state.activeTab === "prompts"}" data-tab="prompts">Prompts</button>
      <button type="button" class="pe-tab ${state.activeTab === "skills" ? "pe-tab-active" : ""}" role="tab" aria-selected="${state.activeTab === "skills"}" data-tab="skills">Skills</button>
    </div>
  `);
  wrap.querySelectorAll(".pe-tab").forEach((btn) => {
    bindActivate(btn, () => handleSelectTab(btn.dataset.tab));
  });
  return wrap;
}

function renderTabContent() {
  const container = el(`<div class="pe-content"></div>`);

  if (!state.selectedSaId) {
    container.appendChild(el(`<div class="pe-empty-note">Select a sub-account to continue.</div>`));
    return container;
  }
  if (state.listError) {
    container.appendChild(el(`<div class="pe-error" role="alert">${escapeHtml(state.listError)}</div>`));
  }

  if (state.activeTab === "prompts") {
    container.appendChild(state.selectedPromptId ? renderPromptDetail() : renderPromptList());
  } else {
    container.appendChild(state.selectedSkillId ? renderSkillDetail() : renderSkillList());
  }
  return container;
}

function renderPromptList() {
  if (state.loadingList) return el(`<div class="pe-loading">Loading…</div>`);
  if (state.prompts.length === 0) return el(`<div class="pe-empty-note">No prompts yet.</div>`);

  const items = state.prompts
    .map(
      (p) => `
      <li>
        <button type="button" class="pe-item" data-id="${escapeHtml(p.id)}">
          <span class="pe-item-name">${escapeHtml(p.name ?? "Untitled prompt")}</span>
        </button>
      </li>`
    )
    .join("");
  const wrap = el(`<ul class="pe-list">${items}</ul>`);
  wrap.querySelectorAll(".pe-item").forEach((btn) => {
    bindActivate(btn, () => handleSelectPrompt(btn.dataset.id));
  });
  return wrap;
}

function renderPromptDetail() {
  const prompt = state.prompts.find((p) => p.id === state.selectedPromptId);
  if (!prompt) {
    state.selectedPromptId = null;
    return renderPromptList();
  }

  const vars = extractVars(prompt.content ?? "");
  const varInputs = vars
    .map(
      (name) => `
      <label class="pe-field">
        <span>${escapeHtml(name)}</span>
        <input type="text" class="pe-input" data-var="${escapeHtml(name)}" value="${escapeHtml(state.variables[name] ?? "")}" />
      </label>`
    )
    .join("");

  const gemRows = state.gems
    .map(
      (g) => `
      <label class="pe-checkbox-row">
        <input type="checkbox" data-gem="${escapeHtml(g.id)}" ${state.selectedGemIds.has(g.id) ? "checked" : ""} />
        <span>${escapeHtml(g.name)}</span>
      </label>`
    )
    .join("");

  const wrap = el(`
    <div class="pe-detail">
      <button type="button" class="pe-back" id="pe-back">&larr; Back</button>
      <h3 class="pe-detail-title">${escapeHtml(prompt.name ?? "Untitled prompt")}</h3>
      ${vars.length ? `<div class="pe-var-group">${varInputs}</div>` : ""}
      ${state.gems.length ? `<div class="pe-gem-group"><div class="pe-gem-label">Include gems</div>${gemRows}</div>` : ""}
      <button type="button" class="pe-btn pe-btn-primary" id="pe-insert">Insert</button>
    </div>
  `);

  bindActivate(wrap.querySelector("#pe-back"), () => {
    state.selectedPromptId = null;
    render();
  });
  wrap.querySelectorAll("input[data-var]").forEach((input) => {
    input.addEventListener("input", (e) => {
      state.variables[e.target.dataset.var] = e.target.value;
    });
  });
  wrap.querySelectorAll("input[data-gem]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const id = e.target.dataset.gem;
      if (e.target.checked) state.selectedGemIds.add(id);
      else state.selectedGemIds.delete(id);
    });
  });
  bindActivate(wrap.querySelector("#pe-insert"), handleInsertPrompt);

  return wrap;
}

function renderSkillList() {
  if (state.loadingList) return el(`<div class="pe-loading">Loading…</div>`);
  if (state.skills.length === 0) return el(`<div class="pe-empty-note">No skills yet.</div>`);

  const items = state.skills
    .map(
      (s) => `
      <li>
        <button type="button" class="pe-item" data-id="${escapeHtml(s.id)}">
          <span class="pe-item-name">${escapeHtml(s.name ?? "Untitled skill")}</span>
          <span class="pe-chip">${escapeHtml(s.creditCost ?? 0)} credits</span>
        </button>
      </li>`
    )
    .join("");
  const wrap = el(`<ul class="pe-list">${items}</ul>`);
  wrap.querySelectorAll(".pe-item").forEach((btn) => {
    bindActivate(btn, () => handleSelectSkill(btn.dataset.id));
  });
  return wrap;
}

function renderSkillDetail() {
  const skill = state.skills.find((s) => s.id === state.selectedSkillId);
  if (!skill) {
    state.selectedSkillId = null;
    return renderSkillList();
  }

  const vars = extractVars(skill.systemInstruction ?? "");
  const varInputs = vars
    .map(
      (name) => `
      <label class="pe-field">
        <span>${escapeHtml(name)}</span>
        <input type="text" class="pe-input" data-var="${escapeHtml(name)}" value="${escapeHtml(state.variables[name] ?? "")}" />
      </label>`
    )
    .join("");

  let resultBlock = "";
  if (state.runError) {
    resultBlock = `<div class="pe-error" role="alert">${escapeHtml(state.runError)}</div>`;
  } else if (state.runResult) {
    const notes = [];
    if (state.runResult.missingVariables?.length) notes.push(`variables: ${state.runResult.missingVariables.join(", ")}`);
    if (state.runResult.missingGems?.length) notes.push(`gems: ${state.runResult.missingGems.join(", ")}`);
    resultBlock = `
      <pre class="pe-output">${escapeHtml(state.runResult.output ?? "")}</pre>
      ${notes.length ? `<div class="pe-note">Heads up: unresolved — ${notes.join("; ")}</div>` : ""}
      <button type="button" class="pe-btn pe-btn-secondary" id="pe-insert-output">Insert output</button>
    `;
  }

  const wrap = el(`
    <div class="pe-detail">
      <button type="button" class="pe-back" id="pe-back">&larr; Back</button>
      <h3 class="pe-detail-title">${escapeHtml(skill.name ?? "Untitled skill")}</h3>
      ${vars.length ? `<div class="pe-var-group">${varInputs}</div>` : ""}
      <div class="pe-cost-line">This run: ${escapeHtml(skill.creditCost ?? 0)} credits</div>
      <button type="button" class="pe-btn pe-btn-primary" id="pe-run" ${state.running ? "disabled" : ""}>${state.running ? "Running…" : "Run"}</button>
      ${resultBlock}
    </div>
  `);

  bindActivate(wrap.querySelector("#pe-back"), () => {
    state.selectedSkillId = null;
    state.runResult = null;
    state.runError = null;
    render();
  });
  wrap.querySelectorAll("input[data-var]").forEach((input) => {
    input.addEventListener("input", (e) => {
      state.variables[e.target.dataset.var] = e.target.value;
    });
  });
  bindActivate(wrap.querySelector("#pe-run"), handleRunSkill);
  const insertOutputBtn = wrap.querySelector("#pe-insert-output");
  if (insertOutputBtn) {
    bindActivate(insertOutputBtn, () => insertText(state.runResult.output ?? ""));
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

onUser((user) => {
  state.authResolved = true;
  state.user = user;
  state.authError = null;
  state.signingIn = false;

  if (user) {
    resetSelections();
    state.subAccounts = [];
    state.selectedSaId = null;
    state.activeTab = "prompts";
    state.prompts = [];
    state.gems = [];
    state.skills = [];
    render();
    loadSubAccounts();
  } else {
    state.subAccounts = [];
    state.selectedSaId = null;
    state.prompts = [];
    state.gems = [];
    state.skills = [];
    resetSelections();
    render();
  }
});

render(); // initial paint (shows the "Loading…" state until onUser fires)
