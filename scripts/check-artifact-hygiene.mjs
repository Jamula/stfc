#!/usr/bin/env node
/**
 * check-artifact-hygiene.mjs
 *
 * Scans files for secret/token patterns per Constitution Principle VII.
 * Run locally before committing, or invoked by CI on PR-changed files.
 *
 * USAGE
 *   node scripts/check-artifact-hygiene.mjs [--staged] [file ...]
 *
 *   --staged       Scan git-staged files (pre-commit use)
 *   [file ...]     Scan the explicit file paths given as arguments
 *   (no args)      Scan all tracked files under watched directories
 *
 * EXIT CODES
 *   0   No violations found
 *   1   One or more violations found — remediate before committing / merging
 *
 * FALSE POSITIVES
 *   Add [skip-token-scan] to your PR description to bypass the CI gate.
 *   Document why it is a false positive in the PR body.
 *
 * Principle VII — Artifact Hygiene
 *   Development artifacts MUST NOT contain real tokens, JWTs, or
 *   unsanitized account data. Use <REDACTED> placeholders instead.
 *   See: .specify/memory/constitution.md §VII
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Directories watched for secrets when no explicit files are provided.
const WATCHED_PREFIXES = [
  'specs/',
  'plans/',
  'tasks/',
  '.specify/memory/',
  '.specify/templates/',
  'docs/',
  '.github/',
  'data/digests/',
  'data/discord/',
];

const WATCHED_EXTENSIONS = /\.(md|txt|yaml|yml|json|jsonl)$/i;

/**
 * Secret patterns to detect.
 * Each entry must use the `g` flag (lastIndex is reset per line).
 *
 * `appliesTo` (optional): if present, the pattern is only applied to files
 * whose path starts with one of these prefixes. Used to scope artifact-only
 * patterns (e.g. the literal "DISCORD_BOT_TOKEN", which legitimately appears
 * in specs/contracts but MUST NOT appear in data/digests or data/discord).
 *
 * IMPORTANT: the scanner NEVER logs the matched value.
 * Output always shows <REDACTED-TOKEN> where the secret would appear.
 */
