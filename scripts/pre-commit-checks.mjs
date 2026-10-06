/**
 * Pre-commit enforcement checks, extracted for testability.
 *
 * Each function receives the list of staged file paths and throws
 * (via process.exit) when a policy violation is detected.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// ── Helpers ──────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n❌  pre-commit: ${msg}\n`);
  process.exit(1);
}

function defaultExecFileSync(cmd, args, options) {
  return execFileSync(cmd, args, options);
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
  // Two-layer/orphan backend inbox used to shuttle worktree-local writes
  // back to the owning branch; backend-owned, never a committable path.
  /^\.squad\/worktree-inbox\//,
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
  '.squad/memory/index.json',
  '.squad/memory/audit.jsonl',
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

const APPROVED_CASTING_HISTORY_MIGRATION_COPY = {
  source: '.squad/casting/history.json',
  destination: '.squad/templates/casting-history-migration.json',
  blob: 'd8f0154c77053e1cb4894277d4ee3630f6c86952',
};

/**
 * Mutable Squad state must be persisted through the configured backend,
 * not staged or committed from the working tree. Only paths in the deletion
 * allowlist above may be deleted as part of migrating them off direct git
 * tracking.
 *
 * `renamedFrom` and `renames` are the source paths and status-bearing entries
 * for staged renames/copies (see `parseNameStatus`). A rename/copy whose
 * source matches a mutable-state pattern is a violation, except for the one
 * exact R100 legacy casting-history migration seed and blob. The deletion
 * allowlist stays reserved for genuine `git rm --cached` untracking.
 */
export function checkSquadBoundary(
  staged,
  deleted = [],
  renamedFrom = [],
  renames = [],
  destHashes = new Map(),
) {
  const deletedPaths = new Set(deleted);
  const violations = staged.filter((f) =>
    !(deletedPaths.has(f) && MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(f)) &&
      MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(f)),
  );

  const isApprovedCastingHistoryMigrationRename = (rename) =>
    rename.status === 'R100' &&
    rename.source === APPROVED_CASTING_HISTORY_MIGRATION_COPY.source &&
    rename.destination === APPROVED_CASTING_HISTORY_MIGRATION_COPY.destination &&
    destHashes.get(rename.destination) === APPROVED_CASTING_HISTORY_MIGRATION_COPY.blob;
  const renameViolations = [];
  if (renames.length > 0) {
    for (const rename of renames) {
      if (
        MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(rename.source)) &&
        !isApprovedCastingHistoryMigrationRename(rename)
      ) {
        renameViolations.push(rename.source);
      }
    }

    const describedSources = new Set(renames.map((rename) => rename.source));
    for (const source of renamedFrom) {
      if (
        !describedSources.has(source) &&
        MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(source))
      ) {
        renameViolations.push(source);
      }
    }
  } else {
    renameViolations.push(
      ...renamedFrom.filter((source) =>
        MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(source)),
      ),
    );
  }

  const allViolations = [...new Set([...violations, ...renameViolations])];
  if (allViolations.length === 0) return;

  fail(
    'Mutable Squad state must be persisted through the configured state backend, ' +
      'not staged or committed from the working tree.\n' +
      `  Offending files:\n${allViolations.map((f) => `    - ${f}`).join('\n')}`,
  );
}

// ── Check #13 — Mutable Squad state copied from an untracked/ignored source ─
//
// `-C --find-copies-harder` (see the staged diff command in pre-commit.mjs)
// still only considers copy *sources* among blobs that are part of the
// diff — i.e. tracked content. An ignored/untracked mutable-state file
// (e.g. `.squad/agents/*/history.md`, which `.gitignore` deliberately
// excludes from tracking) was never part of any diff, so Git can never
// report it as a copy source no matter which rename/copy flags are passed.
// Copying its bytes into an ordinary tracked path is reported as a plain
// `A`dd. This check closes that gap independently of Git's own rename/copy
// detection, by comparing content hashes directly.

/**
 * Parse `git diff --cached --raw -z -M -C --find-copies-harder --abbrev=40`
 * output into a map of staged destination path -> full post-image blob SHA.
 *
 * `--abbrev=40` (equivalently `--no-abbrev`) is required: the raw format
 * abbreviates blob hashes by default, and an abbreviated hash cannot be
 * compared reliably against the full hash `git hash-object` reports for a
 * candidate source file.
 *
 * The raw format's header token is
 * `:<old-mode> <new-mode> <old-sha> <new-sha> <status>`, followed by
 * `\0<path>\0` (or `\0<old-path>\0<new-path>\0` for renames/copies).
 * Deletions have no post-image and are excluded.
 */
