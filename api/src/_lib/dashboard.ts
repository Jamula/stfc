import { fetchContent, fetchWorkflowRuns, listDirectory } from './github-raw.js';
import type { RunResult } from '../../../shared/contracts/run-result.js';
import type { DashboardData, DashboardDocument, DashboardRun, DashboardTab, Workflow } from '../../../shared/dashboard.js';

const WORKFLOWS: readonly Workflow[] = ['redeem', 'discord-monitor', 'refresh-token'];

export interface RunQuery {
  workflow: Workflow | null;
  limit: number;
}

export function parseRunQuery(url: URL): RunQuery | null {
  const workflow = url.searchParams.get('workflow');
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  if (workflow !== null && !WORKFLOWS.includes(workflow as Workflow)) return null;
  return { workflow: workflow as Workflow | null, limit };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => key in value);
}

/** Validate the generated v1 union before using any committed business result. */
export function isRunResult(value: unknown): value is RunResult {
  if (!object(value) || !keys(value, [
    'schema_version', 'correlation_id', 'workflow', 'triggered_by', 'reason', 'started_at',
    'finished_at', 'duration_ms', 'conclusion', 'business_result',
  ]) || value['schema_version'] !== '1' ||
      typeof value['correlation_id'] !== 'string' || value['correlation_id'].length === 0 ||
      typeof value['triggered_by'] !== 'string' || value['triggered_by'].length === 0 ||
      !(value['reason'] === null || typeof value['reason'] === 'string') ||
      !timestamp(value['started_at']) || !timestamp(value['finished_at']) ||
      !count(value['duration_ms']) ||
      !['success', 'failure', 'cancelled'].includes(String(value['conclusion']))) return false;
  const result = value['business_result'];
  if (!object(result) || !strings(result['infra_errors'])) return false;
  switch (value['workflow']) {
    case 'redeem': return keys(result, ['claimed', 'redeemed', 'infra_errors']) &&
      count(result['claimed']) && count(result['redeemed']);
    case 'discord-monitor': return keys(result, ['digests_added', 'codes_extracted', 'infra_errors']) &&
      count(result['digests_added']) && count(result['codes_extracted']);
    case 'refresh-token': return keys(result, ['token_refreshed_for', 'infra_errors']) &&
      strings(result['token_refreshed_for']);
    default: return false;
  }
}

export function parseActions(value: unknown, workflow: Workflow): DashboardRun[] {
  if (!object(value) || !Array.isArray(value['workflow_runs'])) throw new Error('Invalid Actions response');
  return value['workflow_runs'].slice(0, 20).map((run: unknown): DashboardRun => {
    if (!object(run) || !count(run['id']) || !timestamp(run['created_at']) ||
        !(run['run_started_at'] === undefined || run['run_started_at'] === null || timestamp(run['run_started_at'])) ||
        typeof run['event'] !== 'string' || typeof run['status'] !== 'string' ||
        !(run['conclusion'] === null || typeof run['conclusion'] === 'string') ||
        !object(run['actor']) || typeof run['actor']['login'] !== 'string' ||
        typeof run['display_title'] !== 'string') throw new Error('Invalid Actions run');
    const marker = /(?:^|\s)correlation_id=([A-Za-z0-9_-]+)(?=\s|$)/.exec(run['display_title']);
    return {
      correlation_id: marker?.[1] ?? `${run['event'] === 'schedule' ? 'cron' : 'run'}-${run['id']}`,
      workflow,
      actor: run['actor']['login'],
      trigger: run['event'],
      created_at: run['created_at'],
      started_at: ['in_progress', 'completed'].includes(run['status']) && typeof run['run_started_at'] === 'string'
        ? run['run_started_at'] : null,
      conclusion: run['conclusion'],
      status: run['status'],
      run_id: run['id'],
      business_result: null,
    };
  });
}

