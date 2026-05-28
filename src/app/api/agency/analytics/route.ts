import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * GET /api/agency/analytics
 *
 * Cross-client analytics for the agency owner. Aggregates KPIs across
 * all sub-accounts: contacts, deals, tasks, AI usage, social posts,
 * review requests, form submissions.
 *
 * Territory Partner tier feature. Requires agency owner auth via
 * middleware x-user-uid header.
 */

export async function GET(request: Request) {
  // Auth: require the agency owner
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();

  // Find the agency this user owns
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.data();
  const agencyId = userData?.primaryAgencyId as string | undefined;
  if (!agencyId) {
    return NextResponse.json({ error: "no_agency" }, { status: 403 });
  }

  // Get all sub-accounts for this agency
  const subAccountsSnap = await db
    .collection("subAccounts")
    .where("agencyId", "==", agencyId)
    .get();

  const subAccounts = subAccountsSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data().name as string) ?? "Unnamed",
    aiUsage: d.data().aiUsage as {
      currentPeriodTokens?: number;
      monthlyCapTokens?: number;
      lifetimeTokens?: number;
    } | null,
  }));

  const saIds = subAccounts.map((sa) => sa.id);

  // Aggregate counts across all sub-accounts (batch queries)
  // Firestore "in" queries max at 30 items — chunk if needed
  async function countCollection(col: string, field: string = "subAccountId"): Promise<number> {
    let total = 0;
    for (let i = 0; i < saIds.length; i += 30) {
      const chunk = saIds.slice(i, i + 30);
      const snap = await db
        .collection(col)
        .where(field, "in", chunk)
        .count()
        .get();
      total += snap.data().count;
    }
    return total;
  }

  const [
    totalContacts,
    totalDeals,
    totalTasks,
    totalForms,
  ] = await Promise.all([
    countCollection("contacts"),
    countCollection("deals"),
    countCollection("tasks"),
    countCollection("forms"),
  ]);

  // Per-sub-account social posts + reviews + AI usage
  const perSubAccount = await Promise.all(
    subAccounts.map(async (sa) => {
      const [postsSnap, reviewsSnap, requestsSnap] = await Promise.all([
        db.collection(`subAccounts/${sa.id}/socialPosts`).count().get(),
        db.collection(`subAccounts/${sa.id}/reviews`).count().get(),
        db.collection(`subAccounts/${sa.id}/reviewRequests`).count().get(),
      ]);
      return {
        id: sa.id,
        name: sa.name,
        socialPosts: postsSnap.data().count,
        reviews: reviewsSnap.data().count,
        reviewRequests: requestsSnap.data().count,
        aiTokensUsed: sa.aiUsage?.currentPeriodTokens ?? 0,
        aiTokensCap: sa.aiUsage?.monthlyCapTokens ?? 0,
        aiLifetimeTokens: sa.aiUsage?.lifetimeTokens ?? 0,
      };
    }),
  );

  const totalSocialPosts = perSubAccount.reduce((s, sa) => s + sa.socialPosts, 0);
  const totalReviews = perSubAccount.reduce((s, sa) => s + sa.reviews, 0);
  const totalReviewRequests = perSubAccount.reduce((s, sa) => s + sa.reviewRequests, 0);
  const totalAiTokens = perSubAccount.reduce((s, sa) => s + sa.aiTokensUsed, 0);

  return NextResponse.json({
    summary: {
      subAccountCount: subAccounts.length,
      totalContacts,
      totalDeals,
      totalTasks,
      totalForms,
      totalSocialPosts,
      totalReviews,
      totalReviewRequests,
      totalAiTokensThisPeriod: totalAiTokens,
    },
    perSubAccount,
  });
}
