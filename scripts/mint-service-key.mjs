// Usage:
//   node scripts/mint-service-key.mjs --label suit-bridge \
//     --sub-account DDEParISNUlxoMiimi2X \
//     --scopes contacts:read,contacts:write,deals:write,templates:read,templates:write,sends:execute,reports:read
//
// Reads FIREBASE_ADMIN_* from .env.local. Prints the plaintext key ONCE.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const label = arg("label");
const subAccount = arg("sub-account");
const scopes = (arg("scopes") ?? "").split(",").filter(Boolean);
if (!label || !subAccount || scopes.length === 0) {
  console.error("Required: --label, --sub-account, --scopes (comma-separated)");
  process.exit(1);
}

// Mirrors ServiceScope in src/types/service-keys.ts — keep in sync.
const VALID_SCOPES = [
  "contacts:read",
  "contacts:write",
  "deals:write",
  "templates:read",
  "templates:write",
  "sends:execute",
  "reports:read",
  "sequences:write",
  "sequences:enroll",
  "replies:read",
  "replies:write",
];
for (const scope of scopes) {
  if (!VALID_SCOPES.includes(scope)) {
    console.error(`Unknown scope: "${scope}"`);
    console.error(`Valid scopes: ${VALID_SCOPES.join(", ")}`);
    process.exit(1);
  }
}

// Minimal .env.local loader (no dotenv dependency).
const env = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {
  /* .env.local optional if env vars already exported */
}

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore();

const sa = await db.doc(`subAccounts/${subAccount}`).get();
if (!sa.exists) {
  console.error(`Sub-account ${subAccount} not found.`);
  process.exit(1);
}

const key = `ugl_${randomBytes(20).toString("hex")}`;
const keyHash = createHash("sha256").update(key).digest("hex");
const ref = await db.collection("agencyServiceKeys").add({
  agencyId: sa.data().agencyId,
  label,
  keyHash,
  keyPrefix: key.slice(0, 8),
  allowedSubAccounts: [subAccount],
  scopes,
  status: "active",
  createdByUid: "script:mint-service-key",
  createdAt: FieldValue.serverTimestamp(),
  lastUsedAt: null,
});

console.log(`Key id:     ${ref.id}`);
console.log(`Plaintext:  ${key}`);
console.log("Store this in the suit's .env now — it is not shown again.");
