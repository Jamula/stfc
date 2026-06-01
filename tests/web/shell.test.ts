/**
 * Tests for the Lit+Vite frontend shell (#119).
 *
 * Strategy:
 *  1. Static-analysis checks on component source files (names, prefixes).
 *  2. Vite build smoke test (ensures the build succeeds and outputs JS).
 *  3. Bundle-budget gate smoke test (ensures current build is under 80 KB).
 *
 * We avoid requiring a DOM environment: Lit components use browser APIs that
 * are unavailable in Node.js without a shim. The build + budget checks give
 * sufficient integration coverage for Wave 3.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = resolve(import.meta.dirname, '../..');
const WEB_DIR = join(REPO, 'web');
const COMPONENTS_DIR = join(WEB_DIR, 'src', 'components');

// ---------------------------------------------------------------------------
// 1. Component source files — static checks on @customElement names
// ---------------------------------------------------------------------------

describe('stfc-* custom element prefix convention', () => {
  const expectedElements = [
    { file: 'stfc-redeems-tab.ts',   name: 'stfc-redeems-tab' },
    { file: 'stfc-digests-tab.ts',   name: 'stfc-digests-tab' },
    { file: 'stfc-telemetry-tab.ts', name: 'stfc-telemetry-tab' },
    { file: 'stfc-crew-tab.ts',      name: 'stfc-crew-tab' },
    { file: 'stfc-runs-tab.ts',      name: 'stfc-runs-tab' },
  ] as const;

  for (const { file, name } of expectedElements) {
    it(`${file} declares @customElement('${name}')`, async () => {
      const src = await readFile(join(COMPONENTS_DIR, file), 'utf8');
      assert.ok(
        src.includes(`@customElement('${name}')`),
        `Expected @customElement('${name}') in ${file}`,
      );
    });
  }

  it('all component files use stfc-* prefix', async () => {
    const entries = await readdir(COMPONENTS_DIR);
    const tsFiles = entries.filter((e) => e.endsWith('.ts'));
    assert.ok(tsFiles.length >= 5, 'Expected at least 5 component files');
    for (const f of tsFiles) {
      assert.ok(f.startsWith('stfc-'), `Component file ${f} must start with stfc-`);
    }
  });
});

describe('stfc-app root component', () => {
  it("app.ts declares @customElement('stfc-app')", async () => {
    const src = await readFile(join(WEB_DIR, 'src', 'app.ts'), 'utf8');
    assert.ok(src.includes("@customElement('stfc-app')"), "Expected @customElement('stfc-app') in app.ts");
  });

  it('app.ts imports all 5 tab components', async () => {
    const src = await readFile(join(WEB_DIR, 'src', 'app.ts'), 'utf8');
    const tabs = ['redeems', 'digests', 'telemetry', 'crew', 'runs'];
    for (const tab of tabs) {
      assert.ok(
        src.includes(`stfc-${tab}-tab`),
        `app.ts should reference stfc-${tab}-tab`,
      );
    }
  });

  it('main.ts imports app.ts (no inline component definition)', async () => {
    const src = await readFile(join(WEB_DIR, 'src', 'main.ts'), 'utf8');
    assert.ok(src.includes("'./app.js'") || src.includes('./app'), 'main.ts must import app');
  });
});

describe('index.html — no inline scripts', () => {
  it('has <stfc-app> root element', async () => {
    const src = await readFile(join(WEB_DIR, 'index.html'), 'utf8');
    assert.ok(src.includes('<stfc-app>'), 'index.html must contain <stfc-app>');
  });

  it('loads main.ts via type=module (no inline JS)', async () => {
    const src = await readFile(join(WEB_DIR, 'index.html'), 'utf8');
    assert.ok(
      src.includes('type="module"') && src.includes('src/main.ts'),
      'index.html must load main.ts as a module',
    );
    // No inline script content (no src-less <script> with code)
    const inlineScript = /<script(?![^>]+src=)[^>]*>[^<]+<\/script>/i.test(src);
    assert.equal(inlineScript, false, 'index.html must not contain inline scripts');
  });
});

// ---------------------------------------------------------------------------
// 2. Vite build smoke test
// ---------------------------------------------------------------------------

describe('vite build', () => {
  let buildResult: ReturnType<typeof spawnSync>;

  before(() => {
    buildResult = spawnSync('npm', ['run', 'build'], {
      cwd: WEB_DIR,
      encoding: 'utf8',
      timeout: 120_000,
    });
  });

  it('exits 0', () => {
    assert.equal(buildResult.status, 0, `Vite build failed:\n${buildResult.stderr}\n${buildResult.stdout}`);
  });

  it('emits at least one JS file in web/dist/ (including subdirs)', async () => {
    async function findJs(dir: string): Promise<string[]> {
      const { readdir: rd } = await import('node:fs/promises');
      const entries = await rd(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries) {
        if (e.isDirectory()) results.push(...await findJs(`${dir}/${e.name}`));
        else if (e.name.endsWith('.js')) results.push(e.name);
      }
      return results;
    }
    const distDir = join(WEB_DIR, 'dist');
    const jsFiles = await findJs(distDir);
    assert.ok(jsFiles.length > 0, 'Expected at least one JS file in dist/ or subdirs');
  });
});

// ---------------------------------------------------------------------------
// 3. Bundle-budget smoke test (depends on build above)
// ---------------------------------------------------------------------------

describe('bundle-budget gate', () => {
  it('current build is within 80 KB gzipped budget', () => {
    const result = spawnSync(
      'node',
      ['scripts/ci/check-bundle-budget.mjs'],
      {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    assert.equal(
      result.status,
      0,
      `Bundle over budget:\n${result.stdout}\n${result.stderr}`,
    );
  });
});
