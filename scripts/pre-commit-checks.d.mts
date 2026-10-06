/** Type declarations for scripts/pre-commit-checks.mjs */

export const MUTABLE_SQUAD_STATE_PATTERNS: RegExp[];

export const MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST: Set<string>;

export function checkSquadBoundary(
  staged: string[],
  deleted?: string[],
  renamedFrom?: string[],
): void;

export function parseNameStatus(raw: string): {
  staged: string[];
  deleted: string[];
  renamedFrom: string[];
};

export function checkPortableFilenames(staged: string[]): void;

export function parseRawDiffDestHashes(raw: string): Map<string, string>;

export function listUntrackedMutableStateFiles(
  exec?: (cmd: string, args: string[], options: Record<string, unknown>) => string,
): string[];

export function hashObjectForPath(
  filePath: string,
  exec?: (cmd: string, args: string[], options: Record<string, unknown>) => string,
): string | null;

export function checkNoUntrackedMutableStateCopies(
  destHashes: Map<string, string>,
  ignoredMutableFiles: string[],
  hashFn?: (filePath: string) => string | null,
): void;

export function grepTestsForWorkflow(basename: string): string[];

export function checkWorkflowPinningTests(
  staged: string[],
  grep?: (basename: string) => string[],
): void;
