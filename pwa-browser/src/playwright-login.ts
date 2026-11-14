import { chromium, type Browser, type Page } from "playwright";
import {
  beginEmailLogin,
  captureToken,
  clickFirstAvailable,
  fillOtp,
  findOtpEntry,
} from "../../scripts/capture-token.mjs";
import type { BrowserLoginSession, BrowserSessionFactory } from "./login-sessions.js";
import { LoginSessionError } from "./login-sessions.js";

const STORE_URL = "https://home.startrekfleetcommand.com/store";
const OTP_SUBMIT_BUTTONS = [
  'button:has-text("Verify")',
  'button:has-text("Submit")',
  'button:has-text("Sign in")',
  'button[type="submit"]',
  "button.ant-btn-primary",
];

export class PlaywrightLoginFactory implements BrowserSessionFactory {
  async open(email: string, signal?: AbortSignal): Promise<BrowserLoginSession> {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const closeOnAbort = () => {
      void browser.close().catch((error: unknown) => {
        console.error("Login browser cleanup failed", error instanceof Error ? error.name : "UnknownError");
      });
    };
    signal?.addEventListener("abort", closeOnAbort, { once: true });
    let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;

    try {
      if (signal?.aborted) throw new LoginSessionError("The login session is no longer available.", 410);
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const abort = new AbortController();
      const captured = captureToken({ context, timeoutMs: 10 * 60 * 1000, signal: abort.signal });
      await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (signal?.aborted) throw new LoginSessionError("The login session is no longer available.", 410);
      if (!(await beginEmailLogin(page, email))) {
        throw new LoginSessionError("The STFC sign-in page could not be opened.", 422);
      }
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new LoginSessionError("The login session is no longer available.", 410);
        if (await findOtpEntry(page)) return new PlaywrightLoginSession(browser, page, captured, abort);
        await page.waitForTimeout(500);
      }
      throw new LoginSessionError("The expected email-code challenge did not appear.", 422);
    } catch (error) {
      await context?.close().catch((closeError: unknown) => {
        console.error("Login browser context cleanup failed", closeError instanceof Error ? closeError.name : "UnknownError");
      });
      await browser.close().catch((closeError: unknown) => {
        console.error("Login browser cleanup failed", closeError instanceof Error ? closeError.name : "UnknownError");
      });
      throw error instanceof LoginSessionError
        ? error
        : new LoginSessionError("The STFC sign-in flow could not be started.", 422);
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
    }
  }
}

class PlaywrightLoginSession implements BrowserLoginSession {
  constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly captured: ReturnType<typeof captureToken>,
    private readonly abort: AbortController,
  ) {}

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ type: "png", fullPage: false });
  }

  async submitOtp(code: string): Promise<string> {
    const entry = await findOtpEntry(this.page);
    if (!entry) throw new LoginSessionError("The email-code challenge is no longer available.", 410);
    await fillOtp(this.page, entry, code);
    if (!(await clickFirstAvailable(this.page, OTP_SUBMIT_BUTTONS))) {
      throw new LoginSessionError("The email-code form could not be submitted.", 422);
    }
    await this.page.waitForTimeout(1500);
    if (await findOtpEntry(this.page)) {
      throw new LoginSessionError("The verification code was not accepted.", 422);
    }

    const result = await Promise.race([
      this.captured,
      this.page.waitForTimeout(20_000).then(() => null),
    ]);
    if (!result?.token) {
      throw new LoginSessionError("STFC did not return a usable login token.", 422);
    }
    return result.token;
  }

  async close(): Promise<void> {
    this.abort.abort();
    await this.browser.close();
  }
}
