export function reconcileAutomationStateAfterPushFailure(args: {
  stateDir: string;
  ref: string;
  relativePaths: string[];
  remote?: string;
}): Promise<"rebased" | "replayed" | "noop">;