const PATTERNS = [
  {
    name: 'JWT',
    // Standard 3-segment base64url JWT starting with eyJ (base64url of '{"').
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    description: 'JWT token (3-segment base64url, eyJ... header)',
  },
  {
    name: 'BEARER_TOKEN',
    // Flags Authorization: Bearer headers carrying a non-placeholder value.
    // Excludes <REDACTED>, <TOKEN>, YOUR_*, REPLACE_* style placeholders.
    regex: /Authorization:\s*(?:['"])?Bearer\s+(?!<[A-Za-z]|YOUR_|REPLACE)[A-Za-z0-9._~+/=-]{20,}/gi,
    description: 'Authorization: Bearer header with non-placeholder token value',
  },
  {
    name: 'GITHUB_TOKEN',
    // Covers ghp_ (personal), gho_ (OAuth), ghs_ (server), ghu_ (user)
    regex: /gh[pousr]_[A-Za-z0-9]{36}/g,
    description: 'GitHub personal/OAuth/server/user access token (gh[pousr]_...)',
  },
  {
    name: 'AWS_ACCESS_KEY',
    regex: /AKIA[0-9A-Z]{16}/g,
    description: 'AWS Access Key ID (AKIA...)',
  },
  {
    name: 'API_KEY',
    regex: /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9]{20,}['"]?/gi,
    description: 'Generic API key assignment with long alphanumeric value',
  },
  {
    name: 'STFC_ACCOUNT_DATA',
    // Flags account_id, alliance_id, or balance JSON fields with numeric
    // values > 999 (4+ digits). These suggest real account data was pasted.
    // Spec examples must use placeholder strings, not real numeric IDs.
    regex: /"(?:account_id|alliance_id|balance)"\s*:\s*[0-9]{4,}/g,
    description: 'STFC account data with numeric value >999 — use "<REDACTED>" placeholders in specs',
  },
  {
    name: 'DISCORD_BOT_TOKEN_LITERAL',
    // The literal string DISCORD_BOT_TOKEN MUST NOT appear in runtime
    // artifacts (digests, state files) — its only legitimate homes are
    // source code, tests, specs, and contracts. Scoped to artifact dirs to
    // avoid false positives on the spec/contract files that document the
    // variable by name.
    regex: /DISCORD_BOT_TOKEN/gi,
    description: 'Literal DISCORD_BOT_TOKEN reference in a runtime artifact — the env-var name MUST NOT appear in digests or state files',
    appliesTo: ['data/digests/', 'data/discord/'],
  },
  {
    name: 'STFC_RAW_UPSTREAM_RESPONSE',
    // Heuristic for raw upstream STFC API response bodies leaking into
    // committed artifacts (FR-025 / Principle VII / digest-writer contract
    // § Forbidden contents). Matches obvious upstream-token JSON shapes:
    //   "access_token":"…", "refresh_token":"…", "id_token":"…"
    // Scoped to artifact dirs because contracts/spec files reference these
    // field names by design.
    regex: /"(?:access_token|refresh_token|id_token|player_token|session_token)"\s*:\s*"[^"]+"/g,
    description: 'Raw upstream API response body (token-shaped field) — summaries must be pre-redacted via src/lib/redact.ts before any artifact write',
    appliesTo: ['data/digests/', 'data/discord/'],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStagedFiles() {
  const out = execSync('git diff --name-only --cached --diff-filter=ACMR', { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function getAllTrackedFiles() {
  const out = execSync('git ls-files', { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/** Returns true if this file is within a watched directory and has a watched extension. */
function isWatched(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    WATCHED_EXTENSIONS.test(filePath) &&
    WATCHED_PREFIXES.some(prefix => normalized.startsWith(prefix))
  );
}

/** Scans a single file and returns an array of violation objects. */
function scanFile(filePath) {
  if (!existsSync(filePath)) return [];

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stderr.write(`WARNING: cannot read "${filePath}" — skipping (${err.message})\n`);
    return [];
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const lines = content.split('\n');
  const found = [];

  for (const pattern of PATTERNS) {
    if (pattern.appliesTo && !pattern.appliesTo.some(p => normalizedPath.startsWith(p))) {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      pattern.regex.lastIndex = 0; // reset stateful global regex
      if (pattern.regex.test(lines[i])) {
        found.push({
          file: filePath,
          line: i + 1,
          pattern: pattern.name,
          description: pattern.description,
        });
      }
    }
  }

  return found;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const useStaged = args.includes('--staged');
const fileArgs = args.filter(a => !a.startsWith('--'));

let targets;
if (useStaged) {
  targets = getStagedFiles().filter(isWatched);
} else if (fileArgs.length > 0) {
  targets = fileArgs;
} else {
  targets = getAllTrackedFiles().filter(isWatched);
}

if (targets.length === 0) {
  process.stdout.write('Artifact hygiene: no applicable files to scan. ✓\n');
  process.exit(0);
}

let totalViolations = 0;
for (const file of targets) {
  for (const v of scanFile(file)) {
    process.stderr.write(
      `VIOLATION  ${v.file}:${v.line}  [${v.pattern}]  ${v.description}\n` +
      `           matched content → <REDACTED-TOKEN>\n` +
      `           fix: replace with <REDACTED> placeholder\n`,
    );
    totalViolations++;
  }
}

if (totalViolations > 0) {
  process.stderr.write(
    `\nARTIFACT HYGIENE FAILED — ${totalViolations} violation(s) found\n\n` +
    `Remediation:\n` +
    `  1. Replace real token/key values with <REDACTED> placeholders.\n` +
    `  2. Move raw API captures to .env or an untracked local location.\n` +
    `  3. Use tests/fixtures/artifact-hygiene/clean-spec.md as a spec template.\n` +
    `  4. For false positives: add [skip-token-scan] to your PR description.\n\n` +
    `See: .specify/memory/constitution.md §VII — Artifact Hygiene\n`,
  );
  process.exit(1);
}

process.stdout.write(`Artifact hygiene: ${targets.length} file(s) scanned, 0 violations. ✓\n`);
process.exit(0);
