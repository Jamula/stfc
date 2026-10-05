/** Type declarations for scripts/pre-commit-checks.mjs */

export function checkSquadBoundary(staged: string[], deleted?: string[]): void;

export function checkPortableFilenames(staged: string[]): void;

export function grepTestsForWorkflow(basename: string): string[];

export function checkWorkflowPinningTests(
  staged: string[],
  grep?: (basename: string) => string[],
): void;
