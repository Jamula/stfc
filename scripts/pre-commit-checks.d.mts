/** Type declarations for scripts/pre-commit-checks.mjs */
export function checkConstitutionSync(
  staged: string[],
  readFile?: (path: string) => string,
  exists?: (path: string) => boolean,
): void;

export function checkSquadBoundary(staged: string[]): void;

export function checkPortableFilenames(staged: string[]): void;

export function grepTestsForWorkflow(basename: string): string[];

export function checkWorkflowPinningTests(
  staged: string[],
  grep?: (basename: string) => string[],
): void;
