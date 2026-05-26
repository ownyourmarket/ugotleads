# AI Social Content Generator — Phase 1 Spec

> Status: Phase 1 foundation scaffolded (this commit). End-to-end build estimated at **~1.5 weeks** of focused work. The Firestore schema, types, and route shells in this commit lock the contract so subsequent sessions can ship features without re-litigating the architecture.

## Goal (user story)

An operator using a UGotLeads sub-account opens **AI Agents → Social Content**, fills 6 fields describing their business, clicks **Generate 30 days**, and within ~2-3 minutes has 30 platform-aware posts (FB, IG, LinkedIn, X) organized in a results table, with one-click CSV export.

This closes the largest delivery bottleneck of the $997 DFY offer: today, 30 days of social content is hand-crafted per client (~4-6 hours of work). After this ships, that step becomes a 3-minute form fill.

## Out of scope (Phase 2)

- Direct posting via Meta API / LinkedIn API / Twitter API
- Buffer / Later / Hootsuite push integrations
- AI image generation (we ship `imagePrompt` text; user generates images elsewhere)
- Video content
- A/B testing of post variants

## Firestore schema

### `subAccounts/{subAccountId}/socialContent/{batchId}`

```ts
{
  id: string;                          // auto-id
  agencyId: string;
  subAccountId: string;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  businessProfile: {
    industry: string;                  // free text + canonical-list fallback
    location: string;                  // "Atlanta, GA" — used for geo-relevance
    voice: "professional" | "casual" | "bold" | "warm" | "expert";
    products: string;                  // free text, ≤500 chars
    audience: string;                  // free text, ≤500 chars
    websiteUrl?: string;               // optional — used for KB scrape via Firecrawl
  };

  cadence: {
    platforms: ("facebook" | "instagram" | "linkedin" | "x")[];
    postsPerWeek: number;              // 3 | 5 | 7
    weeks: number;                     // 4 (= ~30 days)
  };

  status: "queued" | "generating" | "ready" | "failed";
  progress: { completed: number; total: number };  // for UI progress bar

  generatedPosts: Array<{
    dayOffset: number;                 // 0..29
    platform: "facebook" | "instagram" | "linkedin" | "x";
    caption: string;
    hashtags: string[];                // ≤8 per post
    imagePrompt: string;               // text description for image gen
    ctaText: string;                   // e.g. "Book today" or "DM us"
    suggestedTime?: string;            // "Tuesday 7pm ET" — platform best-practice
    approved?: boolean;                // operator-set
    edited?: boolean;                  // flag for downstream
  }>;

  tokensUsed: number;
  modelUsed: string;                   // e.g. "anthropic/claude-sonnet-4-7"

  errorMessage?: string;               // populated on failed
}
```

### Tenancy + rules

- Same pattern as `automations` and `forms`: caller must be in `subAccountMembers/{uid}` OR the agency owner shortcut.
- Public read: false. Public write: false. All writes via admin SDK from API routes after auth check.
- Add the rules block to `firestore.rules`:

```
match /subAccounts/{saId}/socialContent/{batchId} {
  allow read: if isSubAccountMember(saId);
  allow write: if false;  // server only
}
```

## API endpoints

### `POST /api/sub-accounts/[id]/social-content/generate`

**Auth:** sub-account admin role required.

**Request body:**
```json
{
  "businessProfile": {...},
  "cadence": {"platforms": [...], "postsPerWeek": 5, "weeks": 4}
}
```

**Response:** `{ batchId: string }`

**Implementation:**
1. Create the `socialContent/{batchId}` doc with `status: "queued"`, empty `generatedPosts`
2. Schedule QStash messages — **one per week** (so 4 messages for a 30-day plan). Spaces the OpenRouter load, lets the UI show progressive results.
3. Return `batchId` immediately

### `POST /api/social-content/generate-step` (QStash callback)

**Auth:** QStash signature verification (route is public-path, security is the signature).

**Request body:** `{ batchId, subAccountId, weekIndex }`