export function parseRawDiffDestHashes(raw) {
  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();

  const destHashes = new Map();
  let i = 0;
  while (i < tokens.length) {
    const header = tokens[i++];
    const fields = header.trim().split(/\s+/);
    const newSha = fields[3];
    const status = fields[4];
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      i++; // old path — unused here; parseNameStatus already covers sources
      const newPath = tokens[i++];
      destHashes.set(newPath, newSha);
    } else if (kind === 'D') {
      i++; // deleted path — no post-image blob to compare
    } else {
      const p = tokens[i++];
      destHashes.set(p, newSha);
    }
  }

  return destHashes;
}

/**
 * List mutable-state files under `.squad/` that exist on disk but are not
 * tracked by Git, whether ignored or not. These are exactly the paths Git's
 * own copy detection cannot see as copy sources.
 *
 * Deliberately does NOT catch/swallow errors: if `git ls-files` itself
 * fails, the caller must fail closed (see `checkNoUntrackedMutableStateCopies`)
 * rather than silently treating "the command errored" the same as "there is
 * nothing to check" — the latter would quietly disable this guard.
 */
export function listUntrackedMutableStateFiles(exec = defaultExecFileSync) {
  const raw = exec(
    'git',
    ['ls-files', '--others', '-z', '--', '.squad'],
    { encoding: 'utf8' },
  );
  return raw
    .split('\0')
    .filter(Boolean)
    .filter((f) => MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(f)));
}

/**
 * Compute the Git blob SHA Git would assign to `sourcePath`'s current
 * on-disk content if it were committed AT `destinationPath` — i.e. using
 * `destinationPath`'s working-tree `.gitattributes` to decide which clean
 * filters/line-ending normalization apply, not `sourcePath`'s own.
 *
 * This distinction is load-bearing: `git hash-object`'s default behavior
 * (no `--path` override) derives filter rules from the hashed file's OWN
 * path. A mutable-state source and an ordinary destination can be covered
 * by different `.gitattributes` rules (e.g. the source marked `-text` to
 * preserve bytes exactly, the destination marked `text eol=lf` to
 * normalize line endings) — then hashing the source under its own path
 * yields a blob SHA that never matches what Git actually staged for the
 * destination, even for byte-for-byte identical on-disk content, letting
 * an exact copy evade detection. Hashing under `--path=<destinationPath>`
 * reproduces exactly what `git add` would have produced for that content
 * at that destination.
 *
 * Deliberately does NOT catch/swallow errors: if `git hash-object` fails
 * (e.g. the file disappeared since it was listed), the caller must fail
 * closed rather than silently skipping the comparison.
 */
export function hashObjectForPath(sourcePath, destinationPath, exec = defaultExecFileSync) {
  return exec(
    'git',
    ['hash-object', '--filters', `--path=${destinationPath}`, '--', sourcePath],
    { encoding: 'utf8' },
  ).trim();
}

/** Attributes that affect Git's built-in clean conversions. */
const HASH_FILTER_ATTRS = [
  'text',
  'eol',
  'filter',
  'ident',
  'working-tree-encoding',
  'crlf',
];

function parseCheckAttrOutput(raw) {
  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();

  const valuesByPath = new Map();
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const [filePath, attr, value] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    if (!valuesByPath.has(filePath)) valuesByPath.set(filePath, {});
    valuesByPath.get(filePath)[attr] = value;
  }
  return valuesByPath;
}

function hashFilterSignature(values) {
  return JSON.stringify(HASH_FILTER_ATTRS.map((attr) => values[attr] ?? 'unspecified'));
}

/**
 * Batch-resolve the attributes that affect `git hash-object --filters
 * --path=<p>` using both the index and working-tree `.gitattributes`.
 * The index describes attributes when the destination blob was staged;
 * `hash-object` would use worktree attributes now. `--all` lets us resolve
 * built-in conversions while safely handling custom filter driver names.
 *
 * Paths can share one hash only when they have the same built-in conversion
 * attributes AND no custom filter driver. A clean filter command can use
 * `%f`, so even the same filter driver on two paths is not path-independent.
 *
 * Deliberately does NOT catch/swallow errors — propagates like
 * `listUntrackedMutableStateFiles` and `hashObjectForPath`, so the caller
 * fails closed.
 */
