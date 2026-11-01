/** Type declarations for scripts/pre-commit-checks.mjs */

export function parseNameStatus(raw: string): {
  staged: string[];
  deleted: string[];
  renamedFrom: string[];
  renames: Array<{
    status: string;
    source: string;
    destination: string;
  }>;
};

export function checkPortableFilenames(staged: string[]): void;

export function grepTestsForWorkflow(basename: string): string[];

export function checkWorkflowPinningTests(
  staged: string[],
  grep?: (basename: string) => string[],
): void;
