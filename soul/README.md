# UGotLeads — SOUL Files

SOUL.md files define the identity, behavior, and operating rules for every AI agent working on UGotLeads. Each file is a focused briefing document — not code, not configuration, but clear instructions that tell an agent who it is, what it values, and how it should act.

## Structure

```
soul/
  brand/SOUL.md                        — Core brand identity, voice, and values
  agents/code-engineer/SOUL.md         — Code tasks, architecture, and implementation
  agents/marketing-copywriter/SOUL.md  — Sales copy, landing pages, and messaging
  agents/compliance-reviewer/SOUL.md   — Partner language, income claims, legal framing
  agents/customer-onboarding/SOUL.md   — Setup flows, operator activation, user success
  agents/founder-operator-advisor/SOUL.md — Business strategy, pricing, revenue planning
```

## How to Use

1. Every agent starts with `brand/SOUL.md` — it's the foundation.
2. If your task matches a specialized agent, also read that agent's SOUL.md.
3. SOUL files do not change application logic. They change behavior and judgment.

## Maintenance

Update these files when brand positioning evolves, new legal constraints apply, or a new agent role is added. Version changes should be documented in the relevant SOUL.md file's footer.