export function checkAttrSignatures(paths, exec = defaultExecFileSync) {
  if (paths.length === 0) return new Map();

  const parseAttributes = (args) =>
    parseCheckAttrOutput(exec('git', args, { encoding: 'utf8' }));
  const worktreeValues = parseAttributes(['check-attr', '--all', '-z', '--', ...paths]);
  const indexValues = parseAttributes(['check-attr', '--cached', '--all', '-z', '--', ...paths]);

  // `check-attr --all` omits attributes whose value is the reserved
  // "unspecified" state, which is indistinguishable there from an absent
  // filter attribute. Probe configured drivers only for the reserved values
  // that could be ambiguous in this result.
  const sentinelFilterValues = new Set(['set', 'unset', 'unspecified']);
  const configuredSentinelDrivers = new Set();
  const sentinelValuesToCheck = new Set();
  for (const path of paths) {
    for (const valuesByPath of [worktreeValues, indexValues]) {
      const values = valuesByPath.get(path) ?? {};
      if (!Object.prototype.hasOwnProperty.call(values, 'filter')) {
        sentinelValuesToCheck.add('unspecified');
      } else if (sentinelFilterValues.has(values.filter)) {
        sentinelValuesToCheck.add(values.filter);
      }
    }
  }

  for (const value of sentinelValuesToCheck) {
    try {
      const configured =
        exec(
          'git',
          ['config', '--null', '--get-regexp', `^filter\\.${value}\\.(clean|process)$`],
          { encoding: 'utf8' },
        ).length > 0;
      if (configured) configuredSentinelDrivers.add(value);
    } catch (err) {
      if (err?.status !== 1) throw err;
    }
  }

  const signatures = new Map();
  for (const path of paths) {
    const worktreeAttrs = worktreeValues.get(path) ?? {};
    const indexAttrs = indexValues.get(path) ?? {};
    const hasCustomFilter = [worktreeAttrs, indexAttrs].some((values) => {
      const hasFilterAttribute = Object.prototype.hasOwnProperty.call(values, 'filter');
      const filterValue = values.filter;
      return hasFilterAttribute
        ? sentinelFilterValues.has(filterValue)
          ? configuredSentinelDrivers.has(filterValue)
          : true
        : configuredSentinelDrivers.has('unspecified');
    });
    const worktreeSignature = hashFilterSignature(worktreeAttrs);
    const indexSignature = hashFilterSignature(indexAttrs);
    signatures.set(path, {
      signature: worktreeSignature,
      pathIndependent: !hasCustomFilter && worktreeSignature === indexSignature,
      hasCustomFilter,
      matchesIndex: worktreeSignature === indexSignature,
    });
  }
  return signatures;
}

/**
 * Reject a staged file whose content is byte-identical (by Git blob hash,
 * computed under the destination's own working-tree clean-filter rules —
 * see `hashObjectForPath`) to a non-empty untracked/ignored mutable-state
 * source. Empty sources contain no bytes to leak, and their common empty
 * blob must not make unrelated empty files look like copies. Only an exact
 * full-content match is treated as a violation — deliberately conservative,
 * with no fuzzy/partial matching, to avoid false positives on merely similar
 * files.
 *
 * Fails closed: if enumerating untracked/ignored mutable-state files, or
 * hashing any candidate against a staged destination, itself errors, this
 * aborts the commit with a diagnostic rather than silently treating the
 * error as "no violation found" — a guard that can be silently disabled
 * by making its own enumeration/hashing step fail is not a guard.
 *
 * `destHashes` is the result of `parseRawDiffDestHashes`. The listing,
 * hashing, attribute, staged-attribute, and source-stat functions are injectable
 * for testing.
 */
