// Stub for Task B1 (MV3 scaffold). Real popup UI/logic lands in Task B4,
// which will replace this file. For now it imports the B2 modules and
// references their exports (so esbuild can't tree-shake them away) so the
// build + a manual popup open exercises Firebase init, auth, the Firestore
// data layer, and the resolver port end to end.
import { auth, db } from "./firebase.js";
import { signIn, doSignOut, onUser, currentUser, getIdToken, persistenceReady } from "./auth.js";
import { listSubAccounts, listPrompts, listGems, listSkills } from "./data.js";
import { resolveMentions } from "./resolve-mentions.js";
import { SLOT_RE, escapeRegExp, gemMentionRegex, extractVars, splitSlots } from "./slots.js";
import { runSkill } from "./run.js";

console.log("[PromptExpert] popup stub loaded (B2 modules wired)", {
  auth,
  db,
  signIn,
  doSignOut,
  onUser,
  currentUser,
  getIdToken,
  persistenceReady,
  listSubAccounts,
  listPrompts,
  listGems,
  listSkills,
  resolveMentions,
  SLOT_RE,
  escapeRegExp,
  gemMentionRegex,
  extractVars,
  splitSlots,
  runSkill,
});
