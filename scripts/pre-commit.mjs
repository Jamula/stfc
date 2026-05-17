#!/usr/bin/env node
/**
 * Pre-commit hook runner (installed by simple-git-hooks).
 *
 * Checks run in order; any non-zero exit aborts the commit.
 *
 * TODO(Uhura): When scripts/check-artifact-hygiene.* lands, uncomment:
 *   execSync('node scripts/check-artifact-hygiene.mjs', { stdio: 'inherit' });
 *   (run it BEFORE npm test so secret/artifact leaks are caught first)
 *
 * Emergency bypass — auditable, avoid routine use:
 *   git commit --no-verify
 */

import { execSync } from 'child_process';
import {
  checkConstitutionSync,
  checkSquadBoundary,
  checkWorkflowPinningTests,
} from './pre-commit-checks.mjs';

// TODO(Uhura): Add hygiene check here once scripts/check-artifact-hygiene.* lands:
// execSync('node scripts/check-artifact-hygiene.mjs', { stdio: 'inherit' });

// --- Enforcement checks (fail fast before running the full test suite) ---

const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

checkConstitutionSync(staged);
checkSquadBoundary(staged);
checkWorkflowPinningTests(staged);

// --- Test suite ---

execSync('npm test', { stdio: 'inherit' });
