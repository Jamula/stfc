export interface DegradedGiftFailure {
  gift: string;
  giftId?: string;
  streak: number;
}

export type DegradedAlertStatus =
  | 'state-failed'
  | 'lookup-failed'
  | 'create-failed'
  | 'already-open'
  | 'created'
  | 'resolved'
  | 'none'
  | 'close-failed';

export interface DegradedAlertOptions {
  statePath?: string;
  state?: unknown;
  title?: string;
  labels?: readonly string[];
  requiredLabels?: readonly string[];
  runUrl?: string;
  listIssues?: (title: string) => unknown;
  createIssue?: (title: string, labels: readonly string[], body: string) => void;
  closeIssue?: (number: number, comment: string) => void;
  log?: (line: string) => void;
}

export interface DegradedAlertResult {
  status: DegradedAlertStatus;
  number?: number;
  persistentCount: number;
}

export const PERSISTENT_TRANSIENT_RUNS: 3;
export const DEGRADED_ALERT_TITLE: string;
export const DEGRADED_ALERT_LABELS: readonly string[];
export function parseDegradedState(raw: string): DegradedGiftFailure[];
export function syncDegradedGiftAlert(options?: DegradedAlertOptions): DegradedAlertResult;
