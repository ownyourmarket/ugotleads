# AI Provider & Token Cap Spec (Phase 1)

> Status: Spec locked 2026-05-25. Not yet implemented. **Build this BEFORE the AI Social Content Generator** — that feature consumes high token volume per generation, and uncapped hosted usage = runaway OpenRouter bills on the agency key.

## Goal

Two AI provider modes per sub-account:

1. **Hosted (default)** — uses the agency's OpenRouter API key. Subject to a monthly token cap baked into the tier price (no per-token metered billing, no surprise invoices).
2. **BYOK** — operator pastes their own OpenRouter key. Unlimited usage. No platform markup.

Markup model: **invisible**. The tier subscription price (197 / 297 / 497) includes a monthly token allowance. Above the allowance, hosted users see a friendly fallback message and an email prompting them to upgrade tier or switch to BYOK.

## Tier allowances (initial)

| Tier | Price | Hosted monthly cap | Approx model cost (Haiku 4.5) | Effective markup |
|---|---|---|---|---|
| Local Pro | $197/mo | 1,000,000 tokens | ~$3 | ~65× |
| Multi-Service Operator | $297/mo | 5,000,000 tokens | ~$15 | ~20× |
| Territory Partner | $497/mo | 15,000,000 tokens | ~$45 | ~11× |

(Markups look high but absorb fixed platform costs: Firebase, Vercel, Stripe fees, support time. Adjust caps based on real-world usage data after first 30 days.)

BYOK users: no cap enforcement. Their OpenRouter account is theirs.

## Firestore schema additions

### `subAccounts/{id}` — new fields

```ts
aiProvider: {
  mode: "hosted" | "byok";
  // BYOK fields (only when mode === "byok"):
  byokKeyEncrypted?: string;           // Firestore field-level encryption (see below)
  byokKeyLast4?: string;               // for UI display ("sk-or-...XXXX")
  byokKeyValidatedAt?: Timestamp;       // null if never validated
}
aiUsage: {
  currentPeriodTokens: number;          // resets monthly via cron
  currentPeriodStart: Timestamp;
  monthlyCapTokens: number;             // derived from current tier; cached here for fast checks
  lifetimeTokens: number;
  lastWarningAt?: Timestamp;            // throttle warning emails
}
```

### `usage/{subAccountId}/billing/{YYYY-MM}` — historical rollup

```ts
{
  periodStart: Timestamp;
  periodEnd: Timestamp;
  tokensUsed: number;
  callCount: number;
  capExceeded: boolean;
  tier: string;                         // snapshot of tier at period close
}
```

## Code changes

### `src/lib/comms/ai/openrouter.ts` — key resolution

```ts
// Today: const apiKey = process.env.OPENROUTER_API_KEY
// Becomes:
async function resolveApiKey(subAccountId: string): Promise<string> {
  const sa = await getSubAccount(subAccountId);
  if (sa.aiProvider?.mode === "byok") {
    if (!sa.aiProvider.byokKeyEncrypted) throw new AIError("byok_missing");
    return decryptByokKey(sa.aiProvider.byokKeyEncrypted);
  }
  // hosted — also check cap before allowing the call
  if (sa.aiUsage.currentPeriodTokens >= sa.aiUsage.monthlyCapTokens) {
    throw new AIError("cap_exceeded");
  }
  return process.env.OPENROUTER_API_KEY!;
}
```

### Cap-exceeded handling

Three call sites consume AI today:
- `/api/webhooks/twilio/inbound` (SMS auto-reply)
- `/api/web-chat/message` (Web Chat)
- `/api/sub-accounts/[id]/ai-agent/test` (dry-run)

