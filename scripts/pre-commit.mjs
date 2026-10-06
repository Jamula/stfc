#!/usr/bin/env node
/**
 * Pre-commit hook runner (installed by simple-git-hooks).
 *
 * Checks run in order; any non-zero exit aborts the commit.
 *
 * Emergency bypass — auditable, avoid routine use:
 *   git commit --no-verify
 */

import { execSync } from 'child_process';
import {
  checkSquadBoundary,
  checkPortableFilenames,
  checkWorkflowPinningTests,
  checkNoUntrackedMutableStateCopies,
  parseNameStatus,
  parseRawDiffDestHashes,
  listUntrackedMutableStateFiles,
} from './pre-commit-checks.mjs';

execSync('node scripts/check-artifact-hygiene.mjs --staged', { stdio: 'inherit' });

// --- Enforcement checks (fail fast before running the full test suite) ---

// `-z` avoids Git's quoting of unusual filenames; `-M -C` make rename/copy
// detection explicit instead of depending on the repo's `diff.renames`
// config. See parseNameStatus for why both the destination AND the source
// of a rename/copy matter to the Squad boundary check.
//
// `--find-copies-harder` is required alongside `-C`: by default Git only
// considers copy *sources* among files that were themselves modified in
// the same diff. A laundering commit that copies an untouched mutable-state
// file (e.g. `.squad/agents/*/history.md`) to an ordinary path leaves the
// source file unmodified, so without this flag Git reports a plain `A`dd
// for the destination and the boundary check never sees the real source.
const statusOutput = execSync(
  'git diff --cached --name-status -z -M -C --find-copies-harder',
  { encoding: 'utf8' },
);
const { staged, deleted, renamedFrom } = parseNameStatus(statusOutput);

checkSquadBoundary(staged, deleted, renamedFrom);
checkPortableFilenames(staged);
checkWorkflowPinningTests(staged);

// Even `--find-copies-harder` only searches for copy sources among blobs
// that are part of the diff (i.e. tracked). An ignored/untracked
// mutable-state file (e.g. `.squad/agents/*/history.md`, excluded from
// tracking by `.gitignore`) was never part of any diff, so Git can never
// report it as a copy source — copying its bytes into an ordinary tracked
// path is reported as a plain `A`dd. Close that gap by comparing content
// hashes directly between staged destinations and untracked/ignored
// mutable-state sources.
const rawDiffOutput = execSync(
  'git diff --cached --raw -z -M -C --find-copies-harder --abbrev=40',
  { encoding: 'utf8' },
);
const destHashes = parseRawDiffDestHashes(rawDiffOutput);
const ignoredMutableFiles = listUntrackedMutableStateFiles();
checkNoUntrackedMutableStateCopies(destHashes, ignoredMutableFiles);

// --- Test suite ---

const testEnv = { ...process.env };
for (const key of Object.keys(testEnv)) {
  if (key.startsWith('GIT_')) delete testEnv[key];
}
execSync('npm test', { stdio: 'inherit', env: testEnv });
