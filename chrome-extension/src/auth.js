import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  indexedDBLocalPersistence,
} from "firebase/auth";
import { auth } from "./firebase.js";

// Persist the session in IndexedDB so the popup/service worker doesn't have
// to re-authenticate on every open. Best-effort: some MV3 contexts (e.g. a
// service worker with no DOM) may not support it, so failures are swallowed.
//
// NOTE: deviates from the brief's `await setPersistence(...)` at module
// top-level — esbuild's "iife" output format (required for a <script> tag
// popup, see build.mjs) does not support top-level await. Firebase's Auth
// SDK internally queues signIn/signOut/etc. calls until the persistence
// manager resolves, so callers do not need to await this themselves; it's
// exported only so callers that care can `await persistenceReady` first.
export const persistenceReady = setPersistence(auth, indexedDBLocalPersistence).catch(() => {});

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const doSignOut = () => signOut(auth);
export const onUser = (cb) => onAuthStateChanged(auth, cb);
export const currentUser = () => auth.currentUser;
export const getIdToken = () => auth.currentUser?.getIdToken();