**Implementation:**
1. Verify Upstash signature
2. Idempotency check (skip if posts for that week already exist)
3. Load the batch doc + business profile
4. For each enabled platform, build a system prompt + week-specific prompt
5. Call OpenRouter with **Claude Sonnet 4.7** (content quality > cost for this surface)
6. Parse the response as structured JSON (force JSON-mode via prompt instruction)
7. Append the week's posts to `generatedPosts` array atomically
8. Update `progress` counters
9. If `weekIndex < weeks-1`, schedule the next week. Else mark `status: "ready"`.

### `POST /api/sub-accounts/[id]/social-content/[batchId]/export`

**Auth:** sub-account member.

Returns CSV with columns:
`dayOffset, platform, caption, hashtags, imagePrompt, ctaText, suggestedTime`

## Prompt engineering — the make-or-break

The output of this feature lives or dies on the prompts. The system prompt template (see `src/lib/social-content/prompts.ts` in this commit) breaks into four sections:

1. **Persona** — "You are a senior social media manager who has run paid + organic campaigns for [industry] businesses in [location]."
2. **Platform rules** — different for each platform:
   - **Facebook**: 1-3 sentences, 1-2 emoji max, conversational, 0-3 hashtags
   - **Instagram**: 1-2 sentences caption + line break + 5-8 hashtags, emoji-heavy ok
   - **LinkedIn**: 3-5 sentences, professional, story-led, 0-3 hashtags
   - **X**: ≤280 chars, punchy, 1-2 hashtags max
3. **Content variety constraints** — the week's 5-7 posts must cover at least 3 of: educational, behind-the-scenes, social proof, offer, community, question/poll. No two posts on the same content type back-to-back.
4. **Output format** — strict JSON schema. Reject + retry once on parse failure.

## UI surface

**Page:** `/sa/[subAccountId]/ai-agents/social-content`

**States:**
- **No batches yet:** "Create your first content plan" CTA → wizard
- **Wizard:** 6-step (industry → location → voice → products → audience → cadence). Each step has live validation. Submit triggers generate route, redirects to results page with `batchId`.
- **Generating:** progress bar + live-streamed posts as each week's QStash callback completes (Firestore `onSnapshot`)
- **Ready:** results table (platform filter, edit inline, approve, export CSV)

## Component plan (filenames to create)

```
src/components/social-content/
  wizard.tsx                  6-step form
  results-table.tsx           filterable, editable, approve toggles
  post-card.tsx               individual post preview
  cadence-picker.tsx          platforms + posts/week picker
  export-button.tsx           CSV download
```

## Files in this commit (foundation only)

- `docs/social-content-generator-spec.md` (this file)
- `src/types/social-content.ts` (the Firestore type, hand-typed for next dev)
- `src/lib/social-content/prompts.ts` (system prompt template + platform rules)
- `src/lib/social-content/schema.ts` (validation helpers + JSON parse)
- `src/app/api/sub-accounts/[id]/social-content/generate/route.ts` (route stub with TODO comments)
- `src/app/api/social-content/generate-step/route.ts` (QStash callback stub)

**These are scaffolds, not working code.** Next session: implement, test, iterate prompts, ship UI.

## Phase 2 roadmap (after Phase 1 ships)

| # | Feature | Estimate |
|---|---|---|
| 1 | Buffer push integration (most popular scheduler) | 3 days |
| 2 | Later push integration | 2 days |
| 3 | Direct Facebook + Instagram posting via Meta Graph API | 1 wk |
| 4 | LinkedIn organic post API | 4 days |
| 5 | AI image generation (FAL.ai or Replicate) per post | 3-5 days |
| 6 | A/B test mode: 2 variants per post + winner-pick after first 24h | 1 wk |
| 7 | Topical injection: connect to Google Trends / Twitter trends / news for timely posts | 1 wk |

## Open questions for next session

1. **Model selection:** Claude Sonnet 4.7 vs Opus 4.7 for content gen? Cost/quality tradeoff. Recommendation: Sonnet 4.7 default, Opus 4.7 as a per-tier upgrade for Territory Partner tier.
2. **Image prompt format:** plain text (today) vs structured (for Phase 2 direct image gen integration)
3. **Localization:** v1 is English-only. Spanish + bilingual for southeast US markets in v2?
4. **Compliance:** does generated content for regulated industries (healthcare, legal, financial) need disclaimer injection? Likely yes — add an industry classifier to the prompt with auto-disclaimer for flagged categories.
