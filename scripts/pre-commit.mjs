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
  checkPortableFilenames,
  checkWorkflowPinningTests,
  parseNameStatus,
} from './pre-commit-checks.mjs';

execSync('node scripts/check-artifact-hygiene.mjs --staged', { stdio: 'inherit' });

// --- Enforcement checks (fail fast before running the full test suite) ---

// `-z` preserves unusual filenames; explicit rename/copy detection lets the
// checks inspect destination paths without relying on Git configuration.
const statusOutput = execSync(
  'git diff --cached --name-status -z -M -C',
  { encoding: 'utf8' },
);
const { staged } = parseNameStatus(statusOutput);

checkPortableFilenames(staged);
checkWorkflowPinningTests(staged);

// --- Test suite ---

const testEnv = { ...process.env };
for (const key of Object.keys(testEnv)) {
  if (key.startsWith('GIT_')) delete testEnv[key];
}
execSync('npm test', { stdio: 'inherit', env: testEnv });
