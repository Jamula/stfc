#!/usr/bin/env node
/**
 * check-artifact-hygiene.ts
 *
 * Scans files for secret/token patterns.
 * Run locally before committing, or invoked by CI on PR-changed files.
 *
 * USAGE
 *   node scripts/check-artifact-hygiene.ts [--staged | --base-ref <ref>] [file ...]
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

interface SecretPattern {
  name: string;
  regex: RegExp;
  description: string;
  appliesTo?: readonly string[];
}

interface HygieneViolation {
  file: string;
  line: number;
  pattern: string;
  description: string;
}

const WATCHED_PREFIXES = [
  "specs/",
  "plans/",
  "tasks/",
  "docs/",
  "config/",
  ".github/",
  "data/digests/",
  "data/discord/",
  "data/crew/roster/",
  "discord/",
  "src/",
  "scripts/",
  "tests/",
  "api/",
  "web/",
  "worker/",
  "shared/",
];

const WATCHED_ROOT_FILES = new Set([
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
]);

const WATCHED_EXTENSIONS = /\.(md|txt|yaml|yml|json|jsonl|cjs|js|mjs|jsx|ts|tsx|mts|html|sh)$/i;

const PATTERNS: readonly SecretPattern[] = [
  {
    name: "JWT",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    description: "JWT token (3-segment base64url, eyJ... header)",
  },
  {
    name: "BEARER_TOKEN",
    regex: /Authorization:\s*(?:['"])?Bearer\s+(?!<[A-Za-z]|YOUR_|REPLACE)[A-Za-z0-9._~+/=-]{20,}/gi,
    description: "Authorization: Bearer header with non-placeholder token value",
  },
  {
    name: "GITHUB_TOKEN",
    regex: /gh[pousr]_[A-Za-z0-9]{36}/g,
    description: "GitHub personal/OAuth/server/user access token (gh[pousr]_...)",
  },
  {
    name: "AWS_ACCESS_KEY",
    regex: /AKIA[0-9A-Z]{16}/g,
    description: "AWS Access Key ID (AKIA...)",
  },
  {
    name: "API_KEY",
    regex: /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9]{20,}['"]?/gi,
    description: "Generic API key assignment with long alphanumeric value",
  },
  {
    name: "STFC_ACCOUNT_DATA",
    regex: /"(?:account_id|alliance_id|balance)"\s*:\s*[0-9]{4,}/g,
    description: 'STFC account data with numeric value >999 — use "<REDACTED>" placeholders in specs',
  },
  {
    name: "DISCORD_BOT_TOKEN_LITERAL",
    regex: /DISCORD_BOT_TOKEN/gi,
    description:
      "Literal DISCORD_BOT_TOKEN reference in a runtime artifact — the env-var name MUST NOT appear in digests or state files",
    appliesTo: ["data/digests/", "data/discord/"],
  },
  {
    name: "STFC_RAW_UPSTREAM_RESPONSE",
    regex: /"(?:access_token|refresh_token|id_token|player_token|session_token)"\s*:\s*"[^"]+"/g,
    description:
      "Raw upstream API response body (token-shaped field) — summaries must be pre-redacted via src/lib/redact.ts before any artifact write",
    appliesTo: ["data/digests/", "data/discord/"],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStagedFiles(): string[] {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--cached", "--diff-filter=ACMR"],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

function getAllTrackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function getChangedFiles(baseRef: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", "-z", `${baseRef}...HEAD`]);
  const decoded = out.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(out)) {
    throw new Error("Changed-file list contains a path that is not valid UTF-8.");
  }
  return decoded.split("\0").filter(Boolean);
}

function readStagedFile(filePath: string): string {
  return execFileSync("git", ["show", `:${filePath}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function isWatched(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    WATCHED_EXTENSIONS.test(normalized) &&
    (WATCHED_ROOT_FILES.has(normalized) ||
      WATCHED_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
  );
}

function scanFile(filePath: string, { staged = false }: { staged?: boolean } = {}): HygieneViolation[] {
  if (!staged && !existsSync(filePath)) return [];

  let content: string;
  try {
    content = staged ? readStagedFile(filePath) : readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ERROR: cannot read "${filePath}" — refusing to skip scan (${message})\n`);
    return [
      {
        file: filePath,
        line: 0,
        pattern: "READ_ERROR",
        description: "File could not be read for artifact hygiene scanning",
      },
    ];
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  const lines = content.split("\n");
  const found: HygieneViolation[] = [];

  for (const pattern of PATTERNS) {
    if (pattern.appliesTo && !pattern.appliesTo.some((p) => normalizedPath.startsWith(p))) {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? "";
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(lineText)) {
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
const useStaged = args.includes("--staged");
const baseRefIndex = args.indexOf("--base-ref");
if (args.filter((a) => a === "--base-ref").length > 1) {
  throw new Error("Only one --base-ref option may be provided.");
}
const baseRef = baseRefIndex >= 0 ? args[baseRefIndex + 1] : undefined;
const baseRefValueIndex = baseRefIndex >= 0 ? baseRefIndex + 1 : -1;
if (baseRefIndex >= 0 && (!baseRef || baseRef.startsWith("--"))) {
  throw new Error("--base-ref requires a Git ref.");
}
if (useStaged && baseRef !== undefined) {
  throw new Error("--staged and --base-ref cannot be used together.");
}

const fileArgs = args.filter(
  (arg, index) => !arg.startsWith("--") && index !== baseRefValueIndex,
);

let targets: string[];
if (useStaged) {
  targets = getStagedFiles().filter(isWatched);
} else if (baseRef !== undefined) {
  targets = getChangedFiles(baseRef).filter(isWatched);
} else if (fileArgs.length > 0) {
  targets = fileArgs;
} else {
  targets = getAllTrackedFiles().filter(isWatched);
}

if (targets.length === 0) {
  process.stdout.write("Artifact hygiene: no applicable files to scan. ✓\n");
  process.exit(0);
}

let totalViolations = 0;
for (const file of targets) {
  for (const v of scanFile(file, { staged: useStaged })) {
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
      `  4. For false positives: refine the scanner rule and add a regression test.\n\n` +
      `See: .github/copilot-instructions.md — Artifact Hygiene\n`,
  );
  process.exit(1);
}

process.stdout.write(`Artifact hygiene: ${targets.length} file(s) scanned, 0 violations. ✓\n`);
process.exit(0);
