import type { RunResult } from './contracts/run-result.js';

export type DashboardTab = 'redeems' | 'digests' | 'telemetry' | 'crew' | 'runs';
export type Workflow = RunResult['workflow'];

export interface DashboardDocument {
  path: string;
  ref: string;
  content: string;
}

export interface DashboardRun {
  correlation_id: string | null;
  workflow: Workflow;
  actor: string;
  trigger: string;
  created_at: string;
  started_at: string | null;
  conclusion: string | null;
  status: string;
  run_id: number | null;
  business_result: RunResult['business_result'] | null;
}

export interface DashboardData {
  available: boolean;
  message: string | null;
  documents: DashboardDocument[];
  runs: DashboardRun[];
}
