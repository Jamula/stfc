/**
 * Dead-token alert issue selection, extracted from .github/workflows/redeem.yml
 * so the matching and closing rules can be executed by tests instead of pinned
 * as YAML substrings (#243).
 *
 * The workflow files ONE alert when every token is rejected (exit code 2) and
 * closes it again the first time a run is no longer in the all-tokens-rejected
 * state (exit code 0). Both halves must agree, byte for byte, on which issue *is* the alert — a create-side predicate
 * that drifts from the resolve-side predicate either spams duplicates or closes
 * something unrelated. They agree here by construction: both call
 * `selectAlertIssues`.
 *
 * Identity is: exact title match, plus every required label present. Required
 * labels are the stable pair (`bug`, `priority:p1`); the mutable `squad:*`
 * labels are deliberately NOT identity, because reassigning an alert must not
 * orphan it. Extra labels are allowed — the check is a superset test, not
 * equality. When several issues match, the oldest (lowest number) wins and the
 * duplicates are reported as a workflow warning.
 *
 * Usage from the workflow:
 *   node scripts/dead-token-alert.mjs find      # prints the alert number, or nothing
 *   node scripts/dead-token-alert.mjs resolve   # closes at most one alert, never fails
 *
 * Env: TITLE (required), REQUIRED_LABELS (comma-separated), RUN_URL (resolve).
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Labels that must be present for an issue to count as the dead-token alert. */
export const DEFAULT_REQUIRED_LABELS = ['bug', 'priority:p1'];

/**
 * Parse `gh issue list --json …` output into an array. Only a genuine
 * parsed `[]` means "no open issues" — the create side depends on lookup
 * failure being visible (see findAlertIssue's doc comment) so a dead token
 * doesn't silently get treated as "no alert exists yet," filing a duplicate
 * P1. Empty/missing output or a non-array JSON shape is therefore a thrown
 * error, not a tolerated empty list.
 */
export function parseIssues(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    throw new Error('dead-token-alert: expected a JSON array from gh issue list, got empty output');
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `dead-token-alert: expected a JSON array from gh issue list, got ${typeof parsed}`,
    );
  }
  return parsed;
}

function labelNames(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return new Set(
    labels
      .map((label) => (typeof label === 'string' ? label : label?.name))
      .filter((name) => typeof name === 'string'),
  );
}

/**
 * Issues that ARE the dead-token alert: exact title, all required labels
 * present, sorted oldest-first. `gh --search` is a fuzzy full-text match, so
 * this exact filter is what keeps an unrelated issue that merely quotes the
 * alert title out of the result.
 */
export function selectAlertIssues(issues, options) {
  const title = options.title;
  if (typeof title !== 'string' || title === '') {
    throw new Error('dead-token-alert: a non-empty title is required');
  }
  const requiredLabels = options.requiredLabels ?? DEFAULT_REQUIRED_LABELS;
  if (!Array.isArray(issues)) {
    throw new Error('dead-token-alert: issue list must be an array');
  }

  return issues
    .filter((issue) => issue?.title === title)
    .filter((issue) => {
      const names = labelNames(issue);
      return requiredLabels.every((label) => names.has(label));
    })
    .filter((issue) => Number.isFinite(issue?.number))
    .sort((a, b) => a.number - b.number);
}

function ghListIssues(title) {
  const out = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'open',
      '--search',
      `${title} in:title`,
      '--json',
      'number,title,labels',
      '--limit',
      '100',
    ],
    { encoding: 'utf8' },
  );
  return parseIssues(out);
}

function ghCloseIssue(number, comment) {
  execFileSync('gh', ['issue', 'close', String(number), '--comment', comment], {
    stdio: 'inherit',
  });
}

/**
 * Resolve the alert number, warning when duplicates exist. Throws if the
 * lookup itself fails — the create side wants that to be visible.
 */
export function findAlertIssue(options) {
  const title = options.title;
  const requiredLabels = options.requiredLabels ?? DEFAULT_REQUIRED_LABELS;
  const listIssues = options.listIssues ?? ghListIssues;
  // stderr, not stdout: the `find` command's caller in redeem.yml captures
  // this function's stdout via `existing=$(node ... find)` to get a single
  // issue number. A diagnostic on stdout would corrupt that capture into a
  // multi-line value the moment a duplicate warning fires.
  const log = options.log ?? ((line) => console.error(line));

  const listed = listIssues(title);
  const issues =
    typeof listed === 'string' || listed === undefined || listed === null
      ? parseIssues(listed)
      : listed;
  const matches = selectAlertIssues(issues, { title, requiredLabels });
  if (matches.length > 1) {
    log(
      `::warning::Found ${matches.length} matching dead-token alerts; using oldest #${matches[0].number}.`,
    );
  }
  return { number: matches.length > 0 ? matches[0].number : undefined, matchCount: matches.length };
}

/**
 * Close at most ONE dead-token alert. Never throws: cleanup is not allowed to
 * turn a run that successfully claimed gifts red, so a failed lookup or a
 * failed close is reported as a warning and swallowed.
 */
export function resolveDeadTokenAlert(options) {
  // stderr for the same reason as findAlertIssue: this function's caller does
  // not capture stdout today, but keeping both halves consistent means a
  // future refactor that starts capturing `resolve` output can't reintroduce
  // the same corruption.
  const log = options.log ?? ((line) => console.error(line));
  const closeIssue = options.closeIssue ?? ghCloseIssue;
  const runUrl = options.runUrl ?? '(unknown run)';
  const resolutionComment =
    options.resolutionComment ??
    `Token accepted again as of ${runUrl} — closing automatically.`;

  let found;
  try {
    found = findAlertIssue(options);
  } catch (err) {
    log(`::warning::Dead-token alert lookup failed: ${errorText(err)}`);
    return { status: 'lookup-failed', matchCount: 0 };
  }

  if (found.number === undefined) {
    log('No open dead-token alert — nothing to resolve.');
    return { status: 'none', matchCount: 0 };
  }

  try {
    closeIssue(found.number, resolutionComment);
  } catch (err) {
    log(`::warning::Failed to close dead-token alert #${found.number}: ${errorText(err)}`);
    return { status: 'close-failed', number: found.number, matchCount: found.matchCount };
  }

  return { status: 'closed', number: found.number, matchCount: found.matchCount };
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

function requiredLabelsFromEnv() {
  const raw = process.env.REQUIRED_LABELS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_REQUIRED_LABELS;
  return raw
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');
}

function main(argv) {
  const command = argv[2];
  const title = process.env.TITLE ?? '';
  const requiredLabels = requiredLabelsFromEnv();

  if (command === 'find') {
    // Lookup failure is fatal here on purpose: filing a duplicate P1 every
    // 10 minutes is worse than a visibly failed step.
    const { number } = findAlertIssue({ title, requiredLabels });
    if (number !== undefined) process.stdout.write(`${number}\n`);
    return 0;
  }

  if (command === 'resolve') {
    resolveDeadTokenAlert({ title, requiredLabels, runUrl: process.env.RUN_URL });
    return 0;
  }

  console.error('usage: dead-token-alert.mjs <find|resolve>');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