Each catches `AIError("cap_exceeded")` and returns a friendly fallback:
- **SMS**: "Thanks for reaching out — someone will be in touch shortly." (operator's escalation email gets a notice if not sent in the last 24h)
- **Web Chat**: same fallback in the iframe
- **Test**: 402 Payment Required with `{ error: "cap_exceeded", capacityResetAt }`

Operator gets an email (max 1/day):
> "Your AI usage for this month has reached the {tier} cap. To keep AI responses live: upgrade to a higher tier, or add your own OpenRouter API key (Settings → AI Provider → BYOK). Your usage resets on {date}."

### Token meter — on every successful call

```ts
await db.doc(`subAccounts/${saId}`).update({
  "aiUsage.currentPeriodTokens": FieldValue.increment(usedTokens),
  "aiUsage.lifetimeTokens": FieldValue.increment(usedTokens),
});
```

### Monthly reset — QStash cron

```ts
// /api/cron/ai-usage-reset — runs daily at 02:00 UTC, signature-verified
for each sub-account:
  if (now >= aiUsage.currentPeriodStart + 30 days):
    1. Snapshot to usage/{saId}/billing/{YYYY-MM}
    2. Reset currentPeriodTokens = 0
    3. Set currentPeriodStart = now
    4. Refresh monthlyCapTokens from current tier (handles upgrades)
```

### BYOK key encryption

Use Firestore field-level encryption via Google Cloud KMS:
- Key ring: `projects/ugotleads-c2fdf/locations/global/keyRings/byok-keys/cryptoKeys/sub-account-byok`
- Encrypt on save in `/api/sub-accounts/[id]/ai-provider/route.ts` (PATCH)
- Decrypt server-side only when calling OpenRouter
- Never log decrypted key, never return decrypted to client
- Store `last4` separately for UI

Alternative if KMS feels heavy: use Vercel's `VERCEL_ENV_KEY` symmetric encryption with a 256-bit secret in env. Sufficient for v1; migrate to KMS later if compliance demands.

## UI surface

New page: `/sa/[subAccountId]/settings/ai-provider`

**Sections:**
1. **Mode toggle:** Hosted (default) vs BYOK radio
2. **If Hosted:**
   - Current usage bar: `X / Y tokens this period (resets in Z days)`
   - "Upgrade tier" link to billing portal
3. **If BYOK:**
   - Input: "Your OpenRouter API key" (paste, show last 4)
   - Validate button: makes a test call to OpenRouter, confirms key works
   - "Switch back to Hosted" link
4. **Historical usage:** chart of last 6 months billing rollups

## API routes

```
GET    /api/sub-accounts/[id]/ai-provider     — read current config (no key value, just mode + last4)
PATCH  /api/sub-accounts/[id]/ai-provider     — switch mode / set BYOK key
DELETE /api/sub-accounts/[id]/ai-provider/key — remove BYOK key, fall back to hosted
POST   /api/sub-accounts/[id]/ai-provider/validate — test BYOK key against OpenRouter
POST   /api/cron/ai-usage-reset               — QStash-signed monthly reset
```

## Migration path

For existing sub-accounts (today: just Star's "Main"):
1. On first read after deploy, lazy-initialize `aiProvider = { mode: "hosted" }` and `aiUsage = { currentPeriodTokens: 0, ... }`
2. Cap defaults to Local Pro tier (1M) until the sub-account has a Stripe subscription resolving to a higher tier

## Order of operations

1. **Phase 1 (this spec)** — ship the cap + BYOK system
2. **Phase 2** — ship the AI Social Content Generator (per `docs/social-content-generator-spec.md`)
3. **Phase 3 (later)** — if usage data shows hosted-tier caps too tight, adjust per-tier caps OR introduce a $7/mo "extra 1M tokens" overage SKU

## Open questions

1. **Hard cap or soft cap?** Spec assumes hard (block past cap). Soft (allow but warn at 80% / 100% / 150%) is friendlier but creates real cost risk. Recommendation: hard. Operator can upgrade or BYOK to unblock.
2. **Should the AI Social Content Generator have its own token budget separate from chat?** Social content can spike usage (50K per generation × 4/mo = 200K). Recommendation: no separate budget, just include in the monthly cap. Caps were sized to absorb this.
3. **Model selection per tier?** Today everyone uses Haiku 4.5. Should Territory Partner ($497/mo) get Sonnet 4.7 by default for better content quality? Recommendation: yes, but defer until usage data shows demand.
