# patches/ — Customization Patches & Port Registry

This repo is a heavily customized deployment of upstream
`Claude-Code-Pro-Camp/leadstack-agency`. The histories are **unrelated**
(main started from a squashed snapshot, 2026-05-24) and this deployment has
diverged by hundreds of files — so vendor updates are **selectively ported**,
never blind-merged. See "Vendor Update Workflow" in CLAUDE.md.

## What lives here

One `.patch` file per ported upstream feature or protected customization,
numbered in apply/port order:

```
010-voice-port.patch
020-territories-port.patch
```

## Creating a patch

After landing a port or customization as a single commit:

```bash
git diff HEAD~1 > patches/010-your-feature.patch
```

## Re-applying a patch

```bash
git apply --3way patches/010-your-feature.patch
```

If it fails, the patch is the **reference spec** — read it for intent,
re-implement manually on the current code, then regenerate it.

## Patch Registry

Every patch MUST have a row here. This table is the spec Claude uses to
re-apply a customization when the patch file no longer applies.

Existing customizations (branding, pricing, agency multi-tenant, AI agents,
voice port, gitpage builder, …) predate this registry — their record is the
git history itself (`git log` since `cca8961`) and the feature sections in
CLAUDE.md (e.g. "Voice Port — Stubbed Integration Points"). New ports and
conflict re-implementations get a patch + row from now on.

| Patch | What it does | Files touched | Design decisions |
|-------|--------------|---------------|------------------|
| _(none yet)_ | | | |
