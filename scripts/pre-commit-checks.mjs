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

export const MUTABLE_SQUAD_STATE_PATTERNS = [
  /^\.squad\/agents\/[^/]+\/history\.md$/,
  // Matches both the bare `history-archive.md` and timestamped variants
  // such as `history-archive-2026-06-02.md` or
  // `history-archive-20260602T044144Z.md` (see PR #314 review — Uhura's
  // archive was split into dated snapshots that the original bare-only
  // pattern missed).
  /^\.squad\/agents\/[^/]+\/history-archive(-[^/]+)?\.md$/,
  /^\.squad\/casting\/history\.json$/,
  /^\.squad\/decisions\/decisions\.md$/,
  /^\.squad\/decisions\.md$/,
  /^\.squad\/decisions\/inbox\//,
  /^\.squad\/identity\//,
  /^\.squad\/log\//,
  // `.squad/memory/config.json` is the static, version-controlled policy
  // file (default provider, prompt-only fallback, external providers) —
  // it is not backend-owned mutable state and must stay trackable. Every
  // other path under `.squad/memory/` (e.g. index.json) is backend-owned
  // and remains guarded.
  /^\.squad\/memory\/(?!config\.json$)/,
  /^\.squad\/orchestration-log\//,
  /^\.squad\/sessions\//,
  /^\.squad\/\.scratch\//,
  /^\.squad\/\.cache\//,
  /^\.squad\/\.watch-pids$/,
  /^\.squad\/ralph-circuit-breaker\.json$/,
  /^\.squad\/fact-checker\/audit-trail\.md$/,
  /^\.squad\/rai\/audit-trail\.md$/,
];

