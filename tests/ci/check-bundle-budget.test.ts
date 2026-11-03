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
import childProcess from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '../..');
const SCRIPT = join(REPO, 'scripts', 'ci', 'check-bundle-budget.mjs');
const SCRIPT_TIMEOUT_MS = 30_000;

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

function runScript(distDir: string, budgetFile: string, script = SCRIPT): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(process.execPath, [script], {
      cwd: REPO,
      env: {
        ...process.env,
        BUNDLE_BUDGET_DIST_DIR: distDir,
        BUNDLE_BUDGET_FILE: budgetFile,
      },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      const killed = child.kill('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(
        `Script ${script} (PID ${child.pid}) exceeded ${SCRIPT_TIMEOUT_MS}ms; ` +
        `${killed ? 'sent SIGKILL' : 'could not send SIGKILL'}.\n` +
        `stdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    }, SCRIPT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once('error', onError);
    child.once('close', (status) => {
      clearTimeout(timer);
      child.removeListener('error', onError);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('check-bundle-budget — process deadline', () => {
  it('kills a hung child at the deadline and rejects with a visible diagnostic', { timeout: 5000 }, async (t) => {
    await withFixture(async (base, budgetFile) => {
      const script = join(base, 'hung.mjs');
      await writeFile(script,
        "setInterval(() => {}, 1000);\n" +
        "process.stdout.write('hung child ready\\n');\n" +
        "process.stderr.write('hung child diagnostic\\n');\n",
      );
      const spawn = childProcess.spawn;
      let child: ReturnType<typeof spawn> | undefined;
      t.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
        child = spawn(...args);
        return child;
      });
      t.mock.timers.enable({ apis: ['setTimeout'] });

      try {
        const result = runScript(base, budgetFile, script);
        assert.ok(child?.pid, 'Expected a real child process');
        assert.ok(child.stdout && child.stderr, 'Expected piped output');
        const pid = child.pid;
        const closed = once(child, 'close', { signal: t.signal });
        let settled = false;
        const rejected = assert.rejects(result, (error: Error) => {
          assert.match(error.message, /exceeded 30000ms; sent SIGKILL/);
          assert.ok(error.message.includes(script));
          assert.ok(error.message.includes(`PID ${pid}`));
          assert.match(error.message, /stdout:\nhung child ready\n/);
          assert.match(error.message, /stderr:\nhung child diagnostic\n/);
          return true;
        }).then(() => { settled = true; });

        await Promise.all([
          once(child.stdout, 'data', { signal: t.signal }),
          once(child.stderr, 'data', { signal: t.signal }),
        ]);
        t.mock.timers.tick(SCRIPT_TIMEOUT_MS - 1);
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false, 'Must not expire before the deadline');
        t.mock.timers.tick(1);
        await Promise.all([rejected, closed]);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      } finally {
        child?.kill('SIGKILL');
        t.mock.timers.reset();
        t.mock.restoreAll();
      }
    });
  });

  it('rejects spawn errors and clears the deadline without trying to kill again', async (t) => {
    await withFixture(async (base, budgetFile) => {
      const spawn = childProcess.spawn;
      const child = spawn(join(base, 'missing-node-executable'));
      const kill = t.mock.method(child, 'kill');
      t.mock.method(childProcess, 'spawn', () => child);
      t.mock.timers.enable({ apis: ['setTimeout'] });

      try {
        await assert.rejects(runScript(base, budgetFile), { code: 'ENOENT' });
        t.mock.timers.tick(SCRIPT_TIMEOUT_MS);
        assert.equal(kill.mock.callCount(), 0);
      } finally {
        t.mock.timers.reset();
        t.mock.restoreAll();
      }
    });
  });
});

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
