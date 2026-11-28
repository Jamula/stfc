export function restoreDiscordMonitorState(args: {
  restoreRoot: string;
  workspaceRoot: string;
  mainRef?: string;
}): Promise<void>;

export function persistDiscordMonitorState(args: {
  workspaceRoot: string;
  stateRoot: string;
}): Promise<void>;
