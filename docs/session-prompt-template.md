# Reusable Claude Code session prompt (uGotLeads / MyUSA repos)

CLAUDE.md is authoritative — the session prompt shrinks to the task:

```
Read CLAUDE.md first; it is authoritative, including platform-layer
boundaries and deployment guardrails.

Task: [what to build/fix]
Scope: [files/surfaces in bounds — and anything explicitly out of bounds]
Definition of done: [tests pass / preview renders / migration staged, etc.]
Bucket: [revenue | costs | efficiency] within [30/60] days.

Work autonomously within scope. Commit to branch [branch-name].
Do not push, deploy, or touch env vars — list those as my manual steps.
```

## Scheduled unattended runs (Windows)

The original recipe assumed cron + bash. On this machine (Windows 11) use
**Task Scheduler + PowerShell** instead:

`C:\Users\starr\bin\nightly-ugotleads.ps1`:
```powershell
Set-Location C:\Users\starr\.claude\ugotleads
claude -p "Read CLAUDE.md. Run the test suite; fix failures with surgical changes only. Commit each logical fix to branch nightly-fixes with clear messages. End with a summary of changes and my manual steps. Never push." `
  --permission-mode dontAsk `
  --allowedTools "Read(./**)" "Edit(./src/**)" "Write(./src/**)" `
    "Bash(pnpm test*)" "Bash(pnpm run lint*)" `
    "Bash(git add *)" "Bash(git commit *)" "Bash(git checkout *)" `
  *>> "$HOME\claude-logs\nightly-$(Get-Date -Format yyyy-MM-dd).log"
```

Schedule: Task Scheduler → Create Basic Task → weekdays 2:00 AM →
Start a program → `powershell.exe -File C:\Users\starr\bin\nightly-ugotleads.ps1`.

Morning routine: read the log, review the `nightly-fixes` branch, merge and
push yourself. Deploy stays manual — the guardrail survives automation.

Do NOT use `--dangerously-skip-permissions` on your working machine; it is
for throwaway containers/VMs only. The deny + dontAsk setup gives you the
autonomy without the exposure.
