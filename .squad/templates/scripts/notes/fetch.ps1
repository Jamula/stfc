#!/usr/bin/env pwsh
# scripts/notes/fetch.ps1
# ─────────────────────────────────────────────────────────────────────────────
# Fetch git notes from remote. Run on every Ralph-watch startup and before
# any agent reads or writes notes.
#
# Usage:
#   ./scripts/notes/fetch.ps1           # fetch only
#   ./scripts/notes/fetch.ps1 -Setup    # first-time: add tracking refspec + fetch
#   ./scripts/notes/fetch.ps1 -Merge    # fetch + fast-forward local notes
# ─────────────────────────────────────────────────────────────────────────────

[CmdletBinding()]
param(
    [string]$Remote   = "origin",
    [string]$RepoPath = ".",
    [switch]$Setup,
    [switch]$Merge,
    [switch]$Quiet
)

function Log ([string]$msg, [string]$color = "White") {
    if (-not $Quiet) { Write-Host "[notes/fetch] $msg" -ForegroundColor $color }
}

$repo = Resolve-Path $RepoPath
$trackingPrefix = "refs/squad/notes-remotes/$Remote"
$refspec = "+refs/notes/*:${trackingPrefix}/*"

function Assert-NoNotesMerge {
    foreach ($name in @("NOTES_MERGE_PARTIAL", "NOTES_MERGE_REF")) {
        $path = git -C $repo rev-parse --git-path $name
        if ($LASTEXITCODE -ne 0) { Write-Error "Failed to locate notes merge state."; exit 1 }
        if (-not [System.IO.Path]::IsPathRooted($path)) { $path = Join-Path $repo $path }
        if (Test-Path $path) {
            Write-Error "A notes merge is already in progress. Resolve or abort it before syncing notes; its state was not changed."
            exit 1
        }
    }
}

if ($Merge) { Assert-NoNotesMerge }

# ── One-time setup: add fetch refspec ──────────────────────────────────────
if ($Setup) {
    # Remove the old destructive mapping when upgrading an existing setup.
    git -C $repo config --fixed-value --unset-all "remote.$Remote.fetch" "refs/notes/*:refs/notes/*" 2>&1 | Out-Null
    git -C $repo config --fixed-value --unset-all "remote.$Remote.fetch" "+refs/notes/*:refs/notes/*" 2>&1 | Out-Null
    git -C $repo config --fixed-value --unset-all "remote.$Remote.fetch" "+refs/notes/*:refs/remotes/$Remote/notes/*" 2>&1 | Out-Null
    git -C $repo config --fixed-value --unset-all "remote.$Remote.fetch" "refs/notes/*:refs/remotes/$Remote/notes/*" 2>&1 | Out-Null
    $existing = @(git -C $repo config --get-all "remote.$Remote.fetch" 2>&1)
    if ($existing -contains $refspec) {
        Log "Notes refspec already configured." DarkGray
    } else {
        git -C $repo config --add "remote.$Remote.fetch" $refspec
        if ($LASTEXITCODE -ne 0) { Write-Error "Failed to configure notes refspec."; exit 1 }
        Log "Added notes refspec to remote.$Remote.fetch" Green
    }
}

# ── Fetch notes ─────────────────────────────────────────────────────────────
Log "Fetching notes from $Remote..."
$output = git -C $repo fetch --prune --refmap= $Remote $refspec 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to fetch notes from ${Remote}: $output"
    exit 1
} else {
    Log "Notes fetched." Green
}

# ── Fast-forward notes if requested ─────────────────────────────────────────
if ($Merge) {
    $remoteRefs = git -C $repo for-each-ref "$trackingPrefix/squad/" --format="%(refname)" 2>&1
    foreach ($remoteRef in $remoteRefs) {
        Assert-NoNotesMerge
        $ns = $remoteRef.Substring($trackingPrefix.Length + 1)
        $localRef = "refs/notes/$ns"
        $remoteOid = git -C $repo rev-parse --verify $remoteRef 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to read tracking notes for ${ns}: $remoteOid"
            exit 1
        }
        $localOid = git -C $repo rev-parse --verify --quiet $localRef 2>&1
        if ($LASTEXITCODE -eq 1) {
            # An all-zero old value requires that the ref still not exist.
            $localOid = "0" * $remoteOid.Length
        } elseif ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to read local notes for ${ns}: $localOid"
            exit 1
        } elseif ($localOid -eq $remoteOid) {
            continue
        } else {
            git -C $repo merge-base --is-ancestor $remoteOid $localOid 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { continue }
            git -C $repo merge-base --is-ancestor $localOid $remoteOid 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Local and remote notes for $ns diverged; reconcile them manually without discarding either history."
                exit 1
            }
        }
        Log "Fast-forwarding notes: $ns"
        $updateOutput = git -C $repo update-ref $localRef $remoteOid $localOid 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Notes for $ns changed concurrently; no update was applied. Retry synchronization. $updateOutput"
            exit 1
        }
    }
    Log "Notes synchronization complete." Green
}

# ── Show available namespaces ────────────────────────────────────────────────
if (-not $Quiet) {
    $refs = git -C $repo for-each-ref "refs/notes/squad/" --format="%(refname)" 2>&1
    if ($refs) {
        Log "Available namespaces:"
        foreach ($r in $refs) {
            $count = (git -C $repo notes --ref=($r -replace "refs/notes/","") list 2>&1 |
                      Where-Object { $_ -ne "" } | Measure-Object -Line).Lines
            Log "  $r  ($count notes)" DarkGray
        }
    } else {
        Log "No squad notes yet." DarkGray
    }
}
