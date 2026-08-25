/** Type declarations for scripts/dead-token-alert.mjs */

export interface AlertIssue {
  number: number;
  title: string;
  labels?: Array<{ name?: string } | string>;
}

export interface AlertSelectOptions {
  title: string;
  requiredLabels?: readonly string[];
}

export interface AlertLookupOptions extends AlertSelectOptions {
  listIssues?: (title: string) => unknown;
  log?: (line: string) => void;
}

export interface AlertResolveOptions extends AlertLookupOptions {
  runUrl?: string;
  closeIssue?: (number: number, comment: string) => void;
}

export interface AlertLookupResult {
  number: number | undefined;
  matchCount: number;
}

export type AlertResolveStatus = "closed" | "none" | "lookup-failed" | "close-failed";

export interface AlertResolveResult {
  status: AlertResolveStatus;
  number?: number;
  matchCount: number;
}

export const DEFAULT_REQUIRED_LABELS: readonly string[];

export function parseIssues(raw: string | undefined | null): AlertIssue[];

export function selectAlertIssues(issues: unknown, options: AlertSelectOptions): AlertIssue[];

export function findAlertIssue(options: AlertLookupOptions): AlertLookupResult;

export function resolveDeadTokenAlert(options: AlertResolveOptions): AlertResolveResult;
