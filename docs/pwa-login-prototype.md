# Synthetic PWA login prototype

This document covers only the isolated, synthetic demo described below. The
separate real STFC token-update PWA is implemented in the control panel; see
the [STFC token PWA runbook](STFC-TOKEN-PWA.md) for its architecture and
external hosting requirements. Do not enter real credentials in this demo.

This is an isolated local feasibility experiment, not production authentication.
No cloud resources, external configuration, real credentials or redemption are
used by this demo. The opt-in `build:demo` emits `web/dist-demo`; the normal
build includes the production PWA shell but excludes the synthetic demo page.

## Run locally

From the repository root, with the existing dependencies restored:

```sh
npm --prefix web run build:demo
npx tsx scripts/pwa-demo.ts
```

Open `http://127.0.0.1:4178/pwa-demo/`. Select either fixed `.invalid` account,
start the browser, and enter the displayed **synthetic** OTP `123456`.
Use Ctrl+C to stop. `PWA_DEMO_PORT` can select a different local port.
If Chromium is missing, the existing `npm run playwright:install` installs it.
Never enter a real OTP or token here.

## Operational versus mocked

Operational locally: a fresh headless Chromium context per session, a real rendered
390px-wide provider page, screenshot relay, a phone-sized accessible OTP form,
server-driven browser form submission, cancellation, two-minute expiry and a
four-session limit. The browser is restricted to the local controlled provider.
The API binds its captured result to the selected synthetic account and rejects
stale concurrent updates; receipts contain metadata, never a token.

Mocked: the provider, OTP delivery and verification, account identity and token.
Synthetic tokens remain only in server process memory, are never returned to
the PWA and are not connected to `STFC_ACCOUNTS`. Restart clears the store.
This proves controlled screenshot/form relay, not extraction of a real provider token.

The manifest and scoped network-only service worker supply a standalone PWA shell.
No screenshots, OTPs or receipts are cached; offline login is intentionally unavailable.
The UI uses 48px controls, 16px input text and `autocomplete="one-time-code"`.
Mobile Chromium/WebKit emulation is evidence about layout and interaction only;
it does not verify physical iPhone installation, Safari OTP autofill or Scopely compatibility.
The SVG icon is a placeholder, not a validated iOS home-screen asset.

The relay binds only to loopback and rejects non-matching Host/Origin headers.
It has no production operator authentication: session IDs are ephemeral demo
capabilities. Do not expose it via a tunnel or public server. The local page cannot
be reached from an iPhone, and the existing static-site configuration does not
provide this Node/Chromium service. No deployment is included.

## Focused checks

```sh
node --import tsx --test tests/web/pwa-login.test.ts
npm run typecheck
npm --prefix web run typecheck
npm run build:web
npm --prefix web run build:demo
```

The store tests are also registered in the root test aggregator.
The always-run web shell suite builds the normal app, verifies the production
manifest and network-only service worker, and rejects the synthetic demo page.
For the opt-in end-to-end checks, run both builds above, install the existing
Playwright Chromium and WebKit binaries, and run the same test file with
`PWA_DEMO_E2E=1` in the environment (PowerShell:
`$env:PWA_DEMO_E2E='1'; node --import tsx --test tests\web\pwa-login.test.ts`).
These start and stop their own loopback-only relay and exercise actual browser
form submission, screenshots, error responses and mobile touch interactions.
The expiry regression check waits for the real two-minute session lifetime.
