import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DemoTokenStore } from '../../shared/pwa-demo.js';
import { chromium, webkit, type Browser } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, readdir, writeFile, rm } from 'node:fs/promises';

describe('synthetic PWA capture store', () => {
  it('binds a capture to the verified demo account without exposing its token', () => {
    const store = new DemoTokenStore();
    assert.deepEqual(store.capture('alpha', 'alpha', 0), {
      account: 'alpha', email: 'alpha@example.invalid', revision: 1,
    });
    assert.equal(store.revision('beta'), 0);
    assert.throws(() => store.capture('beta', 'alpha', 0), /binding mismatch/);
    assert.equal(store.revision('beta'), 0);
  });

  it('rejects a stale concurrent capture without overwriting the newer record', () => {
    const store = new DemoTokenStore();
    store.capture('alpha', 'alpha', 0);
    assert.throws(() => store.capture('alpha', 'alpha', 0), /Stale account revision/);
    assert.equal(store.revision('alpha'), 1);
    assert.deepEqual(store.capture('alpha', 'alpha', 1), {
      account: 'alpha', email: 'alpha@example.invalid', revision: 2,
    });
  });

  it('keeps independent accounts and store instances isolated', () => {
    const store = new DemoTokenStore();
    store.capture('alpha', 'alpha', 0);
    store.capture('alpha', 'alpha', 1);
    assert.equal(store.capture('beta', 'beta', 0).revision, 1);
    assert.equal(store.revision('alpha'), 2);
    assert.equal(new DemoTokenStore().revision('alpha'), 0);
  });
});

    // Opt-in because normal unit gates do not install browser binaries or build assets.
    describe('local PWA browser relay', { skip: process.env.PWA_DEMO_E2E !== '1' }, () => {
      let child: ChildProcess;
      let origin: string;
      const assetDir = resolve(import.meta.dirname, '../../web/dist-demo/assets');
      const underscoredAsset = join(assetDir, 'index_fixture_hash_with_underscores.js');
      let expectedModule: string;
      before(async () => {
        const entry = (await readdir(assetDir)).find((file) => file.endsWith('.js'));
        assert.ok(entry, 'Build the demo before running browser-relay checks');
        expectedModule = await readFile(join(assetDir, entry), 'utf8');
        await writeFile(underscoredAsset, expectedModule);
        const probe = createServer();
        await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
        const address = probe.address();
        assert.ok(address && typeof address !== 'string');
        const port = address.port;
        await new Promise<void>((done) => probe.close(() => done()));
        origin = `http://127.0.0.1:${port}`;
        child = spawn(process.execPath, ['--import', 'tsx', 'scripts/pwa-demo.ts'], {
          cwd: resolve(import.meta.dirname, '../..'),
          env: { ...process.env, PWA_DEMO_PORT: String(port) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout?.on('data', (data) => { output += String(data); });
        child.stderr?.on('data', (data) => { output += String(data); });
        for (let i = 0; i < 100; i++) {
          if (child.exitCode !== null) assert.fail(`Demo server exited: ${output}`);
          try {
            const response = await fetch(`${origin}/pwa-demo/`);
            if (response.ok) return;
          } catch { /* Wait only for bounded local server startup. */ }
          await delay(100);
        }
        assert.fail(`Demo server not ready: ${output}`);
      });
      after(async () => {
        if (child && child.exitCode === null) {
          const exited = new Promise<void>((done) => child.once('exit', () => done()));
          child.kill();
          await exited;
        }
        await rm(underscoredAsset, { force: true });
      });

      async function api(action: string, body: object, requestOrigin = origin) {
        const response = await fetch(`${origin}/prototype-api/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      }

      it('serves built JavaScript with underscores in its asset filename without allowing traversal', async () => {
        const response = await fetch(`${origin}/assets/index_fixture_hash_with_underscores.js`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'text/javascript');
        assert.equal(await response.text(), expectedModule);
        assert.equal((await fetch(`${origin}/assets/%2e%2e/%2e%2e/package.json`)).status, 404);
      });

      it('rejects cross-origin access, real account inputs, stale captures and cancelled sessions', async () => {
        assert.equal((await api('start', { account: 'alpha' }, 'https://example.invalid')).status, 403);
        assert.equal((await api('start', { account: 'real@example.invalid' })).status, 400);
        const first = await api('start', { account: 'alpha' });
        const stale = await api('start', { account: 'alpha' });
        assert.equal(first.status, 200);
        assert.equal(stale.status, 200);
        assert.equal(first.body.email, 'alpha@example.invalid');
        assert.notEqual(first.body.id, stale.body.id);
        assert.equal(Buffer.from(first.body.screenshot, 'base64').subarray(1, 4).toString(), 'PNG');
        assert.equal((await api('verify', { id: first.body.id, otp: '999999' })).status, 422);
        const verified = await api('verify', { id: first.body.id, otp: '123456' });
        assert.equal(verified.status, 200);
        assert.deepEqual(verified.body.receipt, { account: 'alpha', email: 'alpha@example.invalid', revision: 1 });
        assert.equal('token' in verified.body.receipt, false);
        assert.equal(JSON.stringify(verified.body).includes('synthetic-only:'), false);
        assert.equal((await api('verify', { id: stale.body.id, otp: '123456' })).status, 409);
        assert.equal((await api('cancel', { id: stale.body.id })).status, 404);
        assert.equal((await api('verify', { id: stale.body.id, otp: '123456' })).status, 404);
      });

      it('enforces the four-session limit and releases capacity on cancellation', async () => {
        const ids: string[] = [];
        try {
          for (let i = 0; i < 4; i++) {
            const started = await api('start', { account: 'alpha' });
            assert.equal(started.status, 200);
            ids.push(started.body.id);
          }
          assert.equal((await api('start', { account: 'beta' })).status, 429);
        } finally {
          for (const id of ids) assert.equal((await api('cancel', { id })).status, 200);
        }
        const next = await api('start', { account: 'beta' });
        assert.equal(next.status, 200);
        assert.equal((await api('cancel', { id: next.body.id })).status, 200);
      });

      for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]] as const) {
        it(`${name}: completes the OTP flow in a touch-enabled iPhone-sized viewport`, async () => {
          let browser: Browser | undefined;
          try {
            browser = await engine.launch();
            const context = await browser.newContext({
              viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
            });
            const page = await context.newPage();
            await page.goto(`${origin}/pwa-demo/`);
            await page.getByLabel('Synthetic account').selectOption('beta');
            await page.getByRole('button', { name: 'Start controlled browser' }).tap();
            const otp = page.getByLabel('Synthetic OTP only');
            await otp.waitFor();
            assert.equal(await otp.getAttribute('autocomplete'), 'one-time-code');
            const box = await otp.boundingBox();
            assert.ok(box && box.height >= 48);
            await otp.fill('999999');
            await page.getByRole('button', { name: 'Verify demo OTP' }).tap();
            await page.getByRole('alert').filter({ hasText: 'Incorrect demo OTP' }).waitFor();
            await otp.fill('123456');
            await page.getByRole('button', { name: 'Verify demo OTP' }).tap();
            await page.getByRole('status').filter({ hasText: 'Synthetic token updated for beta@example.invalid' }).waitFor();
            assert.equal(await page.getByLabel('Synthetic account').inputValue(), 'beta');
            assert.equal(await page.locator('stfc-login-demo').evaluate((element) => {
              const image = element.shadowRoot?.querySelector('img');
              return !!image && image.naturalWidth === 390;
            }), true);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            assert.equal(await page.evaluate(async () => {
              const registration = await navigator.serviceWorker.ready;
              return new URL(registration.scope).pathname;
            }), '/pwa-demo/');
            assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
            await context.close();
          } finally { await browser?.close(); }
        });
      }

      it('recovers from a real concurrent stale capture without manual cancel', async () => {
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();
          await page.goto(`${origin}/pwa-demo/`);
          await page.getByRole('button', { name: 'Start controlled browser' }).click();
          await page.getByLabel('Synthetic OTP only').waitFor();
          const competing = await api('start', { account: 'alpha' });
          assert.equal((await api('verify', { id: competing.body.id, otp: '123456' })).status, 200);
          await page.getByLabel('Synthetic OTP only').fill('123456');
          await page.getByRole('button', { name: 'Verify demo OTP' }).click();
          await page.getByRole('alert').filter({ hasText: 'Stale account revision' }).waitFor();
          assert.equal(await page.getByLabel('Synthetic account').isVisible(), true);
          assert.equal(await page.getByRole('img').count(), 0);
        } finally { await browser.close(); }
      });

      it('recovers from 410 and actual session expiry without reloading', { timeout: 240_000 }, async () => {
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
          await page.goto(`${origin}/pwa-demo/`);
          let startedResponse = page.waitForResponse((response) => response.url().endsWith('/prototype-api/start'));
          await page.getByRole('button', { name: 'Start controlled browser' }).click();
          const first = await (await startedResponse).json();
          await page.route('**/prototype-api/verify', (route) => route.fulfill({
            status: 410, contentType: 'application/json', body: JSON.stringify({ error: 'Session expired; start again' }),
          }));
          await page.getByLabel('Synthetic OTP only').fill('123456');
          await page.getByRole('button', { name: 'Verify demo OTP' }).click();
          await page.getByRole('alert').filter({ hasText: 'Session expired; start again' }).waitFor();
          assert.equal(await page.getByLabel('Synthetic account').isVisible(), true);
          assert.equal(await page.getByRole('img').count(), 0);
          assert.equal((await api('cancel', { id: first.id })).status, 200);
          await page.unroute('**/prototype-api/verify');

          startedResponse = page.waitForResponse((response) => response.url().endsWith('/prototype-api/start'));
          await page.getByRole('button', { name: 'Start controlled browser' }).click();
          const expiring = await (await startedResponse).json();
          await page.getByLabel('Synthetic OTP only').waitFor();
          await delay(expiring.expiresInSeconds * 1000 + 1100);
          const expiryResponse = page.waitForResponse((response) => response.url().endsWith('/prototype-api/verify'));
          await page.getByLabel('Synthetic OTP only').fill('123456');
          await page.getByRole('button', { name: 'Verify demo OTP' }).click();
          assert.ok([404, 410].includes((await expiryResponse).status()));
          await page.getByRole('alert').filter({ hasText: 'start again' }).waitFor();
          assert.equal(await page.getByLabel('Synthetic account').isVisible(), true);
          assert.equal(await page.getByRole('img').count(), 0);
          await page.getByRole('button', { name: 'Start controlled browser' }).click();
          await page.getByLabel('Synthetic OTP only').waitFor();
          await page.getByRole('button', { name: 'Cancel session' }).click();
          await page.getByLabel('Synthetic account').waitFor();
        } finally { await browser.close(); }
      });
    });
