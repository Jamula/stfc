// Local-only relay to a controlled Chromium demo. No external browser provider.
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { DEMO_EMAILS, DEMO_OTP, DemoTokenStore, type DemoAccount } from '../shared/pwa-demo.js';

const root = resolve(import.meta.dirname, '..', 'web', 'dist-demo');
const port = Number(process.env.PWA_DEMO_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PWA_DEMO_PORT');
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const store = new DemoTokenStore();
type Session = {
  account: DemoAccount;
  revision: number;
  expires: number;
  context: BrowserContext;
  page: Page;
  busy: boolean;
};
const sessions = new Map<string, Session>();
let starting = 0;

function respond(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return respond(res, 403, { error: 'Loopback host required' });
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/demo-provider' && req.method === 'GET') {
      // This provider is ours, not Scopely. The browser's result is verified below.
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Synthetic provider</title><body><h1>Controlled browser demo</h1>
        <p id="account"></p><form><label>Demo OTP <input id="otp" inputmode="numeric"></label>
        <button>Verify demo OTP</button></form><p id="result" role="status"></p></body></html>`);
      return;
    }
    if (url.pathname.startsWith('/prototype-api/')) {
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
        return respond(res, 403, { error: 'Same-origin JSON POST required' });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 2048) return respond(res, 413, { error: 'Request too large' });
      }
      let input: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        input = parsed as Record<string, unknown>;
      } catch {
        return respond(res, 400, { error: 'Invalid JSON object' });
      }
      if (url.pathname === '/prototype-api/start') {
        const account = input.account;
        if (account !== 'alpha' && account !== 'beta') return respond(res, 400, { error: 'Choose a synthetic account' });
        if (sessions.size + starting >= 4) return respond(res, 429, { error: 'Demo session limit reached; cancel or wait two minutes' });
        starting++;
        let context: BrowserContext | undefined;
        try {
          const revision = store.revision(account);
          context = await browser.newContext({ viewport: { width: 390, height: 600 } });
          // Fail closed: the relayed browser can contact only our controlled provider.
          await context.route('**/*', (route) => {
            if (route.request().url() === `${origin}/demo-provider`) return route.continue();
            return route.abort();
          });
          const page = await context.newPage();
          await page.goto(`${origin}/demo-provider`);
          await page.evaluate(({ account, email, otp }) => {
            document.querySelector('#account')!.textContent = email;
            document.querySelector('form')!.addEventListener('submit', (event) => {
              event.preventDefault();
              const valid = (document.querySelector('#otp') as HTMLInputElement).value === otp;
              document.querySelector('#result')!.textContent = valid ? 'Synthetic login verified' : 'Incorrect demo OTP';
              document.body.dataset.verifiedAccount = valid ? account : '';
            });
          }, { account, email: DEMO_EMAILS[account], otp: DEMO_OTP });
          const id = randomUUID();
          const screenshot = (await page.screenshot()).toString('base64');
          sessions.set(id, { account, revision, context, page, busy: false, expires: Date.now() + 120_000 });
          return respond(res, 200, { id, account, email: DEMO_EMAILS[account], expiresInSeconds: 120,
            screenshot });
        } catch {
          if (context) await context.close();
          return respond(res, 503, { error: 'Controlled browser could not start' });
        } finally {
          starting--;
        }
      }
      const id = input.id;
      const session = typeof id === 'string' ? sessions.get(id) : undefined;
      if (!session || typeof id !== 'string') return respond(res, 404, { error: 'Session missing; start again' });
      if (Date.now() >= session.expires) {
        sessions.delete(id);
        await session.context.close();
        return respond(res, 410, { error: 'Session expired; start again' });
      }
      if (session.busy) return respond(res, 409, { error: 'Session busy' });
      if (url.pathname === '/prototype-api/cancel') {
        sessions.delete(id);
        await session.context.close();
        return respond(res, 200, { cancelled: true });
      }
      if (url.pathname !== '/prototype-api/verify') return respond(res, 404, { error: 'Unknown action' });
      if (typeof input.otp !== 'string' || !/^\d{6}$/.test(input.otp)) return respond(res, 400, { error: 'Enter the six-digit synthetic OTP' });
      session.busy = true;
      try {
        await session.page.locator('#otp').fill(input.otp);
        await session.page.locator('button').click();
        const verified = await session.page.evaluate(() => document.body.dataset.verifiedAccount);
        if (!verified) return respond(res, 422, { error: 'Incorrect demo OTP; use the displayed synthetic value' });
        const screenshot = (await session.page.screenshot()).toString('base64');
        if (Date.now() >= session.expires) return respond(res, 410, { error: 'Session expired; start again' });
        let receipt;
        try {
          receipt = store.capture(session.account, verified, session.revision);
        } catch (error) {
          sessions.delete(id);
          return respond(res, 409, { error: error instanceof Error ? error.message : 'Capture rejected',
            code: 'RESTART_SESSION' });
        }
        sessions.delete(id);
        return respond(res, 200, { receipt, screenshot });
      } finally {
        session.busy = false;
        if (!sessions.has(id)) await session.context.close();
      }
    }
    if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
    const path = url.pathname === '/pwa-demo/' ? '/pwa-demo/index.html' : url.pathname;
    if (!/^\/(?:pwa-demo\/[a-zA-Z0-9_.-]+|assets\/[a-zA-Z0-9_.-]+)$/.test(path)) {
      return respond(res, 404, { error: 'Open /pwa-demo/ on this local server' });
    }
    let contents: Buffer;
    try { contents = await readFile(resolve(root, `.${path}`)); }
    catch { return respond(res, 404, { error: 'Asset unavailable; run npm --prefix web run build:demo' }); }
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    res.end(contents);
  } catch {
    // Do not log request bodies, browser state or credentials.
    console.error('PWA demo request failed');
    if (!res.headersSent) respond(res, 500, { error: 'Demo request failed; restart the session' });
    else res.end();
  }
});
const reaper = setInterval(() => {
  for (const [id, session] of sessions) {
    if (session.expires <= Date.now() && !session.busy) {
      sessions.delete(id);
      void session.context.close().catch(() => console.error('Demo session cleanup failed'));
    }
  }
}, 1000);
server.listen(port, '127.0.0.1', () => console.log(`Synthetic PWA demo: ${origin}/pwa-demo/`));
server.on('error', async () => {
  console.error('PWA demo listener failed');
  clearInterval(reaper);
  await browser.close();
  process.exitCode = 1;
});
async function shutdown() {
  clearInterval(reaper);
  server.close();
  await browser.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
