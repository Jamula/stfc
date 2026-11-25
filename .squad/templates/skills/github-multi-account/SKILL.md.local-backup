---
name: github-multi-account
description: Detect and set up account-locked gh aliases for multi-account GitHub. The AI reads this skill, detects accounts, asks the user which is personal/work, and runs the setup automatically.
confidence: high
source: https://github.com/tamirdresher/squad-skills/tree/main/plugins/github-multi-account
author: tamirdresher
---

# GitHub Multi-Account — AI-Driven Setup

## When to Activate
When the user has multiple GitHub accounts (check with `gh auth status`). If you see 2+ accounts listed, this skill applies.

## What to Do (as the AI agent)

### Step 1: Detect accounts
Run: `gh auth status`
Look for multiple accounts. Note which usernames are listed.

### Step 2: Ask the user
Ask: "I see you have multiple GitHub accounts: {list them}. Which one is your personal account and which is your work/EMU account?"

### Step 3: Run the setup automatically
Once the user confirms, do ALL of this for them:

If the profile already defines either alias, setup stops for explicit migration.
Review the existing definitions with the user and update only the approved managed
block to the definitions below, preserving their confirmed accounts and unrelated
profile content. Do not silently skip old definitions or append duplicates.

```powershell
# 1. Define the functions
$personal = "THEIR_PERSONAL_USERNAME"
$work = "THEIR_WORK_USERNAME"

# 2. Add to PowerShell profile
$profilePath = $PROFILE.CurrentUserAllHosts
if (!(Test-Path $profilePath)) { New-Item -Path $profilePath -Force | Out-Null }
$existing = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
if ($existing -match "gh-personal|gh-work") {
    throw "Existing GitHub account aliases require migration. Review and update the managed profile block before continuing."
}
$block = @"

# === GitHub Multi-Account Aliases ===
function gh-personal { gh auth switch --user $personal | Out-Null; if (`$LASTEXITCODE -ne 0) { throw "GitHub account switch failed." }; gh @args }
function gh-work { gh auth switch --user $work | Out-Null; if (`$LASTEXITCODE -ne 0) { throw "GitHub account switch failed." }; gh @args }
Set-Alias ghp gh-personal
Set-Alias ghw gh-work
"@
Add-Content -Path $profilePath -Value $block

# 3. Create CMD wrappers
$binDir = Join-Path $env:USERPROFILE ".squad\bin"
if (!(Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
"@echo off`ngh auth switch --user $personal >nul && gh %*" | Out-File "$binDir\ghp.cmd" -Encoding ascii
"@echo off`ngh auth switch --user $work >nul && gh %*" | Out-File "$binDir\ghw.cmd" -Encoding ascii

# 4. Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notmatch [regex]::Escape($binDir)) {
    [Environment]::SetEnvironmentVariable("PATH", "$binDir;$userPath", "User")
    $env:PATH = "$binDir;$env:PATH"
}

# 5. Load in current session
function gh-personal { gh auth switch --user $personal | Out-Null; if ($LASTEXITCODE -ne 0) { throw "GitHub account switch failed." }; gh @args }
function gh-work { gh auth switch --user $work | Out-Null; if ($LASTEXITCODE -ne 0) { throw "GitHub account switch failed." }; gh @args }
Set-Alias ghp gh-personal
Set-Alias ghw gh-work
```

### Step 4: Verify for the user
Open a new PowerShell session after installation or migration. Verify that both
aliases use the confirmed accounts and that a failed switch terminates without
running the requested command. Run these and show the results:
```powershell
ghp api user --jq '.login'   # should show personal username
ghw api user --jq '.login'   # should show work username
```

### Step 5: Tell the user
"All set! From now on use `ghp` for personal repos and `ghw` for work repos. I'll use them too."

## After Setup — Usage Rules

1. **NEVER** use bare `gh` for repo operations — always `ghp` or `ghw`
2. **NEVER** manually `gh auth switch` — the aliases handle it
3. Determine alias by repo owner:
   - Personal account repos → `ghp` / `gh-personal`
   - Work/EMU account repos → `ghw` / `gh-work`

## For Squad Agents
Use the aliases configured from the user's confirmed account selection. Do not
redefine them with account names from another user or repository. If the aliases
are unavailable, complete setup and verification before performing repo operations.

## Attribution and license

This skill includes adapted material from the AI-driven setup version of
[tamirdresher/squad-skills at `2452efe4`](https://github.com/tamirdresher/squad-skills/blob/2452efe4855be89945e71942fb2a6c1600b6f14f/plugins/github-multi-account/SKILL.md).
The following notice applies to that upstream material:

MIT License

Copyright (c) 2025 Tamir Dresher

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
