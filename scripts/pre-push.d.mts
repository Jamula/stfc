/** Type declarations for scripts/pre-push.mjs */

export function isPushToMain(stdin: string): boolean;

export function getCommitsBehind(): number;

export function rebaseOntoOrigin():
  | { success: true }
  | { success: false; error: string };
