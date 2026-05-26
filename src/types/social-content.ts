/**
 * AI Social Content Generator — Phase 1 types.
 *
 * Firestore collection: subAccounts/{subAccountId}/socialContent/{batchId}
 *
 * See docs/social-content-generator-spec.md for full spec.
 */

import type { Timestamp } from "firebase/firestore";

export type SocialPlatform = "facebook" | "instagram" | "linkedin" | "x";

export type SocialVoice = "professional" | "casual" | "bold" | "warm" | "expert";

export type SocialBatchStatus = "queued" | "generating" | "ready" | "failed";

export interface BusinessProfile {
  industry: string;
  location: string;
  voice: SocialVoice;
  products: string;
  audience: string;
  websiteUrl?: string;
}

export interface ContentCadence {
  platforms: SocialPlatform[];
  postsPerWeek: 3 | 5 | 7;
  weeks: number; // typically 4 for a 30-day plan
}

export interface GeneratedPost {
  dayOffset: number; // 0..29
  platform: SocialPlatform;
  caption: string;
  hashtags: string[];
  imagePrompt: string;
  ctaText: string;
  suggestedTime?: string;
  approved?: boolean;
  edited?: boolean;
}

export interface SocialContentBatch {
  id: string;
  agencyId: string;
  subAccountId: string;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  businessProfile: BusinessProfile;
  cadence: ContentCadence;
  status: SocialBatchStatus;
  progress: { completed: number; total: number };
  generatedPosts: GeneratedPost[];
  tokensUsed: number;
  modelUsed: string;
  errorMessage?: string;
}

export interface GenerateBatchRequest {
  businessProfile: BusinessProfile;
  cadence: ContentCadence;
}

export interface GenerateStepRequest {
  batchId: string;
  subAccountId: string;
  weekIndex: number;
}
