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
