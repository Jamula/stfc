/** Type declarations for scripts/check-retro-overdue.mjs */

export const RETRO_FILENAME_PATTERN: RegExp;

export function parseLogTimestamp(filename: string): Date | null;

export function isRetroOverdue(opts: {
  entries: string[];
  windowDays?: number;
  now?: Date;
}): boolean;

export function listLocalRetroLogs(logDir: string): string[];

export function checkRetroOverdue(opts: {
  backend: string;
  logDir?: string;
  entries?: string[];
  windowDays?: number;
  now?: Date;
}): boolean;

export interface ActionItemsResult {
  ok: boolean;
  reason: string | null;
  issueRefCount: number;
  openCheckboxCount: number;
}

export function checkActionItemsCreated(content: string): ActionItemsResult;

export function readRetroLogContent(opts: {
  backend: string;
  retroLogPath?: string;
  content?: string;
}): string;