// One-time migration allowlist: these backend-owned paths were tracked
// before the configured state backend existed. They may be removed from
// the index (via `git rm --cached`, preserving the working-tree file) as
// part of the migration, but must never be staged again afterward. This
// is an exact, enumerated list — not a general deletion bypass.
export const MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST = new Set([
  '.squad/decisions/decisions.md',
  '.squad/identity/now.md',
  '.squad/identity/wisdom.md',
  '.squad/casting/history.json',
  '.squad/rai/audit-trail.md',
  '.squad/agents/bashir/history-archive.md',
  '.squad/agents/garak/history-archive.md',
  '.squad/agents/kirk/history-archive.md',
  '.squad/agents/obrien/history-archive.md',
  '.squad/agents/picard/history-archive.md',
  '.squad/agents/scotty/history-archive.md',
  '.squad/agents/tuvok/history-archive.md',
  '.squad/agents/uhura/history-archive.md',
  // Uhura's archive is split into dated snapshots rather than the bare
  // filename above (see PR #314 review).
  '.squad/agents/uhura/history-archive-2026-06-02.md',
  '.squad/agents/uhura/history-archive-20260602T044144Z.md',
  // `.squad/log/**` and `.squad/orchestration-log/**`: the Scribe audit
  // completed and the coordinator authorized this migration (see PR #314
  // discussion). Scribe classified three durable items from these logs;
  // their substantive content already lives in the tracked
  // `.squad/decisions-archive.md` (Rules 6/7 + Rule 5, Chronicle tips,
  // model overrides) — see that file, which is NOT edited by this
  // migration. The 109 paths below (21 `.squad/log/**` +
  // 88 `.squad/orchestration-log/**`) are untracked index-only; their
  // physical copies remain in the worktree and are now gitignored.
  '.squad/log/2026-05-08T21-14-47-speckit-briefing.md',
  '.squad/log/2026-05-08T21-33-38Z-speckit-v1.1-critique.md',
  '.squad/log/2026-05-17-long-session.md',
  '.squad/log/2026-05-17T204203Z-ralph-phase3.md',
  '.squad/log/2026-05-17T21_39Z-003-discord-oauth-shipped.md',
  '.squad/log/2026-05-18T00-ralph-round-1.md',
  '.squad/log/2026-05-18T00-ralph-round-3-audit-resolution.md',
  '.squad/log/2026-05-18T01-42-55-stfc-discovery.md',
  '.squad/log/2026-05-18T01-ralph-round-4-issue-62-closeout.md',
  '.squad/log/2026-05-18T022130Z-issue-51-noop-dispatch.md',
  '.squad/log/2026-05-18T024500Z-discord-ops-automation.md',
  '.squad/log/2026-05-18T025530Z-pr-71-merged.md',
  '.squad/log/2026-05-31-issue-74-ingest-stfc-sheet.md',
  '.squad/log/2026-05-31T195500Z-issue-76-discord-channel-blocked.md',
  '.squad/log/2026-05-31T20-10-41Z-crew-optimizer-kickoff.md',
  '.squad/log/2026-06-01T03-55-pr124-merged.md',
  '.squad/log/2026-06-01T03-cleanup-pr1-merged.md',
  '.squad/log/2026-06-02T03-03-50Z-pr-triage-fanout.md',
  '.squad/log/2026-06-02T03-38-00Z-triage-and-slash-arch.md',
  '.squad/log/20260531-223000-v1-shipped.md',
  '.squad/log/20260531-crew-data-layer-cli.md',
  '.squad/orchestration-log/2026-05-08T21-14-47-copilot-directive.md',
  '.squad/orchestration-log/2026-05-08T21-14-47-picard.md',
  '.squad/orchestration-log/2026-05-08T21-17-25-scotty.md',
  '.squad/orchestration-log/2026-05-08T21-18-05-uhura.md',
  '.squad/orchestration-log/2026-05-08T21-19-30-bashir.md',
  '.squad/orchestration-log/2026-05-08T21-20-15-borg-queen.md',
  '.squad/orchestration-log/2026-05-08T21-33-38Z-bashir.md',
  '.squad/orchestration-log/2026-05-08T21-33-38Z-borg-queen.md',
  '.squad/orchestration-log/2026-05-08T21-33-38Z-picard.md',
  '.squad/orchestration-log/2026-05-08T21-33-38Z-scotty.md',
  '.squad/orchestration-log/2026-05-08T21-33-38Z-uhura.md',
  '.squad/orchestration-log/2026-05-17T07-kirk-pr22-review.md',
  '.squad/orchestration-log/2026-05-17T07-picard-pr23-triage-review.md',
  '.squad/orchestration-log/2026-05-17T13-scotty-pr22-impl.md',
  '.squad/orchestration-log/2026-05-17T16-tuvok2-pr23-rules.md',
  '.squad/orchestration-log/2026-05-17T16-tuvok3-chronicle-tips.md',
  '.squad/orchestration-log/2026-05-17T16-tuvok4-models-refresh.md',
  '.squad/orchestration-log/2026-05-17T16-uhura-pr33-devcontainer.md',
  '.squad/orchestration-log/2026-05-17T204203Z-speckit-implement-phase3.md',
  '.squad/orchestration-log/2026-05-17T21_39_42Z-scribe.md',
  '.squad/orchestration-log/2026-05-18T00-picard-1.md',
  '.squad/orchestration-log/2026-05-18T00-picard.md',
  '.squad/orchestration-log/2026-05-18T00-tuvok-1.md',
  '.squad/orchestration-log/2026-05-18T00-tuvok.md',
  '.squad/orchestration-log/2026-05-18T01-39-34-uhura-discord-discovery.md',
  '.squad/orchestration-log/2026-05-18T01-40-30-uhura-news-7day.md',
  '.squad/orchestration-log/2026-05-18T01-tuvok-2.md',
  '.squad/orchestration-log/2026-05-18T022130Z-speckit-implement.md',
  '.squad/orchestration-log/2026-05-18T024500Z-bashir.md',
  '.squad/orchestration-log/2026-05-18T024500Z-obrien.md',
  '.squad/orchestration-log/2026-05-18T024500Z-scotty.md',
  '.squad/orchestration-log/2026-05-18T024500Z-tuvok.md',
  '.squad/orchestration-log/2026-05-18T025530Z-garak.md',
  '.squad/orchestration-log/2026-05-18T025530Z-kirk.md',
  '.squad/orchestration-log/2026-05-18T025530Z-picard.md',
  '.squad/orchestration-log/2026-05-31T19-41-23Z-picard.md',
  '.squad/orchestration-log/2026-05-31T19-41-23Z-scribe.md',
  '.squad/orchestration-log/2026-05-31T195500Z-scribe.md',
  '.squad/orchestration-log/2026-05-31T195500Z-uhura.md',
  '.squad/orchestration-log/2026-05-31T20-10-41Z-obrien.md',
  '.squad/orchestration-log/2026-05-31T20-10-41Z-picard.md',
  '.squad/orchestration-log/2026-05-31T20-10-41Z-research-officer-db.md',
  '.squad/orchestration-log/2026-06-01T03-55-pr124-post-merge.md',
  '.squad/orchestration-log/2026-06-02T03-03-50Z-kirk-1.md',
  '.squad/orchestration-log/2026-06-02T03-03-50Z-kirk.md',
  '.squad/orchestration-log/2026-06-02T03-03-50Z-picard.md',
  '.squad/orchestration-log/2026-06-02T03-03-50Z-uhura.md',
  '.squad/orchestration-log/2026-06-02T03-38-00Z-kirk.md',
  '.squad/orchestration-log/2026-06-02T03-38-00Z-picard.md',
  '.squad/orchestration-log/20260531-221500-scotty-pr-101.md',
  '.squad/orchestration-log/20260531-221501-kirk-pr-101.md',
  '.squad/orchestration-log/20260531-221502-bashir-pr-101.md',
  '.squad/orchestration-log/20260531-221503-garak-pr-101.md',
  '.squad/orchestration-log/20260531-221504-uhura-pr-101.md',
  '.squad/orchestration-log/20260531-221505-obrien-pr-102.md',
  '.squad/orchestration-log/20260531-221506-kirk-pr-102.md',
  '.squad/orchestration-log/20260531-221507-bashir-pr-102.md',
  '.squad/orchestration-log/20260531-221508-garak-pr-102.md',
  '.squad/orchestration-log/20260531-221509-uhura-pr-102.md',
  '.squad/orchestration-log/20260531-221510-tuvok-pr-103.md',
  '.squad/orchestration-log/20260531-221511-picard-pr-103.md',
  '.squad/orchestration-log/20260531-221512-kirk-pr-103.md',
  '.squad/orchestration-log/20260531-221513-garak-pr-103.md',
  '.squad/orchestration-log/20260531-221514-uhura-pr-103.md',
  '.squad/orchestration-log/20260531-221515-scotty-pr-103.md',
  '.squad/orchestration-log/20260531-221516-coordinator-issue84.md',
  '.squad/orchestration-log/20260531-bashir-100-gate.md',
  '.squad/orchestration-log/20260531-bashir-99-gate.md',
  '.squad/orchestration-log/20260531-garak-100-r1.md',
  '.squad/orchestration-log/20260531-garak-100-r2.md',
  '.squad/orchestration-log/20260531-garak-99-r1.md',
  '.squad/orchestration-log/20260531-garak-99-r2.md',
  '.squad/orchestration-log/20260531-kirk-100.md',
  '.squad/orchestration-log/20260531-kirk-99.md',
  '.squad/orchestration-log/20260531-scotty-79.md',
  '.squad/orchestration-log/20260531-scotty-80.md',
  '.squad/orchestration-log/20260531-uhura-100-fix.md',
  '.squad/orchestration-log/20260531-uhura-99-fix.md',
  '.squad/orchestration-log/bashir-banner-fix-2026-06-01T031440Z.md',
  '.squad/orchestration-log/garak-pr128-2026-06-01T031440Z.md',
  '.squad/orchestration-log/kirk-pr126-2026-06-01T031440Z.md',
  '.squad/orchestration-log/kirk-pr128-2026-06-01T031440Z.md',
  '.squad/orchestration-log/obrien-phase-a-2026-06-01T031440Z.md',
  '.squad/orchestration-log/picard-pr125-2026-06-01T031440Z.md',
  '.squad/orchestration-log/picard-pr128-2026-06-01T031440Z.md',
  '.squad/orchestration-log/scotty-rule-audit-2026-06-01T031440Z.md',
  '.squad/orchestration-log/tuvok-1-phase-b-2026-06-01T031440Z.md',
  '.squad/orchestration-log/tuvok-phase-a-2026-06-01T031440Z.md',
]);

