/** Type declarations for scripts/retro-gate-bridge.mjs */

export interface RunCliChildOptions {
  scriptPath: string;
  args: string[];
  input?: string;
  execFileSyncImpl?: (...args: unknown[]) => string;
}

export interface RunCliChildResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  status?: number | null;
  error?: unknown;
}

export function runCliChild(opts: RunCliChildOptions): RunCliChildResult;

export interface CheckOverdueViaBridgeOptions {
  backend: string;
  repoRoot?: string;
  logDir?: string;
  windowDays?: number;
  stateList?: (opts: { dir: string }) => string[];
  execFileSyncImpl?: (...args: unknown[]) => string;
}

export interface OverdueBridgeResult {
  evaluated: boolean;
  backend: string;
  overdue: boolean;
  windowDays?: number;
  fault?: string;
}

export function checkOverdueViaBridge(opts: CheckOverdueViaBridgeOptions): OverdueBridgeResult;

export interface CheckActionItemsViaBridgeOptions {
  backend: string;
  repoRoot?: string;
  retroLogPath?: string;
  retroLogKey?: string;
  stateRead?: (opts: { key: string }) => string;
  execFileSyncImpl?: (...args: unknown[]) => string;
}

export interface ActionItemsBridgeResult {
  evaluated: boolean;
  backend: string;
  ok: boolean;
  reason?: string | null;
  issueRefCount?: number;
  openCheckboxCount?: number;
  fault?: string;
}

export function checkActionItemsViaBridge(opts: CheckActionItemsViaBridgeOptions): ActionItemsBridgeResult;
