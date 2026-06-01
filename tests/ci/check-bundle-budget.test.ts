/**
 * Tests for scripts/ci/check-bundle-budget.mjs.
 *
 * Uses fixture directories with synthetic JS files to validate the
 * pass/fail logic without a real Vite build.
 *
 * The script reads BUNDLE_BUDGET_DIST_DIR and BUNDLE_BUDGET_FILE env vars
 * when present, so we can inject fixture paths.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const REPO = resolve(import.meta.dirname, '../..');
const SCRIPT = join(REPO, 'scripts', 'ci', 'check-bundle-budget.mjs');
const FIXTURE_BASE = join(REPO, 'tests', 'ci', 'fixtures', 'budget');

/** Generate N random bytes — nearly incompressible (gzipped ≈ raw size). */
function makeUncompressibleBytes(size: number): Buffer {
  return randomBytes(size);
}

async function runScript(distDir: string, budgetFile: string) {
  return spawnSync('node', [SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      BUNDLE_BUDGET_DIST_DIR: distDir,
      BUNDLE_BUDGET_FILE: budgetFile,
    },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNDER_BUDGET_DIR = join(FIXTURE_BASE, 'under-budget');
const OVER_BUDGET_DIR = join(FIXTURE_BASE, 'over-budget');
const BUDGET_FILE = join(FIXTURE_BASE, 'bundle-budget.json');

before(async () => {
  await rm(FIXTURE_BASE, { recursive: true, force: true });
  // Fixture dirs use assets/ sub-dir (matching real Vite output)
  await mkdir(join(UNDER_BUDGET_DIR, 'assets'), { recursive: true });
  await mkdir(join(OVER_BUDGET_DIR, 'assets'), { recursive: true });

  // Budget: 80 KB = 81920 bytes
  await writeFile(BUDGET_FILE, JSON.stringify({ max_gzipped_js_bytes: 81920 }));

  // Under-budget fixture: a single 50 KB file (gzips ~poorly to ~47.5 KB)
  // We use near-incompressible content so gzipped ≈ raw size × 0.95
  const content50kb = makeUncompressibleBytes(50_000);
  await writeFile(join(UNDER_BUDGET_DIR, 'assets', 'app.js'), content50kb);

  // Over-budget fixture: two 60 KB files → ~114 KB gzipped total
  const content60kb = makeUncompressibleBytes(60_000);
  await writeFile(join(OVER_BUDGET_DIR, 'assets', 'app.js'), content60kb);
  await writeFile(join(OVER_BUDGET_DIR, 'assets', 'vendor.js'), content60kb);
});

after(async () => {
  await rm(FIXTURE_BASE, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('check-bundle-budget — under budget', () => {
  it('exits 0 when total gzipped JS < 80 KB', async () => {
    const result = await runScript(UNDER_BUDGET_DIR, BUDGET_FILE);
    assert.equal(
      result.status,
      0,
      `Expected exit 0 but got ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  });

  it('output contains PASS', async () => {
    const result = await runScript(UNDER_BUDGET_DIR, BUDGET_FILE);
    assert.ok(
      result.stdout.includes('PASS'),
      `Expected PASS in output:\n${result.stdout}`,
    );
  });
});

describe('check-bundle-budget — over budget', () => {
  it('exits 1 when total gzipped JS > 80 KB', async () => {
    const result = await runScript(OVER_BUDGET_DIR, BUDGET_FILE);
    assert.equal(
      result.status,
      1,
      `Expected exit 1 but got ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  });

  it('output contains FAIL', async () => {
    const result = await runScript(OVER_BUDGET_DIR, BUDGET_FILE);
    assert.ok(
      result.stdout.includes('FAIL') || result.stderr.includes('FAIL'),
      `Expected FAIL in output:\n${result.stdout}\n${result.stderr}`,
    );
  });

  it('output shows both JS files in breakdown', async () => {
    const result = await runScript(OVER_BUDGET_DIR, BUDGET_FILE);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('app.js'), `Expected app.js in breakdown:\n${combined}`);
    assert.ok(combined.includes('vendor.js'), `Expected vendor.js in breakdown:\n${combined}`);
  });
});

describe('check-bundle-budget — missing dist dir', () => {
  it('exits 1 with an error when dist dir does not exist', async () => {
    const result = await runScript(
      join(FIXTURE_BASE, 'nonexistent-dir'),
      BUDGET_FILE,
    );
    assert.equal(result.status, 1);
  });
});