/**
 * Mutable Squad state must be persisted through the configured backend,
 * not staged or committed from the working tree. Only paths in the deletion
 * allowlist above may be deleted as part of migrating them off direct git
 * tracking.
 *
 * `renamedFrom` is the list of source paths for staged renames/copies (see
 * `parseNameStatus`). A rename whose *source* matches a mutable-state
 * pattern is always a violation, regardless of what the destination path
 * looks like or whether the source is in the deletion allowlist: renaming
 * mutable state onto an ordinary tracked path commits its content under a
 * disguised name, and `git diff --name-only`/`--diff-filter=D` alone would
 * never surface the source path to catch it (rename detection reports only
 * the destination). The deletion allowlist stays reserved for genuine
 * `git rm --cached` untracking, which leaves no new tracked content behind.
 */
export function checkSquadBoundary(staged, deleted = [], renamedFrom = []) {
  const deletedPaths = new Set(deleted);
  const violations = staged.filter((f) =>
    !(deletedPaths.has(f) && MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(f)) &&
      MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(f)),
  );

  const renameViolations = renamedFrom.filter((f) =>
    MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(f)),
  );

  const allViolations = [...new Set([...violations, ...renameViolations])];
  if (allViolations.length === 0) return;

  fail(
    'Mutable Squad state must be persisted through the configured state backend, ' +
      'not staged or committed from the working tree.\n' +
      `  Offending files:\n${allViolations.map((f) => `    - ${f}`).join('\n')}`,
  );
}

// ── Staged-change parsing (renames/copies) ───────────────────────────

/**
 * Parse `git diff --cached --name-status -z -M -C` output into the three
 * lists the boundary check needs.
 *
 * `-z` (NUL-delimited, no quoting) makes this robust against filenames
 * containing spaces, unicode, or characters Git would otherwise quote in
 * its human-readable `--name-status` format. `-M -C` enable rename and
 * copy detection explicitly rather than relying on the repository's
 * `diff.renames` config.
 *
 * For a rename/copy, `--name-status -z` emits `<status>\0<old>\0<new>\0`;
 * every other status emits `<status>\0<path>\0`.
 *
 * - `staged`: every path that will exist in the tree after this commit
 *   (added, modified, or the destination of a rename/copy).
 * - `deleted`: paths removed outright (`D`) — used for the one-time
 *   `git rm --cached` migration allowlist.
 * - `renamedFrom`: source paths of renames/copies — checked independently
 *   so a rename out of a mutable-state path can't bypass the guard.
 */
export function parseNameStatus(raw) {
  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();

  const staged = [];
  const deleted = [];
  const renamedFrom = [];

  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      staged.push(newPath);
      renamedFrom.push(oldPath);
    } else if (kind === 'D') {
      deleted.push(tokens[i++]);
    } else {
      staged.push(tokens[i++]);
    }
  }

  return { staged, deleted, renamedFrom };
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
