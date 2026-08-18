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
  checkConstitutionSync,
  checkSquadBoundary,
  checkPortableFilenames,
  checkWorkflowPinningTests,
} from './pre-commit-checks.mjs';

execSync('node scripts/check-artifact-hygiene.mjs --staged', { stdio: 'inherit' });

// --- Enforcement checks (fail fast before running the full test suite) ---

const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

checkConstitutionSync(staged);
checkSquadBoundary(staged);
checkPortableFilenames(staged);
checkWorkflowPinningTests(staged);

// --- Test suite ---

execSync('npm test', { stdio: 'inherit' });