export function mergeRuns(artifacts: RunResult[], actions: DashboardRun[], limit: number): DashboardRun[] {
  const merged = new Map<string, DashboardRun>();
  for (const artifact of [...artifacts].sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at))) {
    const existing = merged.get(artifact.correlation_id);
    if (existing && existing.workflow !== artifact.workflow) throw new Error('Conflicting run correlation');
    merged.set(artifact.correlation_id, {
      correlation_id: artifact.correlation_id,
      workflow: artifact.workflow,
      actor: artifact.triggered_by,
      trigger: artifact.triggered_by === 'schedule' ? 'schedule' : 'workflow_dispatch',
      created_at: artifact.started_at,
      started_at: artifact.started_at,
      conclusion: artifact.conclusion,
      status: 'completed',
      run_id: null,
      business_result: artifact.business_result,
    });
  }
  // Latest Actions metadata wins (including reruns), but never loses the business result.
  for (const action of [...actions].sort((a, b) => Date.parse(a.started_at ?? a.created_at) - Date.parse(b.started_at ?? b.created_at) || (a.run_id ?? 0) - (b.run_id ?? 0))) {
    const existing = merged.get(action.correlation_id);
    if (existing && existing.workflow !== action.workflow) throw new Error('Conflicting run correlation');
    merged.set(action.correlation_id, { ...action, business_result: existing?.business_result ?? null });
  }
  return [...merged.values()]
    .sort((a, b) => Date.parse(b.started_at ?? b.created_at) - Date.parse(a.started_at ?? a.created_at) || b.correlation_id.localeCompare(a.correlation_id))
    .slice(0, limit);
}

async function document(path: string, ref: string): Promise<DashboardDocument> {
  const result = await fetchContent(path, { ref });
  if (!result) throw new Error('Dashboard source is missing');
  return { path, ref, content: result.content };
}

async function runArtifacts(): Promise<RunResult[]> {
  const directory = await listDirectory('data/runs', { ref: 'main' });
  if (!directory) return [];
  const files = directory.entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.json'));
  const results: RunResult[] = [];
  for (const entry of files) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(entry.name)) throw new Error('Invalid run artifact filename');
    const item = await document(`data/runs/${entry.name}`, 'main');
    const parsed: unknown = JSON.parse(item.content);
    if (!isRunResult(parsed)) throw new Error('Invalid run artifact');
    results.push(parsed);
  }
  return results;
}

export async function loadDashboard(tab: DashboardTab, query: RunQuery): Promise<DashboardData> {
  const data: DashboardData = { available: true, message: null, documents: [], runs: [] };
  switch (tab) {
    case 'redeems':
      data.documents = [await document('docs/redeem-history.md', 'automation-state')];
      break;
    case 'crew':
      data.documents = [await document('data/crew/officers.json', 'main')];
      // Bad JSON must not look like successfully loaded crew data.
      if (!Array.isArray(JSON.parse(data.documents[0]!.content))) throw new Error('Invalid crew data');
      break;
    case 'digests': {
      const directory = await listDirectory('data/digests', { ref: 'automation-state' });
      if (!directory) {
        data.available = false;
        data.message = 'No committed digest source is available on automation-state.';
        break;
      }
      const entries = directory.entries
        .filter(entry => entry.type === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name)).slice(0, 20);
      for (const entry of entries) data.documents.push(await document(`data/digests/${entry.name}`, 'automation-state'));
      break;
    }
    case 'telemetry':
      data.available = false;
      data.message = 'Telemetry is unavailable: no approved telemetry artifact producer is configured.';
      break;
    case 'runs': {
      const workflows = query.workflow ? [query.workflow] : WORKFLOWS;
      const [artifacts, actions] = await Promise.all([
        runArtifacts(),
        Promise.all(workflows.map(async workflow => parseActions(await fetchWorkflowRuns(workflow), workflow))),
      ]);
      data.runs = mergeRuns(artifacts.filter(run => !query.workflow || run.workflow === query.workflow), actions.flat(), query.limit);
      break;
    }
  }
  return data;
}
