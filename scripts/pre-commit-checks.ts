/**
 * Pre-commit enforcement checks, extracted for testability.
 *
 * Each function receives the list of staged file paths and throws
 * (via process.exit) when a policy violation is detected.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface StagedRename {
  status: string;
  source: string;
  destination: string;
}

export interface ParsedNameStatus {
  staged: string[];
  deleted: string[];
  renamedFrom: string[];
  renames: StagedRename[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.error(`\n❌  pre-commit: ${msg}\n`);
  process.exit(1);
}

function defaultExists(p: string): boolean {
  return fs.existsSync(p);
}

// ── Staged-change parsing (renames/copies) ───────────────────────────

/**
 * Parse `git diff --cached --name-status -z -M -C` output.
 */
export function parseNameStatus(raw: string): ParsedNameStatus {
  const tokens = raw.split("\0");
  if (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();

  const staged: string[] = [];
  const deleted: string[] = [];
  const renamedFrom: string[] = [];
  const renames: StagedRename[] = [];

  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++] ?? "";
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = tokens[i++] ?? "";
      const newPath = tokens[i++] ?? "";
      staged.push(newPath);
      renamedFrom.push(oldPath);
      renames.push({ status, source: oldPath, destination: newPath });
    } else if (kind === "D") {
      const deletedPath = tokens[i++] ?? "";
      staged.push(deletedPath);
      deleted.push(deletedPath);
    } else {
      staged.push(tokens[i++] ?? "");
    }
  }

  return { staged, deleted, renamedFrom, renames };
}

// ── Check #11 — Staged filenames must be valid on Windows ───────────

const WINDOWS_ILLEGAL_CHARS_RE = /[:*?"<>|]/;

export function checkPortableFilenames(
  staged: string[],
  exists: (p: string) => boolean = defaultExists,
): void {
  const violations = staged.filter((f) => {
    if (!exists(f)) return false;
    return f.split("/").some((segment) => WINDOWS_ILLEGAL_CHARS_RE.test(segment));
  });
  if (violations.length === 0) return;

  fail(
    'Filenames must be valid on Windows — these contain one of : * ? " < > |\n' +
      `${violations.map((f) => `    - ${f}`).join("\n")}\n` +
      "  For timestamps use 2026-08-13T04-38-00Z, not 2026-08-13T04:38:00Z.",
  );
}

// ── Check #10 — Workflow YAML edits must include pinning tests ───────

export function grepTestsForWorkflow(basename: string): string[] {
  const matches: string[] = [];
  const pending = ["tests"];
  const escapedBasename = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filenamePattern = new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escapedBasename}(?=$|[^A-Za-z0-9_-])`,
  );

  while (pending.length > 0) {
    const dir = pending.pop();
    if (!dir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
      } else if (entry.isFile()) {
        try {
          if (filenamePattern.test(fs.readFileSync(filePath, "utf8"))) {
            matches.push(filePath.replaceAll(path.sep, "/"));
          }
        } catch {
          // Ignore unreadable test files, matching the previous grep behavior.
        }
      }
    }
  }

  return matches.sort();
}

export function checkWorkflowPinningTests(
  staged: string[],
  grep: (basename: string) => string[] = grepTestsForWorkflow,
): void {
  const workflowFiles = staged.filter((f) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f),
  );
  if (workflowFiles.length === 0) return;

  const errors: string[] = [];

  for (const wf of workflowFiles) {
    const basename = path.basename(wf);
    const referencingTests = grep(basename).filter(
      (t) =>
        t.replace(/\\/g, "/").replace(/^\.\//, "") !==
        "tests/scripts/pre-commit.test.ts",
    );

    const unstagedTests = referencingTests.filter((t) => {
      const rel = t.replace(/\\/g, "/").replace(/^\.\//, "");
      return !staged.includes(rel);
    });

    for (const t of unstagedTests) {
      const rel = t.replace(/\\/g, "/").replace(/^\.\//, "");
      errors.push(
        `Edit to ${wf} found, but ${rel} references ${basename} and is not staged. Update pinning tests.`,
      );
    }
  }

  if (errors.length > 0) {
    fail(errors.join("\n"));
  }
}
