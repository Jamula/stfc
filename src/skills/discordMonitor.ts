// Stub for Phase 1 scaffolding (T005/T007). Implementation lands in Phase 3 (T026).
// T007: CLI stub returns { result: "not-implemented", exitCode: 1 }.

export interface DiscordMonitorOptions {
  // Real options land in T026.
  [key: string]: unknown;
}

export interface DiscordMonitorOutput {
  result: unknown;
  exitCode: number;
}

export async function discordMonitor(_opts: DiscordMonitorOptions): Promise<DiscordMonitorOutput> {
  return { result: "not-implemented", exitCode: 1 };
}
