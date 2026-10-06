/**
 * Pre-commit enforcement checks, extracted for testability.
 *
 * Each function receives the list of staged file paths and throws
 * (via process.exit) when a policy violation is detected.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Helpers ──────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n❌  pre-commit: ${msg}\n`);
  process.exit(1);
}

function defaultReadFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function defaultExists(p) {
  return fs.existsSync(p);
}

// ── Check #9 — Mutable Squad state must use the configured backend ───

const MUTABLE_SQUAD_STATE_PATTERNS = [
  /^\.squad\/agents\/[^/]+\/history\.md$/,
  /^\.squad\/agents\/[^/]+\/history-archive\.md$/,
  /^\.squad\/casting\/history\.json$/,
  /^\.squad\/decisions\/decisions\.md$/,
  /^\.squad\/decisions\.md$/,
  /^\.squad\/decisions\/inbox\//,
  /^\.squad\/log\//,
  /^\.squad\/memory(?:\/|$)/,
  /^\.squad\/orchestration-log\//,
  /^\.squad\/sessions\//,
  /^\.squad\/\.scratch\//,
  /^\.squad\/\.cache\//,
  /^\.squad\/\.watch-pids$/,
  /^\.squad\/ralph-circuit-breaker\.json$/,
  /^\.squad\/fact-checker\/audit-trail\.md$/,
  /^\.squad\/rai\/audit-trail\.md$/,
];

const MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST = new Set([
  '.squad/decisions/decisions.md',
]);

/**
 * Mutable Squad state must be persisted through the configured backend,
 * not staged or committed from the working tree. Only the canonical decisions
 * ledger may be deleted as part of its migration.
 */
export function checkSquadBoundary(staged, deleted = []) {
  const deletedPaths = new Set(deleted);
  const violations = staged.filter((f) =>
    !(deletedPaths.has(f) && MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(f)) &&
      MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(f)),
  );
  if (violations.length === 0) return;

  fail(
    'Mutable Squad state must be persisted through the configured state backend, ' +
      'not staged or committed from the working tree.\n' +
      `  Offending files:\n${violations.map((f) => `    - ${f}`).join('\n')}`,
  );
}

// ── Check #11 — Staged filenames must be valid on Windows ───────────

// Characters Windows forbids in filenames. Colons are the ones that actually
// bit us: 21 `.squad/log/` and `.squad/orchestration-log/` files created in
// the Linux Codespace carried names like `2026-05-12T05:16:11Z-...`. They
// could never be checked out on Windows, and once they left the index Git for
// Windows refused to restore them — which blocked *every* commit in the repo
// until they were untracked. See #186.
const WINDOWS_ILLEGAL_CHARS_RE = /[:*?"<>|]/;

/**
 * Reject staged paths containing characters that are illegal in Windows
 * filenames. The repo is worked on from both Windows and Linux Codespaces, so
 * a name that is legal for the author can be permanently unusable for someone
 * else — and, as #186 showed, can wedge the whole repository.
 */
export function checkPortableFilenames(staged, exists = defaultExists) {
  const violations = staged.filter((f) => {
    // Deleted legacy files with non-portable names should be allowed to leave
    // the index; only paths that still exist can wedge a future checkout.
    if (!exists(f)) return false;
    // Only the final segments matter; a path separator is not the problem.
    return f.split('/').some((segment) => WINDOWS_ILLEGAL_CHARS_RE.test(segment));
  });
  if (violations.length === 0) return;

  fail(
    'Filenames must be valid on Windows — these contain one of : * ? " < > |\n' +
      `${violations.map((f) => `    - ${f}`).join('\n')}\n` +
      '  For timestamps use 2026-08-13T04-38-00Z, not 2026-08-13T04:38:00Z.',
  );
}

// ── Check #10 — Workflow YAML edits must include pinning tests ───────

/**
 * Find test files referencing a workflow filename.
 * Returns an array of relative file paths (may be empty).
 */
export function grepTestsForWorkflow(basename) {
  const matches = [];
  const pending = ['tests'];

  while (pending.length > 0) {
    const dir = pending.pop();
    if (!dir) continue;

    let entries;
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
          if (fs.readFileSync(filePath, 'utf8').includes(basename)) {
            matches.push(filePath.replaceAll(path.sep, '/'));
          }
        } catch {
          // Ignore unreadable test files, matching the previous grep behavior.
        }
      }
    }
  }

  return matches.sort();
}

/**
 * When a `.github/workflows/*.yml` file is staged, any test file that
 * references it by name must also be staged.
 *
 * Excludes `tests/scripts/pre-commit.test.ts` — that file references
 * workflow filenames only as fixture strings to exercise this hook
 * itself, not as pinning regression guards.
 *
 * @param staged  List of staged file paths.
 * @param grep    Optional grep function (for testing). Defaults to grepTestsForWorkflow.
 */
export function checkWorkflowPinningTests(staged, grep = grepTestsForWorkflow) {
  const workflowFiles = staged.filter((f) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f),
  );
  if (workflowFiles.length === 0) return;

  const errors = [];

  for (const wf of workflowFiles) {
    const basename = path.basename(wf);
    const referencingTests = grep(basename).filter(
      (t) =>
        t.replace(/\\/g, '/').replace(/^\.\//, '') !==
        'tests/scripts/pre-commit.test.ts',
    );

    const unstagedTests = referencingTests.filter((t) => {
      const rel = t.replace(/\\/g, '/').replace(/^\.\//, '');
      return !staged.includes(rel);
    });

    for (const t of unstagedTests) {
      const rel = t.replace(/\\/g, '/').replace(/^\.\//, '');
      errors.push(
        `Edit to ${wf} found, but ${rel} references ${basename} and is not staged. Update pinning tests.`,
      );
    }
  }

  if (errors.length > 0) {
    fail(errors.join('\n'));
  }
}