export function checkNoUntrackedMutableStateCopies(
  destHashes,
  listIgnoredFn = listUntrackedMutableStateFiles,
  hashFn = hashObjectForPath,
  attrFn = checkAttrSignatures,
  hasStagedAttributeFileFn = () => {
    const stagedPaths = defaultExecFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--no-renames', '-z'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    return stagedPaths.some(
      (stagedPath) => stagedPath === '.gitattributes' || stagedPath.endsWith('/.gitattributes'),
    );
  },
  statFn = (sourcePath) => fs.statSync(sourcePath),
) {
  let ignoredMutableFiles;
  try {
    ignoredMutableFiles = listIgnoredFn();
  } catch (err) {
    fail(
      'Could not enumerate untracked/ignored Squad state while checking staged files for ' +
        'disguised copies of mutable state (failing closed rather than silently skipping this ' +
        `check).\n  ${err && err.message ? err.message : err}`,
    );
    return;
  }

  // Only the exact reviewed migration seed may skip comparison with its
  // legacy history source; keep that source available for every other path.
  const hasApprovedSeed =
    destHashes.get(APPROVED_CASTING_HISTORY_MIGRATION_COPY.destination) ===
    APPROVED_CASTING_HISTORY_MIGRATION_COPY.blob;

  if (ignoredMutableFiles.length === 0) return;
  const destPaths = [...destHashes.keys()];
  if (destPaths.length === 0) return;

  const nonEmptyMutableFiles = [];
  for (const sourcePath of ignoredMutableFiles) {
    try {
      if (statFn(sourcePath).size > 0) nonEmptyMutableFiles.push(sourcePath);
    } catch (err) {
      fail(
        `Could not inspect untracked/ignored Squad state file "${sourcePath}" while checking ` +
          'for disguised copies of mutable state (failing closed rather than silently skipping ' +
          `this check).\n  ${err && err.message ? err.message : err}`,
      );
      return;
    }
  }
  if (nonEmptyMutableFiles.length === 0) return;

  // Hashing uses worktree attributes. If those differ from the index,
  // cached signatures would not describe the actual hash operation. Also,
  // custom clean filters may use `%f`, so equal filter-driver names do not
  // prove path-independent output. Only group paths with identical built-in
  // conversions and no custom filter; hash every other destination itself.
  let signatures;
  try {
    signatures = attrFn(destPaths);
  } catch (err) {
    fail(
      'Could not resolve clean-filter attributes for staged destinations while checking for ' +
        'disguised copies of mutable state (failing closed rather than silently skipping this ' +
        `check).\n  ${err && err.message ? err.message : err}`,
    );
    return;
  }

  const destinationsWithAttributeDivergence = destPaths.filter(
    (destPath) => signatures.get(destPath)?.matchesIndex !== true,
  );
  if (destinationsWithAttributeDivergence.length > 0) {
    fail(
      'Cannot safely compare mutable-state copies because the clean-conversion attributes for ' +
        'staged destination(s) differ between the index and worktree. Refusing to guess which ' +
        'attributes produced the staged blobs.\n' +
        `  Destinations:\n${destinationsWithAttributeDivergence.map((path) => `    - ${path}`).join('\n')}`,
    );
    return;
  }

  const destinationsWithCustomFilters = destPaths.filter(
    (destPath) => signatures.get(destPath)?.hasCustomFilter !== false,
  );
  if (destinationsWithCustomFilters.length > 0) {
    fail(
      'Cannot check staged destination(s) for copied mutable state because a custom clean/process ' +
        'filter would run against local mutable-state contents. Refusing to execute custom filters.\n' +
        `  Destinations:\n${destinationsWithCustomFilters.map((path) => `    - ${path}`).join('\n')}`,
    );
    return;
  }

  // A staged destination can have been clean-filtered before a later-staged
  // .gitattributes change. In that case the index and worktree now agree,
  // while the destination blob still reflects the previous committed rules.
  // Check HEAD attributes only when an attribute file is staged, then verify
  // the staged blob against the current conversion for destinations whose
  // effective rules changed. Unaffected paths retain normal partial-staging
  // behavior.
  let hasStagedAttributeFile;
  try {
    hasStagedAttributeFile = hasStagedAttributeFileFn();
  } catch (err) {
    fail(
      'Could not determine whether .gitattributes files are staged while checking for ' +
        'disguised copies of mutable state (failing closed rather than silently skipping this ' +
        `check).\n  ${err && err.message ? err.message : err}`,
    );
    return;
  }

  if (hasStagedAttributeFile) {
    let headSignatures;
    try {
      const headValues = parseCheckAttrOutput(
        defaultExecFileSync(
          'git',
          ['check-attr', '--source', 'HEAD', '--all', '-z', '--', ...destPaths],
          { encoding: 'utf8' },
        ),
      );
      headSignatures = new Map(
        destPaths.map((destPath) => [
          destPath,
          hashFilterSignature(headValues.get(destPath) ?? {}),
        ]),
      );
    } catch (err) {
      fail(
        'Could not resolve committed clean-conversion attributes while checking staged ' +
          'destinations for copied mutable state (failing closed rather than silently skipping ' +
          `this check).\n  ${err && err.message ? err.message : err}`,
      );
      return;
    }

    const destinationsWithChangedAttributes = destPaths.filter(
      (destPath) => headSignatures.get(destPath) !== signatures.get(destPath)?.signature,
    );
    for (const destPath of destinationsWithChangedAttributes) {
      let currentDestinationHash;
      try {
        currentDestinationHash = hashObjectForPath(destPath, destPath);
      } catch (err) {
        fail(
          `Could not verify staged destination "${destPath}" under its current clean-conversion ` +
            'attributes after a staged .gitattributes change (failing closed rather than silently ' +
            `skipping this check).\n  ${err && err.message ? err.message : err}`,
        );
        return;
      }

      if (currentDestinationHash !== destHashes.get(destPath)) {
        fail(
          'Cannot safely check staged destination(s) for copied mutable state because the ' +
            'effective .gitattributes rules changed for the path, but the staged blob does not ' +
            'match the destination content under the current rules. Restage the destination after ' +
            'staging the attribute change, or resolve the partial staging before committing.\n' +
            `  Destinations:\n    - ${destPath}`,
        );
        return;
      }
    }
  }

  const groups = new Map(); // signature or unique symbol -> { representative, paths: string[] }
  for (const destPath of destPaths) {
    const attributes = signatures.get(destPath);
    const key = attributes?.pathIndependent ? attributes.signature : Symbol(destPath);
    let group = groups.get(key);
    if (!group) {
      group = { representative: destPath, paths: [] };
      groups.set(key, group);
    }
    group.paths.push(destPath);
  }

  const violations = [];
  for (const sourcePath of nonEmptyMutableFiles) {
    for (const group of groups.values()) {
      // Exclude self-matches and only the fixed migration pair; other paths
      // in the same attribute group remain comparable.
      const comparableDestPaths = group.paths.filter(
        (destPath) =>
          destPath !== sourcePath &&
          !(
            hasApprovedSeed &&
            sourcePath === APPROVED_CASTING_HISTORY_MIGRATION_COPY.source &&
            destPath === APPROVED_CASTING_HISTORY_MIGRATION_COPY.destination
          ),
      );
      if (comparableDestPaths.length === 0) continue;

      let sourceHashForGroup;
      try {
        sourceHashForGroup = hashFn(sourcePath, group.representative);
      } catch (err) {
        fail(
          `Could not hash untracked/ignored Squad state file "${sourcePath}" against staged ` +
            `destination "${group.representative}" while checking for disguised copies of ` +
            `mutable state (failing closed rather than silently skipping this check).\n` +
            `  ${err && err.message ? err.message : err}`,
        );
        return;
      }
      for (const destPath of comparableDestPaths) {
        if (sourceHashForGroup === destHashes.get(destPath)) {
          violations.push({ source: sourcePath, destination: destPath });
        }
      }
    }
  }

  if (violations.length === 0) return;

  fail(
    'Staged file content is byte-identical to an untracked/ignored mutable Squad state file. ' +
      'Mutable Squad state must be persisted through the configured state backend, not copied ' +
      'into an ordinary tracked path.\n' +
      `  Offending files:\n${violations
        .map((v) => `    - ${v.destination} (matches ignored source ${v.source})`)
        .join('\n')}`,
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
 * - `staged`: every path touched by this commit — added, modified, deleted,
 *   or the destination of a rename/copy. This matches the old
 *   `git diff --cached --name-only` behavior (which lists deletions too)
 *   so the other guard checks (portable filenames, workflow pinning
 *   tests) keep seeing every changed path, deletions included.
 * - `deleted`: paths removed outright (`D`) — also included in `staged`
 *   above, and additionally broken out here so `checkSquadBoundary` can
 *   apply the one-time `git rm --cached` migration allowlist to genuine
 *   deletions without conflating them with adds/modifies.
 * - `renamedFrom`: source paths of renames/copies — checked independently
 *   so a rename out of a mutable-state path can't bypass the guard.
 */
export function parseNameStatus(raw) {
  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();

  const staged = [];
  const deleted = [];
  const renamedFrom = [];
  const renames = [];

  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      staged.push(newPath);
      renamedFrom.push(oldPath);
      renames.push({ status, source: oldPath, destination: newPath });
    } else if (kind === 'D') {
      const deletedPath = tokens[i++];
      staged.push(deletedPath);
      deleted.push(deletedPath);
    } else {
      staged.push(tokens[i++]);
    }
  }

  return { staged, deleted, renamedFrom, renames };
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
