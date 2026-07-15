# Trading OS — Phase B: Brief for Securities Counsel

**Status:** Requirements + questions for outside counsel. **Not legal advice.**
**Owner:** Star Riley / MyUSA (uGotLeads)
**Prepared by:** uGotLeads product/eng (Code Engineer + Compliance Reviewer SOUL agents)
**Companion docs:** `trading-os-module-spec.md` (architecture), this repo's `firestore.rules`

> This document exists to hand a securities/investment-management attorney so
> they can scope the regulated build. It states **business intent** and
> **technical facts**, and asks the **questions we need answered before writing
> any execution code.** It deliberately does **not** draw legal conclusions,
> cite specific statutes, or assume a structure — those are counsel's calls.
> Nothing in Phase B ships until counsel signs off.

---

## 1. One-paragraph business intent

uGotLeads is a white-label AI CRM platform. We have shipped **Phase A** of a
"Trading OS" module: an AI **research / strategy / backtesting / risk-analysis
workspace**, plus a **self-directed** brokerage link (the user connects their
OWN Alpaca account; paper by default; the user places any live trades
themselves). **Phase B** is the ambition the client actually asked for: an
**AI-powered offering where agents trade on behalf of clients according to each
client's personal risk level and proven strategies** — i.e., something that
looks like discretionary asset management or a fund. We understand this crosses
from "software" into "regulated financial activity" and want counsel to define
the compliant path (or tell us it isn't viable as imagined).

## 2. What is already built (Phase A) — the compliance boundary we hold today

These are enforced in code today and are the line we do **not** cross without counsel:

- **No discretion.** The agent never places a trade for anyone. It produces
  research, strategies, backtests, Monte Carlo, and risk reports the human reads.
- **No custody.** We never hold, move, or have withdrawal rights over client funds.
- **No pooling.** No client capital is combined.
- **Self-directed only.** The brokerage connection links the *user's own*
  account. Live mode is gated behind an explicit agency allowlist flag and the
  user pulls the trigger. Credentials are never stored in our database.
- **Disclaimers everywhere.** A non-dismissible "research/educational, not
  investment advice, past performance…, risk of loss" banner on every surface.
- **Audit logging** of every agent run.

## 3. What Phase B would add (the regulated intent)

Any one of these is the thing that changes the analysis. We want counsel to tell
us which are viable, under what structure, and what each requires:

- **(A) Discretionary management of individual client accounts** — the agent
  (or the firm) decides and executes trades in a client's account by the
  client's risk profile, for compensation.
- **(B) A pooled vehicle ("fund")** — multiple clients' capital pooled and
  traded by a common strategy/GP.
- **(C) Model/signal delivery with client-side auto-execution** — we generate
  the trades; a connected broker auto-places them under a standing authorization.
- **(D) Personalized recommendations for a fee** — even without execution.

We are **not** asking counsel to pick the business model for us; we're asking
what each of A–D legally requires so we can choose.

## 4. Questions we need counsel to answer

Grouped so counsel can quote scope. (Phrased as questions, not assertions.)

### Registration & licensing
1. For each of models A–D above, what registrations/licenses are triggered
   (investment adviser vs broker-dealer; federal vs state), and at what
   thresholds (AUM, number of clients, state of residence)?
2. Does an **AI making the trade decisions** change the adviser analysis vs a
   human? Any specific guidance on algorithmic/robo-advice we must follow?
3. What are the realistic timelines and cost ranges for the registration path
   counsel would recommend?

### Structure & custody
4. If we pool capital (model B), what entity structure and roles are required
   (GP/LP or LLC/manager, fund administrator, auditor, custodian)?
5. What custody arrangements are acceptable so that **we never take custody** —
   e.g., client keeps their own brokerage account, third-party custodian,
   qualified custodian requirements?
6. Is there a structure where the **client's own account + a limited trading
   authorization** avoids pooling/custody entirely while still letting an agent
   execute? What are its limits?

### Client eligibility & onboarding
7. Accredited-investor / qualified-client gating: when is it required, and how
   must we verify it?
8. What client agreements, disclosures (e.g., Form ADV-equivalent brochure),
   risk disclosures, and fee disclosures are mandatory, and what must they say?
9. Suitability / know-your-client obligations for mapping a "personal risk
   level" to a strategy — what's the standard and what records must we keep?

### Conduct, marketing & records
10. What are the rules on performance advertising, backtested results, and
    testimonials for whichever structure we choose? (We already avoid income
    guarantees per our brand compliance rules — what more is required?)
11. Fiduciary duty scope and conflicts-of-interest disclosures.
12. Books-and-records and reporting requirements we must build for (retention
    periods, trade blotters, client statements, audit trails).

### Multi-tenant / white-label wrinkle
13. uGotLeads is **multi-tenant and white-label** — sub-account operators
    ("licensed operators / territory partners") would run this for *their*
    clients. Does each operator need their own registration, or can a structure
    make uGotLeads (or a single entity) the registrant with operators as IARs /
    solicitors? This materially changes the product design.
14. Solicitor/referral rules if operators introduce clients.

### Data, cross-border, and tech
15. Any requirements specific to storing client financial data / connecting to
    brokerages via API (beyond ordinary security) for a registrant?
16. If any operator or client is outside the US, what changes?

## 5. Technical guardrails already in place (so counsel knows what we can enforce)

Counsel should know these are switches we can flip and controls we can build:

- Per-workspace **agency allowlist flag** already gates live trading
  (`liveTradingEnabledByAgency`); nothing live happens without it.
- **Role gating** precedent exists (outbound voice campaigns are owner/admin-only
  until a dependency ships) — we can gate Phase B actions to specific roles.
- **Full audit logging** of agent runs; we can extend to a trade blotter.
- Credentials are **vaulted off-platform**; we can meet a "no custody, no key
  storage" requirement.
- We can build **hard kill-switches**, per-client mandates, and
  eligibility-gated onboarding once counsel specifies them.

## 6. What we will NOT do until counsel signs off

- No discretionary execution code.
- No pooling of funds.
- No personalized "buy X" recommendations delivered for a fee.
- No marketing that implies returns, performance, or "managed" money.

## 7. Deliverables we'd like from counsel

1. A recommended structure (or a "don't do this / do this instead").
2. The registration/licensing path + realistic timeline & cost.
3. A checklist of documents, disclosures, and controls we must build.
4. Sign-off gate: an explicit "you may begin building the following" list so
   engineering can scope Phase B from a compliant spec.

---

*This brief is for engagement of a licensed securities attorney. It is not
legal advice and makes no representation about the law. uGotLeads will not
build or launch Phase B functionality without written legal sign-off.*
