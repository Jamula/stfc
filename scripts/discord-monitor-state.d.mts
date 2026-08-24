export const DISCORD_MONITOR_STATE_FILES: readonly string[];
export const DISCORD_MONITOR_STATE_DIRECTORIES: readonly string[];
export const DISCORD_MONITOR_PROMO_CODES: string;

export function restoreDiscordMonitorState(args: {
  restoreRoot: string;
  workspaceRoot: string;
  mainRef?: string;
}): Promise<void>;

export function persistDiscordMonitorState(args: {
  workspaceRoot: string;
  stateRoot: string;
}): Promise<void>;
