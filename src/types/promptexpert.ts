import type { Timestamp, FieldValue } from "firebase/firestore";

export const PE_GEM_MAX_CHARS = 50000;

export type GemType = "Brand Bio" | "Target Persona" | "Technical Doc" | "Custom Data";
export const GEM_TYPES: GemType[] = ["Brand Bio", "Target Persona", "Technical Doc", "Custom Data"];

export type SkillOutputFormat = "Markdown" | "JSON" | "HTML";
export const SKILL_OUTPUT_FORMATS: SkillOutputFormat[] = ["Markdown", "JSON", "HTML"];

/** Template with [Variable] slots. Collection: pe_prompts/{id} */
export interface PePrompt {
  id: string;
  agencyId: string;
  subAccountId: string;
  title: string;
  content: string;           // contains [Variable_Name] slots
  category: string;          // default "General"
  tags: string[];
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

/** Context block injected via @mention. Collection: pe_gems/{id} */
export interface PeGem {
  id: string;
  agencyId: string;
  subAccountId: string;
  name: string;
  gemType: GemType;
  dataContent: string;       // ≤ PE_GEM_MAX_CHARS, enforced in rules + UI
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

/** Runnable action with a credit price. Collection: pe_skills/{id} */
export interface PeSkill {
  id: string;
  agencyId: string;
  subAccountId: string;
  name: string;
  description: string | null;
  systemInstruction: string; // may contain [Variable] slots and @Gem mentions
  outputFormat: SkillOutputFormat;
  creditCost: number;        // integer ≥ 0
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export interface CreditPack {
  id: "starter" | "growth" | "scale";
  name: string;
  credits: number;
  priceUsdCents: number;   // one-time
}
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", credits: 500,  priceUsdCents: 1900 },
  { id: "growth",  name: "Growth",  credits: 2000, priceUsdCents: 4900 },
  { id: "scale",   name: "Scale",   credits: 5000, priceUsdCents: 9900 },
];

/** Saved assistant. Collection: pe_gpts/{id}. SERVER-WRITTEN ONLY. */
export interface PeGpt {
  id: string;
  agencyId: string;
  subAccountId: string;
  name: string;
  description: string | null;
  basePromptId: string | null;      // pe_prompts ref, same-tenant validated server-side
  pinnedGemIds: string[];           // pe_gems refs, same-tenant validated
  allowedSkillIds: string[];        // pe_skills refs (reserved for later tool-use), same-tenant validated
  creditCostPerMessage: number;     // int >= 0, default 1
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export interface PeGptMessage { role: "user" | "assistant"; content: string; at: number /* epoch ms */; }
export const PE_GPT_SESSION_MAX_MESSAGES = 40;   // ring buffer cap, oldest dropped

/** Chat session. Collection: pe_gpt_sessions/{id}. SERVER-WRITTEN ONLY. */
export interface PeGptSession {
  id: string;
  agencyId: string;
  subAccountId: string;
  gptId: string;
  startedByUid: string;
  messages: PeGptMessage[];         // capped at PE_GPT_SESSION_MAX_MESSAGES
  totalCreditsCharged: number;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
