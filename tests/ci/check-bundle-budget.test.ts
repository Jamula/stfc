/**
 * Tests for scripts/ci/check-bundle-budget.mjs.
 *
 * Uses fixture directories with synthetic JS files to validate the
 * pass/fail logic without a real Vite build.
 *
 * The script reads BUNDLE_BUDGET_DIST_DIR and BUNDLE_BUDGET_FILE env vars
 * when present, so we can inject fixture paths.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '../..');
const SCRIPT = join(REPO, 'scripts', 'ci', 'check-bundle-budget.mjs');

/** Generate N random bytes — nearly incompressible (gzipped ≈ raw size). */
function makeUncompressibleBytes(size: number): Buffer {
  return randomBytes(size);
}

async function withFixture(run: (base: string, budgetFile: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'stfc-bundle-budget-'));
  const budgetFile = join(base, 'bundle-budget.json');

  try {
    await writeFile(budgetFile, JSON.stringify({ max_gzipped_js_bytes: 81920 }));
    await run(base, budgetFile);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function runScript(distDir: string, budgetFile: string): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('node', [SCRIPT], {
      cwd: REPO,
      env: {
        ...process.env,
        BUNDLE_BUDGET_DIST_DIR: distDir,
        BUNDLE_BUDGET_FILE: budgetFile,
      },
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('check-bundle-budget — under budget', () => {
  it('exits 0 and reports PASS when total gzipped JS is under budget', async () => {
    await withFixture(async (base, budgetFile) => {
      const underBudgetDir = join(base, 'under-budget');
      await mkdir(join(underBudgetDir, 'assets'), { recursive: true });
      await writeFile(
        join(underBudgetDir, 'assets', 'app.js'),
        makeUncompressibleBytes(50_000),
      );

      const result = await runScript(underBudgetDir, budgetFile);
      assert.equal(
        result.status,
        0,
        `Expected exit 0 but got ${result.status}:\n${result.stdout}\n${result.stderr}`,
      );
      assert.ok(
        result.stdout.includes('PASS'),
        `Expected PASS in output:\n${result.stdout}`,
      );
      assert.ok(
        result.stdout.includes('app.js'),
        `Expected app.js in breakdown:\n${result.stdout}`,
      );
    });
  });
});

describe('check-bundle-budget — over budget', () => {
  it('exits 1 and reports both JavaScript files when total gzipped JS exceeds budget', async () => {
    await withFixture(async (base, budgetFile) => {
      const overBudgetDir = join(base, 'over-budget');
      await mkdir(join(overBudgetDir, 'assets'), { recursive: true });
      const content60kb = makeUncompressibleBytes(60_000);
      await writeFile(join(overBudgetDir, 'assets', 'app.js'), content60kb);
      await writeFile(join(overBudgetDir, 'assets', 'vendor.js'), content60kb);

      const result = await runScript(overBudgetDir, budgetFile);
      const combined = result.stdout + result.stderr;
      assert.equal(
        result.status,
        1,
        `Expected exit 1 but got ${result.status}:\n${combined}`,
      );
      assert.ok(combined.includes('FAIL'), `Expected FAIL in output:\n${combined}`);
      assert.ok(combined.includes('app.js'), `Expected app.js in breakdown:\n${combined}`);
      assert.ok(combined.includes('vendor.js'), `Expected vendor.js in breakdown:\n${combined}`);
    });
  });
});

describe('check-bundle-budget — missing dist dir', () => {
  it('exits 1 with an error when dist dir does not exist', async () => {
    await withFixture(async (base, budgetFile) => {
      const missingDir = join(base, 'nonexistent-dir');
      const result = await runScript(missingDir, budgetFile);
      const combined = result.stdout + result.stderr;
      assert.equal(
        result.status,
        1,
        `Expected exit 1 but got ${result.status}:\n${combined}`,
      );
      assert.ok(
        combined.includes(`${missingDir} not found`),
        `Expected missing directory error for ${missingDir}:\n${combined}`,
      );
    });
  });
});
