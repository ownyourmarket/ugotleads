// src/lib/training/content.ts
//
// Canonical training content for the two built-in certification tracks.
// These are placeholder modules — real content will replace the descriptions
// once the curriculum is finalized. The structures are used by:
//   - /sa/[subAccountId]/training        (dashboard cards)
//   - /sa/[subAccountId]/training/[id]   (module checklist + submit)
//   - /agency/certifications             (admin track name lookup)
//   - /api/training/[trackId]/submit     (module count validation)

export interface TrackModule {
  title: string;
  description: string;
}

export interface TrackMeta {
  name: string;
  description: string;
  unlocksDescription: string;
}

/**
 * Ordered modules for each canonical track.
 * The API submit route uses `DEFAULT_TRACK_MODULES[trackId].length` as the
 * authoritative total when the track_progress doc was created from these defaults
 * rather than from a Firestore partner_tracks milestone list.
 */
export const DEFAULT_TRACK_MODULES: Record<string, TrackModule[]> = {
  track_certified_ai_consultant: [
    {
      title: "AI Fundamentals Overview",
      description: "Understand what AI is, how it applies to local businesses, and why it matters now.",
    },
    {
      title: "Platform Walkthrough",
      description: "Complete a guided walkthrough of uGotLeads and all its AI-powered features.",
    },
    {
      title: "Client Discovery Framework",
      description: "Learn how to identify and qualify AI opportunities for local business clients.",
    },
    {
      title: "AI Implementation Basics",
      description: "Step-by-step process for deploying AI tools with a real client account.",
    },
    {
      title: "Revenue OS Product Suite",
      description: "Deep dive into every product in the marketplace and how to position each one.",
    },
    {
      title: "Final Assessment",
      description: "Complete the self-assessment and submit for certification review.",
    },
  ],

  track_community_advocate: [
    {
      title: "MyUSA Local Mission & Values",
      description: "Understand the mission, values, and your role as a community advocate in your market.",
    },
    {
      title: "Community Engagement Fundamentals",
      description: "Learn how to connect authentically with local business owners and build lasting trust.",
    },
    {
      title: "Local Business Partnership",
      description: "Identify and develop strategic partnerships that serve your local community.",
    },
    {
      title: "Content & Communication",
      description: "Create compelling local content that drives engagement and builds your platform.",
    },
    {
      title: "Final Assessment",
      description: "Complete the self-assessment and submit for certification review.",
    },
  ],
};

/**
 * Display metadata for each canonical track.
 * Used when the Firestore partner_tracks doc is missing or has no content yet.
 */
export const DEFAULT_TRACK_META: Record<string, TrackMeta> = {
  track_certified_ai_consultant: {
    name: "Certified AI Consultant",
    description:
      "Master the skills to consult, implement, and sell AI solutions for local businesses. " +
      "This track qualifies you to sell AI-powered products in the marketplace.",
    unlocksDescription:
      "AI Consultant products in the marketplace + higher commission tier eligibility",
  },

  track_community_advocate: {
    name: "Community Advocate",
    description:
      "Become a recognized local champion for small business success through the MyUSA Local program. " +
      "Build a network and earn commission through referrals.",
    unlocksDescription:
      "Community resources, media products, and referral commission eligibility",
  },
};

/**
 * Returns the module count for a track, using Firestore milestones when available
 * and falling back to DEFAULT_TRACK_MODULES. Used to validate submit requests.
 */
export function resolveModuleCount(trackId: string, firestoreMilestones?: string[]): number {
  if (firestoreMilestones && firestoreMilestones.length > 0) {
    return firestoreMilestones.length;
  }
  return DEFAULT_TRACK_MODULES[trackId]?.length ?? 0;
}
