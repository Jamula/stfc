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
} from './pre-commit-checks.mjs';

execSync('node scripts/check-artifact-hygiene.mjs --staged', { stdio: 'inherit' });

// --- Enforcement checks (fail fast before running the full test suite) ---

const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const deleted = execSync('git diff --cached --name-only --diff-filter=D', {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);

checkSquadBoundary(staged, deleted);
checkPortableFilenames(staged);
checkWorkflowPinningTests(staged);

// --- Test suite ---

const testEnv = { ...process.env };
for (const key of Object.keys(testEnv)) {
  if (key.startsWith('GIT_')) delete testEnv[key];
}
execSync('npm test', { stdio: 'inherit', env: testEnv });
