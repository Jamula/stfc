# cleanup.ps1 — one-shot teardown of the old Spark React app + Chrome extension.
#
# Run this ONCE after pulling the new code. It removes only the broken
# Spark project files. The new TypeScript skills CLI is left intact, as is
# your Squad / Spec Kit / Copilot tooling under .github/.
#
# Usage:
#   pwsh ./cleanup.ps1            # delete files via Remove-Item
#   pwsh ./cleanup.ps1 -Git       # delete via `git rm -rf` so deletions are staged
#
# Works on Windows PowerShell 5.1 and PowerShell 7+.

[CmdletBinding()]
param(
    [switch]$Git
)

$ErrorActionPreference = 'Stop'

function Remove-Path {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if ($Git) {
        & git rm -rf --quiet --ignore-unmatch -- $Path | Out-Null
    } else {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    Write-Host "removed: $Path"
}

# Old React/Spark app source — the new code (src/api, src/lib, src/skills,
# src/cli.ts) is NOT in this list.
'src/App.tsx',
'src/ErrorFallback.tsx',
'src/main.tsx',
'src/index.css',
'src/main.css',
'src/vite-end.d.ts',
'src/components',
'src/hooks',
'src/styles',
'src/lib/utils.ts',
'src/lib/types.ts',
'src/lib/gifts-data.ts',
# Old Chrome extension and its build helpers
'extension',
'scripts',
# Spark/Vite/Tailwind tooling and obsolete docs
'index.html',
'vite.config.ts',
'vite.config.extension.ts',
'tailwind.config.js',
'components.json',
'theme.json',
'runtime.config.json',
'spark.meta.json',
'.spark-initial-sha',
'EXTENSION_SUMMARY.md',
'INSTALLATION.md',
'PRD.md',
'QUICKSTART.md',
'SECURITY.md',
# Old node_modules and lockfile
'node_modules',
'package-lock.json' | ForEach-Object { Remove-Path $_ }

Write-Host ''
Write-Host 'Cleanup complete.'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1) npm install             # install the new dependencies'
Write-Host '  2) npm test                # run the test suite'
Write-Host '  3) npm run typecheck       # verify types'
Write-Host '  4) See docs/SETUP.md to capture your STFC store JWT and configure'
Write-Host '     the STFC_ACCOUNTS GitHub Actions secret.'
