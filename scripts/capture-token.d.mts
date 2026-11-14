import type { BrowserContext, ElementHandle, Frame, Locator, Page } from "playwright";

export type OtpEntry =
  | { kind: "single"; el: ElementHandle<HTMLElement | SVGElement>; frame: Frame }
  | { kind: "split"; boxes: Locator; count: number; frame: Frame };

export interface CapturedAccount {
  name: string;
  token: string;
}

export interface CapturedToken {
  token: string | null;
  source: string;
}

export interface TokenValidation {
  ok: boolean;
  status: number;
  error?: string;
}

export function findOtpEntry(page: Page): Promise<OtpEntry | null>;
export function fillOtp(page: Page, entry: OtpEntry, code: string): Promise<void>;
export function captureToken(options: { context: BrowserContext; timeoutMs: number; signal?: AbortSignal }): Promise<CapturedToken>;
export function validateToken(token: string): Promise<TokenValidation>;
export function waitForFirstSelector(page: Page, selectors: string[], timeoutMs: number): Promise<ElementHandle<HTMLElement | SVGElement> | null>;
export function clickFirstAvailable(page: Page, selectors: string[]): Promise<boolean>;
export function beginEmailLogin(page: Page, email: string, log?: (...args: unknown[]) => void): Promise<boolean>;
export function mergeIntoEnv(options: { name: string; token: string; force: boolean; _envPath?: string }): Promise<CapturedAccount[]>;
export const OTP_SELECTORS: string[];
export const SPLIT_OTP_SELECTOR: string;
