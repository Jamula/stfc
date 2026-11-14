import { randomBytes } from "node:crypto";

export interface BrowserLoginSession {
  screenshot(): Promise<Buffer>;
  submitOtp(code: string): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserSessionFactory {
  open(email: string, signal?: AbortSignal): Promise<BrowserLoginSession>;
}

export interface StartedLogin {
  id: string;
  screenshot: string;
}

export interface CapturedLogin {
  accountName: string;
  token: string;
}

export class LoginSessionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 410 | 422 | 429 | 500,
  ) {
    super(message);
    this.name = "LoginSessionError";
  }
}

interface ActiveSession {
  id: string;
  accountName: string;
  expiresAt: number;
  attempts: number;
  verifying: boolean;
  browser: BrowserLoginSession;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abortHandler?: () => void;
  closed: boolean;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export class LoginSessionManager {
  private active?: ActiveSession;
  private starting = false;

  constructor(
    private readonly factory: BrowserSessionFactory,
    private readonly now: () => number = Date.now,
  ) {}

  async start(accountName: unknown, email: unknown, signal?: AbortSignal): Promise<StartedLogin> {
    this.expireIfNeeded();
    if (signal?.aborted) throw new LoginSessionError("The login session is no longer available.", 410);
    if (this.active || this.starting) throw new LoginSessionError("A login is already in progress.", 429);
    if (typeof accountName !== "string" || !ACCOUNT_NAME.test(accountName)) {
      throw new LoginSessionError("Enter a valid account name.", 400);
    }
    if (typeof email !== "string" || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new LoginSessionError("Enter a valid email address.", 400);
    }

    this.starting = true;
    let browser: BrowserLoginSession;
    try {
      browser = await this.factory.open(email, signal);
      if (signal?.aborted) {
        await browser.close();
        throw new LoginSessionError("The login session is no longer available.", 410);
      }
    } finally {
      this.starting = false;
    }
    const id = randomBytes(32).toString("base64url");
    const active: ActiveSession = {
      id,
      accountName,
      expiresAt: this.now() + SESSION_TTL_MS,
      attempts: 0,
      verifying: false,
      browser,
      timer: setTimeout(() => this.close(active), SESSION_TTL_MS),
      signal,
      closed: false,
    };
    if (signal) {
      active.abortHandler = () => { void this.close(active); };
      signal.addEventListener("abort", active.abortHandler, { once: true });
    }
    active.timer.unref();
    this.active = active;

    try {
      const started = {
        id,
        screenshot: (await browser.screenshot()).toString("base64"),
      };
      if (signal?.aborted) throw new LoginSessionError("The login session is no longer available.", 410);
      return started;
    } catch (error) {
      await this.close(active);
      throw error;
    }
  }

  async verify(id: unknown, otp: unknown): Promise<CapturedLogin> {
    const active = this.get(id);
    if (active.verifying) throw new LoginSessionError("A verification attempt is already in progress.", 409);
    if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      throw new LoginSessionError("Enter the 6-digit verification code.", 400);
    }
    active.attempts++;
    if (active.attempts > 3) {
      await this.close(active);
      throw new LoginSessionError("The verification attempt limit was reached.", 429);
    }

    active.verifying = true;
    try {
      const token = await active.browser.submitOtp(otp);
      const result = { accountName: active.accountName, token };
      await this.close(active);
      return result;
    } catch (error) {
      if (error instanceof LoginSessionError && error.status === 422 && active.attempts < 3) {
        active.verifying = false;
        throw error;
      }
      await this.close(active);
      if (error instanceof LoginSessionError && error.status === 422 && active.attempts === 3) {
        throw new LoginSessionError("The verification attempt limit was reached.", 429);
      }
      throw error;
    }
  }

  async cancel(id: unknown): Promise<void> {
    const active = this.get(id);
    await this.close(active);
  }

  private get(id: unknown): ActiveSession {
    this.expireIfNeeded();
    if (typeof id !== "string" || !this.active || this.active.id !== id) {
      throw new LoginSessionError("The login session is no longer available.", 404);
    }
    return this.active;
  }

  private expireIfNeeded(): void {
    if (this.active && this.active.expiresAt <= this.now()) void this.close(this.active);
  }

  private async close(active: ActiveSession): Promise<void> {
    if (active.closed) return;
    active.closed = true;
    if (this.active === active) this.active = undefined;
    clearTimeout(active.timer);
    if (active.signal && active.abortHandler) {
      active.signal.removeEventListener("abort", active.abortHandler);
    }
    try {
      await active.browser.close();
    } catch (error) {
      console.error("Login browser cleanup failed", error instanceof Error ? error.name : "UnknownError");
    }
  }
}
