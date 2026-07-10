import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  buildContactDoc,
  isValidEmail,
  type AgentContactInput,
} from "@/lib/agent-api/contact-defaults";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

const MAX_ROWS = 200;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    contacts?: AgentContactInput[];
  } | null;

  if (!body || typeof body.subAccountId !== "string" || !Array.isArray(body.contacts)) {
    return agentError("VALIDATION_FAILED", "subAccountId and contacts[] are required.", 400);
  }
  if (body.contacts.length === 0 || body.contacts.length > MAX_ROWS) {
    return agentError("VALIDATION_FAILED", `contacts[] must contain 1-${MAX_ROWS} rows.`, 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const contacts = body.contacts;
  return withIdempotency(request, access.keyId, async () => {
    const db = getAdminDb();
    let created = 0;
    const skipped: { index: number; reason: string }[] = [];
    // Also dedupe emails within the batch itself.
    const seenEmails = new Set<string>();

    for (let i = 0; i < contacts.length; i++) {
      const row = contacts[i];
      const email = row.email?.trim().toLowerCase() ?? "";
      const phone = row.phone?.trim() ?? "";

      if (!email && !phone) {
        skipped.push({ index: i, reason: "missing_email_and_phone" });
        continue;
      }
      // Same rule as the CSV importer: a malformed email on a phone-backed
      // row is dropped (row imports); without a phone it's a skip.
      if (email && !isValidEmail(email)) {
        if (phone) {
          row.email = "";
        } else {
          skipped.push({ index: i, reason: "invalid_email" });
          continue;
        }
      }
      const effectiveEmail = row.email?.trim().toLowerCase() ?? "";
      if (effectiveEmail) {
        if (seenEmails.has(effectiveEmail)) {
          skipped.push({ index: i, reason: "duplicate_email" });
          continue;
        }
        // Use transactional pattern for email-backed rows
        const result = await db.runTransaction(async (tx) => {
          const dup = await tx.get(
            db.collection("contacts")
              .where("subAccountId", "==", access.subAccountId)
              .where("email", "==", effectiveEmail)
              .limit(1),
          );
          if (!dup.empty) return { duplicate: true as const };
          const ref = db.collection("contacts").doc();
          tx.set(ref, buildContactDoc(access, row));
          return { duplicate: false as const };
        });
        if (result.duplicate) {
          skipped.push({ index: i, reason: "duplicate_email" });
          continue;
        }
        seenEmails.add(effectiveEmail);
      } else {
        // Phone-only rows: direct add without transaction
        await db.collection("contacts").add(buildContactDoc(access, row));
      }
      created++;
    }

    return { status: 201, body: { data: { created, skipped } } };
  });
}
