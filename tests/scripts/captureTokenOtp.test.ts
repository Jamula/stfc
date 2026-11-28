// Regression tests for the OTP widget handling in scripts/capture-token.ts.
//
// Scopely moved to passwordless login, where the 6-digit code is rendered as
// six separate maxlength="1" boxes. The original selectors only matched a
// single maxlength="6" input, so auto-login timed out with "neither a
// password-switch link nor an OTP field appeared" and the STFC_ACCOUNTS
// secret silently went stale.
//
// These run against a real Chromium page so the selectors are verified
// against an actual DOM rather than a hand-rolled mock.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";

import { findOtpEntry, fillOtp, promptAndSubmitOtp, type OtpEntry } from "../../scripts/capture-token.ts";

const SPLIT_OTP_PAGE = `
  <html><body>
    <div role="alert">Haven't received an email? Send again</div>
    <div class="otp">
      <input type="text" maxlength="1" />
      <input type="text" maxlength="1" />
      <input type="text" maxlength="1" />
      <input type="text" maxlength="1" />
      <input type="text" maxlength="1" />
      <input type="text" maxlength="1" />
    </div>
    <button type="submit">Sign in</button>
  </body></html>`;

const SINGLE_OTP_PAGE = `
  <html><body>
    <input type="text" autocomplete="one-time-code" maxlength="6" />
    <button type="submit">Verify</button>
  </body></html>`;

const NO_OTP_PAGE = `
  <html><body>
    <input type="email" />
    <button type="submit">Continue</button>
  </body></html>`;

describe("capture-token OTP widget handling", () => {
  let browser: Browser;
  let page: Page;
  // CI runners do not install Playwright browsers for the test job, so skip
  // rather than fail. These selectors are exercised locally, which is where
  // capture-token actually runs.
  let browserAvailable = true;

  before(async () => {
    try {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
    } catch {
      browserAvailable = false;
    }
  });

  after(async () => {
    await browser?.close();
  });

  it("detects the passwordless split-box widget (6 x maxlength=1)", async (t) => {
    if (!browserAvailable) return t.skip("Chromium not installed");
    await page.setContent(SPLIT_OTP_PAGE);
    const entry = await findOtpEntry(page);

    assert.ok(entry, "expected the split OTP widget to be detected");
    if (!entry) assert.fail("expected the split OTP widget to be detected");
    assert.equal(entry.kind, "split");
    assert.equal(entry.count, 6);
  });

  it("spreads one digit per box when filling a split widget", async (t) => {
    if (!browserAvailable) return t.skip("Chromium not installed");
    await page.setContent(SPLIT_OTP_PAGE);
    const entry = await findOtpEntry(page);
    if (!entry) assert.fail("expected the split OTP widget to be detected");
    await fillOtp(page, entry, "711997");

    const values = await page.$$eval('input[maxlength="1"]', (els) =>
      els.map((e) => (e as HTMLInputElement).value),
    );
    assert.deepEqual(values, ["7", "1", "1", "9", "9", "7"]);
  });

  it("ignores non-digit characters in the supplied code", async (t) => {
    if (!browserAvailable) return t.skip("Chromium not installed");
    await page.setContent(SPLIT_OTP_PAGE);
    const entry = await findOtpEntry(page);
    if (!entry) assert.fail("expected the split OTP widget to be detected");
    await fillOtp(page, entry, "711-997");

    const values = await page.$$eval('input[maxlength="1"]', (els) =>
      els.map((e) => (e as HTMLInputElement).value),
    );
    assert.deepEqual(values, ["7", "1", "1", "9", "9", "7"]);
  });

  it("still detects and fills the classic single-input widget", async (t) => {
    if (!browserAvailable) return t.skip("Chromium not installed");
    await page.setContent(SINGLE_OTP_PAGE);
    const entry = await findOtpEntry(page);

    assert.ok(entry, "expected the single-input OTP widget to be detected");
    if (!entry) assert.fail("expected the single-input OTP widget to be detected");
    assert.equal(entry.kind, "single");

    await fillOtp(page, entry, "123456");
    const value = await page.$eval(
      'input[autocomplete="one-time-code"]',
      (e) => (e as HTMLInputElement).value,
    );
    assert.equal(value, "123456");
  });

  it("returns null when no OTP widget is present", async (t) => {
    if (!browserAvailable) return t.skip("Chromium not installed");
    await page.setContent(NO_OTP_PAGE);
    assert.equal(await findOtpEntry(page), null);
  });

  it("fails closed in headless mode without STFC_OTP instead of polling temp files", async () => {
    const priorOtp = process.env["STFC_OTP"];
    let filled: string | null = null;
    let clicked = false;
    const mockPage = {
      frames: () => [],
      $: async () => ({
        isVisible: async () => true,
        isEnabled: async () => true,
        click: async () => {
          clicked = true;
        },
      }),
      waitForTimeout: async () => {},
    } as unknown as Page;
    const mockEntry = {
      kind: "single",
      el: { fill: async (v: string) => { filled = v; } },
      frame: {},
    } as unknown as OtpEntry;

    try {
      for (const blankValue of [undefined, "", "   "] as const) {
        if (blankValue === undefined) delete process.env["STFC_OTP"];
        else process.env["STFC_OTP"] = blankValue;

        const logs: string[] = [];
        const submitted = await promptAndSubmitOtp({
          page: mockPage,
          entry: mockEntry,
          log: (...args: unknown[]) => logs.push(args.join(" ")),
          headless: true,
        });

        assert.equal(submitted, false);
        assert.equal(filled, null);
        assert.equal(clicked, false);
        assert.match(logs.join("\n"), /headless OTP challenge requires STFC_OTP/);
      }
    } finally {
      if (priorOtp === undefined) delete process.env["STFC_OTP"];
      else process.env["STFC_OTP"] = priorOtp;
    }
  });

  it("submits trimmed STFC_OTP in headless mode", async () => {
    const priorOtp = process.env["STFC_OTP"];
    let filled: string | null = null;
    let clicked = false;
    const mockPage = {
      frames: () => [],
      $: async (selector: string) =>
        selector.startsWith("button")
          ? {
              isVisible: async () => true,
              isEnabled: async () => true,
              click: async () => {
                clicked = true;
              },
            }
          : null,
      waitForTimeout: async () => {},
    } as unknown as Page;
    const mockEntry = {
      kind: "single",
      el: { fill: async (v: string) => { filled = v; } },
      frame: {},
    } as unknown as OtpEntry;

    try {
      process.env["STFC_OTP"] = "  654321  ";
      const logs: string[] = [];
      const submitted = await promptAndSubmitOtp({
        page: mockPage,
        entry: mockEntry,
        log: (...args: unknown[]) => logs.push(args.join(" ")),
        headless: true,
      });

      assert.equal(submitted, true);
      assert.equal(filled, "654321");
      assert.equal(clicked, true);
      assert.match(logs.join("\n"), /using OTP from STFC_OTP env var/);
    } finally {
      if (priorOtp === undefined) delete process.env["STFC_OTP"];
      else process.env["STFC_OTP"] = priorOtp;
    }
  });
});
