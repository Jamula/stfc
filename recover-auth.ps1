$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host 'Stopped: PowerShell 7 or later is required. Run pwsh -NoProfile -File .\recover-auth.ps1.'
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Stopped: Node.js is required before recovery. Nothing was written.'
    exit 1
}
Push-Location $PSScriptRoot
try {
    & node --input-type=module -e 'import { chromium } from "playwright"; import { existsSync } from "node:fs"; await import("yaml"); if (!existsSync(chromium.executablePath())) process.exit(1);' 2>$null
    $preflightExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($preflightExitCode -ne 0) {
    Write-Host 'Stopped: install the project dependencies and Playwright Chromium before recovery. Nothing was written.'
    exit 1
}

if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env')) {
    Write-Host 'Stopped: this worktree already has an .env. Nothing was changed.'
    exit 1
}

Write-Host 'Paste the complete STFC_ACCOUNTS backup as ONE LINE of JSON at the masked prompt.'
Write-Host 'Do not paste it into chat. It will be stored as plaintext in this worktree''s ignored .env.'
$secure = Read-Host 'Complete backup' -AsSecureString
$pointer = [IntPtr]::Zero
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $baseline = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $secure.Dispose()
}

try {
    if ($baseline -match '[\r\n]' -or $baseline.Contains("'") -or $baseline.Contains('\')) {
        throw 'unsupported format'
    }
    $document = [System.Text.Json.JsonDocument]::Parse($baseline)
    if ($document.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
        throw 'not an array'
    }
    $names = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($entry in $document.RootElement.EnumerateArray()) {
        if ($entry.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'not an object' }
        $name = $entry.GetProperty('name')
        $token = $entry.GetProperty('token')
        if ($name.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $token.ValueKind -ne [System.Text.Json.JsonValueKind]::String) { throw 'invalid field' }
        $nameValue = $name.GetString()
        if ([string]::IsNullOrWhiteSpace($nameValue) -or
            $token.GetString() -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' -or
            -not $names.Add($nameValue)) { throw 'invalid account' }
        $propertyNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($property in $entry.EnumerateObject()) {
            if (-not $propertyNames.Add($property.Name)) { throw 'duplicate property' }
        }
    }
    if ($names.Count -eq 0) { throw 'empty backup' }
} catch {
    Write-Host 'Stopped: backup must be a nonempty single-line JSON array of unique named JWT accounts, without backslashes or apostrophes. Nothing was written.'
    exit 1
}

Write-Host "Backup contains $($names.Count) account(s)."
Write-Host 'Continue only if this is the current complete backup and all redemption workflows and concurrent .env updates are stopped until completion.'
if ((Read-Host 'Type YES to confirm both conditions') -cne 'YES') {
    Write-Host 'Stopped. Nothing was written.'
    exit 1
}

try {
    $stream = [System.IO.File]::Open((Join-Path $PSScriptRoot '.env'), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
        try { $writer.WriteLine("STFC_ACCOUNTS='$baseline'") } finally { $writer.Dispose() }
    } finally { $stream.Dispose() }
} catch {
    Write-Host 'Stopped: could not safely create .env. No account data was sent to GitHub.'
    exit 1
} finally {
    $baseline = $null
    $document.Dispose()
}

$environmentNames = @('STFC_EMAIL', 'STFC_PASSWORD', 'STFC_OTP', 'STFC_DEBUG_DIR')
$previousEnvironment = @{}
foreach ($key in $environmentNames) {
    $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
try {
    foreach ($key in @('STFC_EMAIL', 'STFC_PASSWORD', 'STFC_OTP', 'STFC_DEBUG_DIR')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'Process')
    }
    Write-Host 'Starting the visible browser. Sign in with email and OTP in the browser, not in this terminal.'
    Write-Host 'At the hidden prompt, enter the accountId from your independently verified official /auth/me response.'
    & node (Join-Path $PSScriptRoot 'scripts\capture-token.mjs') --timeout 900
    $captureExitCode = $LASTEXITCODE
} finally {
    foreach ($key in $environmentNames) {
        [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process')
    }
}
if ($captureExitCode -ne 0) {
    Write-Host 'Capture failed or the local backup could not be updated. Check the preceding message before retrying.'
    exit $captureExitCode
}
