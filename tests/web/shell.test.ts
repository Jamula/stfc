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
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = resolve(import.meta.dirname, '../..');
const WEB_DIR = join(REPO, 'web');
const COMPONENTS_DIR = join(WEB_DIR, 'src', 'components');
const WEB_VITE_BIN = join(WEB_DIR, 'node_modules', '.bin', 'vite');

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
    { file: 'stfc-token-update-tab.ts', name: 'stfc-token-update-tab' },
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

  it('app.ts imports all 6 tab components', async () => {
    const src = await readFile(join(WEB_DIR, 'src', 'app.ts'), 'utf8');
    const tabs = ['redeems', 'digests', 'telemetry', 'crew', 'runs', 'token-update'];
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

  before(async () => {
    const hasVite = await stat(WEB_VITE_BIN)
      .then(() => true)
      .catch(() => false);

    if (!hasVite) {
      const installEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'),
      );
      const installResult = spawnSync('npm', ['ci'], {
        cwd: WEB_DIR,
        encoding: 'utf8',
        env: installEnv,
        timeout: 180_000,
        // npm is npm.cmd on Windows, which spawnSync cannot exec directly —
        // without a shell it fails with status null before npm ever runs.
        shell: process.platform === 'win32',
      });
      assert.equal(
        installResult.status,
        0,
        `web/npm ci failed:\n${installResult.stderr}\n${installResult.stdout}`,
      );
    }

    buildResult = spawnSync('npm', ['run', 'build'], {
      cwd: WEB_DIR,
      encoding: 'utf8',
      timeout: 120_000,
      shell: process.platform === 'win32',
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

  it('publishes the documentation index and nested Markdown files', async () => {
    const docsDir = join(WEB_DIR, 'dist', 'docs');
    const index = await readFile(join(docsDir, 'index.html'), 'utf8');
    assert.match(index, /href="\/docs\/SETUP\.md"/);
    assert.match(index, /href="\/docs\/stfc-knowledge\/README\.md"/);
    for (const file of ['SETUP.md', 'stfc-knowledge/README.md']) {
      assert.deepEqual(
        await readFile(join(docsDir, file)),
        await readFile(join(REPO, 'docs', file)),
        `${file} must be copied unchanged`,
      );
    }

    const config = JSON.parse(await readFile(join(REPO, 'staticwebapp.config.json'), 'utf8')) as {
      mimeTypes?: Record<string, string>;
      routes?: { route: string; allowedRoles?: string[] }[];
    };
    assert.equal(config.mimeTypes?.['.md'], 'text/plain');
    assert.deepEqual(config.routes?.find((route) => route.route === '/*')?.allowedRoles, ['stfc_operator']);
    assert.deepEqual(
      await readFile(join(WEB_DIR, 'dist', 'staticwebapp.config.json')),
      await readFile(join(REPO, 'staticwebapp.config.json')),
      'The deployed output must include the complete SWA security configuration',
    );
  });

  it('excludes the local-only login prototype from normal deployment output', async () => {
    for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg']) {
      await assert.rejects(stat(join(WEB_DIR, 'dist', 'pwa-demo', file)), { code: 'ENOENT' },
        `Normal web build must not ship pwa-demo/${file}`);
    }
  });

  it('emits an installable, network-only PWA shell in the production build', async () => {
    const manifest = JSON.parse(await readFile(join(WEB_DIR, 'dist', 'manifest.webmanifest'), 'utf8')) as {
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: { src: string; sizes: string }[];
    };
    assert.equal(manifest.start_url, '/#token-update');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons?.some((icon) => icon.src === '/pwa-icon.svg' && icon.sizes === 'any'));
    const serviceWorker = await readFile(join(WEB_DIR, 'dist', 'sw.js'), 'utf8');
    assert.match(serviceWorker, /skipWaiting/);
    assert.match(serviceWorker, /clients\.claim/);
    assert.doesNotMatch(serviceWorker, /caches\.open|cache\.put|cache\.add/i);
    assert.match(await readFile(join(WEB_DIR, 'dist', 'index.html'), 'utf8'), /rel="manifest"/);
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
