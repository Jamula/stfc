import type { ElementHandle, Frame, Locator, Page } from "playwright";

export interface TokenCaptureContext {
  on(event: "request", listener: (request: unknown) => void): unknown;
  on(event: "response", listener: (response: unknown) => void): unknown;
  off(event: "request", listener: (request: unknown) => void): unknown;
  off(event: "response", listener: (response: unknown) => void): unknown;
}

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
export function captureToken(options: { context: TokenCaptureContext; timeoutMs: number; signal?: AbortSignal; closeAfterCapture?: () => Promise<void>; responseDrainTimeoutMs?: number }): Promise<CapturedToken>;
export function validateToken(token: string): Promise<TokenValidation>;
export function waitForFirstSelector(page: Page, selectors: string[], timeoutMs: number): Promise<ElementHandle<HTMLElement | SVGElement> | null>;
export function clickFirstAvailable(page: Page, selectors: string[]): Promise<boolean>;
export function beginEmailLogin(page: Page, email: string, log?: (...args: unknown[]) => void): Promise<boolean>;
export function mergeIntoEnv(options: {
  name: string;
  token: string;
  force: boolean;
  _envPath?: string;
  _expectedRaw?: string | null;
  _beforeReplace?: () => Promise<void>;
  _rename?: (source: string, destination: string) => Promise<void>;
}): Promise<CapturedAccount[] & { secretJson: string; envRaw: string }>;
export function mergeAfterIdentityConfirmation(options: {
  name: string;
  token: string;
  force: boolean;
  baseline: string | null;
  expectedId: string;
  envPath?: string;
  verify?: (token: string, expectedId: string) => Promise<boolean>;
}): Promise<CapturedAccount[] & { secretJson: string; envRaw: string }>;
export function verifyAccountId(token: string, expectedId: string, fetchImpl?: (url: string, options: { headers: { Accept: string; Authorization: string }; redirect: string; signal: AbortSignal }) => Promise<Response>): Promise<boolean>;
export function validateRecoveryBaseline(raw: string | null, name: string): void;
export function readAccountName(streams?: unknown): Promise<string>;
export function readExpectedAccountId(streams?: unknown): Promise<string>;
export function main(argv?: string[], dependencies?: unknown): Promise<void>;
export const OTP_SELECTORS: string[];
export const SPLIT_OTP_SELECTOR: string;
