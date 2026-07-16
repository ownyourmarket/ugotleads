#!/bin/bash
# ============================================================
# uGotLeads — Vendor Update Script (leadstack-agency upstream)
#
# This deployment has UNRELATED history with upstream (main began
# as a squashed snapshot) and has diverged heavily, so this script
# does NOT auto-merge. It refreshes the local `vendor` mirror
# branch and reports what changed upstream; features are then
# ported selectively (see "Vendor Update Workflow" in CLAUDE.md).
#
# Usage:
#   bash update-from-vendor.sh                  # refresh vendor + report
#   bash update-from-vendor.sh <upstream-url>   # first run: adds remote
#
# Upstream is the private mirror https://github.com/ownyourmarket/leadstack-agency
# (forking is disabled on the source repo). When run on a machine with
# gh auth to the source repo, this script first refreshes the mirror
# from the true vendor source; in cloud sessions that step is skipped
# and the mirror is used as-is.
#
# Config (override via env): UPSTREAM_BRANCH=main  SOURCE_URL=<vendor source>
# ============================================================

set -e

SOURCE_URL="${SOURCE_URL:-https://github.com/Claude-Code-Pro-Camp/leadstack-agency.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

git rev-parse --git-dir > /dev/null 2>&1 || fail "Not inside a git repo."

# ── 1. Ensure upstream remote ───────────────────────────────
if ! git remote get-url upstream > /dev/null 2>&1; then
  [ -n "$1" ] || fail "No 'upstream' remote. First run: bash update-from-vendor.sh <vendor-repo-url>"
  git remote add upstream "$1"
  log "Added upstream remote: $1"
fi

# ── 2. Refresh mirror from the true vendor source (best effort) ─
# Needs gh/git auth to the source repo — succeeds locally, skipped in cloud.
if git fetch "$SOURCE_URL" "$UPSTREAM_BRANCH" 2>/dev/null; then
  if git push upstream "FETCH_HEAD:refs/heads/$UPSTREAM_BRANCH" 2>/dev/null; then
    log "Mirror refreshed from vendor source"
  else
    warn "Fetched vendor source but could not push to mirror — push manually"
  fi
else
  warn "Vendor source unreachable from here — using mirror as-is"
fi

# ── 3. Fetch upstream → update vendor branch (clean mirror) ─
git fetch upstream "$UPSTREAM_BRANCH"
log "Fetched upstream/$UPSTREAM_BRANCH"

if git show-ref --verify --quiet refs/heads/vendor; then
  if [ -n "$(git rev-list upstream/$UPSTREAM_BRANCH..vendor 2>/dev/null)" ]; then
    fail "vendor branch has commits not in upstream. It must stay a clean mirror — never commit there."
  fi
fi
git branch -f vendor "upstream/$UPSTREAM_BRANCH"
log "vendor branch updated to upstream/$UPSTREAM_BRANCH ($(git rev-parse --short vendor))"

# Keep the mirror visible to cloud sessions too (non-fatal if it fails)
git push origin vendor 2>/dev/null && log "vendor pushed to origin" || \
  warn "Could not push vendor to origin — push it manually when convenient"

# ── 4. Report what changed upstream (NO auto-merge) ─────────
echo ""
echo "Upstream delta vs main (top-level dirs):"
git diff --stat main vendor -- ':!pnpm-lock.yaml' | tail -1
git diff --name-only main vendor | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head -15

echo ""
echo "Next steps (selective port — do NOT blind-merge, histories are unrelated):"
echo "  1. Review upstream changes:  git log vendor --oneline -20"
echo "     Diff a feature area:      git diff main vendor -- src/lib/comms/"
echo "  2. Port wanted features onto a branch off main (cherry-pick or re-implement)"
echo "  3. Save each port as a patch: git diff HEAD~1 > patches/NNN-name.patch"
echo "  4. Add a Patch Registry row in patches/README.md (intent, files, decisions)"
echo "  5. pnpm install, deploy Firestore rules if upstream added any, git push"
