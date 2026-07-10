import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  buildContactDoc,
  isValidEmail,
  type AgentContactInput,
} from "@/lib/agent-api/contact-defaults";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { fireTagAddedTriggers } from "@/lib/automations/tag-triggers";
import { PIPELINE_STAGES } from "@/types/deals";

const MAX_ROWS = 200;

export const POST = withAgentRoute(async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    contacts?: AgentContactInput[];
  } | null;

  if (
    !body ||
    typeof body.subAccountId !== "string" ||
    !Array.isArray(body.contacts)
  ) {
    return agentError(
      "VALIDATION_FAILED",
      "subAccountId and contacts[] are required.",
      400
    );
  }
  if (body.contacts.length === 0 || body.contacts.length > MAX_ROWS) {
    return agentError(
      "VALIDATION_FAILED",
      `contacts[] must contain 1-${MAX_ROWS} rows.`,
      400
    );
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const contacts = body.contacts;
  return withIdempotency(request, access.keyId, "contacts:import", async () => {
    const db = getAdminDb();
    let created = 0;
    const skipped: { index: number; reason: string }[] = [];
    // Also dedupe emails within the batch itself.
    const seenEmails = new Set<string>();

    for (let i = 0; i < contacts.length; i++) {
      const row = contacts[i];
      if (!row || typeof row !== "object") {
        skipped.push({ index: i, reason: "invalid_row" });
        continue;
      }
      if (
        typeof row.pipelineStage === "string" &&
        row.pipelineStage !== "" &&
        !PIPELINE_STAGES.some((s) => s.id === row.pipelineStage)
      ) {
        skipped.push({ index: i, reason: "invalid_pipeline_stage" });
        continue;
      }

      const email =
        typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      const phone = typeof row.phone === "string" ? row.phone.trim() : "";

      if (!email && !phone) {
        skipped.push({ index: i, reason: "missing_email_and_phone" });
        continue;
      }
      // Same rule as the CSV importer: a malformed email on a phone-backed
      // row is dropped (row imports); without a phone it's a skip. A
      // non-string email field (e.g. a number) behaves as absent — `email`
      // above is already "" in that case, so it never reaches this branch.
      let effectiveEmail = email;
      if (email && !isValidEmail(email)) {
        if (phone) {
          row.email = "";
          effectiveEmail = "";
        } else {
          skipped.push({ index: i, reason: "invalid_email" });
          continue;
        }
      }
      const rowTags = (Array.isArray(row.tags) ? row.tags : []).filter(
        (t): t is string => typeof t === "string" && !!t.trim()
      );

      if (effectiveEmail) {
        if (seenEmails.has(effectiveEmail)) {
          skipped.push({ index: i, reason: "duplicate_email" });
          continue;
        }
        // Use transactional pattern for email-backed rows
        const ref = db.collection("contacts").doc();
        const result = await db.runTransaction(async (tx) => {
          const dup = await tx.get(
            db
              .collection("contacts")
              .where("subAccountId", "==", access.subAccountId)
              .where("email", "==", effectiveEmail)
              .limit(1)
          );
          if (!dup.empty) return { duplicate: true as const };
          tx.set(ref, buildContactDoc(access, row));
          return { duplicate: false as const };
        });
        if (result.duplicate) {
          skipped.push({ index: i, reason: "duplicate_email" });
          continue;
        }
        seenEmails.add(effectiveEmail);
        if (rowTags.length) {
          try {
            await fireTagAddedTriggers({
              agencyId: access.agencyId,
              subAccountId: access.subAccountId as string,
              contactId: ref.id,
              addedTags: rowTags,
            });
          } catch (err) {
            console.warn("[agent contacts import] tag triggers failed", err);
          }
        }
      } else {
        // Phone-only rows: direct add without transaction
        const ref = await db
          .collection("contacts")
          .add(buildContactDoc(access, row));
        if (rowTags.length) {
          try {
            await fireTagAddedTriggers({
              agencyId: access.agencyId,
              subAccountId: access.subAccountId as string,
              contactId: ref.id,
              addedTags: rowTags,
            });
          } catch (err) {
            console.warn("[agent contacts import] tag triggers failed", err);
          }
        }
      }
      created++;
    }

    return { status: 201, body: { data: { created, skipped } } };
  });
});
