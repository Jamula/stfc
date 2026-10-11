export function reconcileAutomationStateAfterPushFailure(args: {
  stateDir: string;
  ref: string;
  relativePaths: string[];
  remote?: string;
}): Promise<"rebased" | "replayed" | "noop">;

export function isAutomationStateCommitPublished(args: {
  stateDir: string;
  ref: string;
  commit: string;
  remote?: string;
  runGitImpl?: (args: string[]) => Promise<string>;
}): Promise<boolean>;
