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

// TODO(Uhura): Add hygiene check here once scripts/check-artifact-hygiene.* lands:
// execSync('node scripts/check-artifact-hygiene.mjs', { stdio: 'inherit' });

execSync('npm test', { stdio: 'inherit' });
