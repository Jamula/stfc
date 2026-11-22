import type { DashboardData, DashboardRun, DashboardTab, Workflow } from '../../shared/dashboard.js';

function isRun(value: unknown): value is DashboardRun {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return (run['correlation_id'] === null || typeof run['correlation_id'] === 'string') &&
    ['redeem', 'discord-monitor', 'refresh-token'].includes(String(run['workflow'])) &&
    typeof run['actor'] === 'string' && typeof run['trigger'] === 'string' &&
    typeof run['created_at'] === 'string' && (run['started_at'] === null || typeof run['started_at'] === 'string') &&
    typeof run['status'] === 'string' &&
    (run['conclusion'] === null || typeof run['conclusion'] === 'string') &&
    (run['run_id'] === null || (typeof run['run_id'] === 'number' && Number.isSafeInteger(run['run_id']))) &&
    (run['business_result'] === null || (typeof run['business_result'] === 'object' && !Array.isArray(run['business_result'])));
}

export async function loadDashboard(
  tab: DashboardTab,
  signal?: AbortSignal,
  query: { workflow?: Workflow; limit?: number } = {},
): Promise<DashboardData> {
  const params = new URLSearchParams();
  if (query.workflow) params.set('workflow', query.workflow);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params}` : '';
  const response = await fetch(`/api/data/${tab}${suffix}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Unable to load ${tab} (HTTP ${response.status}).`);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Expected dashboard JSON. Your sign-in may have expired.');
  }
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null ||
      !('available' in data) || typeof data.available !== 'boolean' ||
      !('message' in data) || !(data.message === null || typeof data.message === 'string') ||
      !('documents' in data) || !Array.isArray(data.documents) ||
      !data.documents.every((item: unknown) => typeof item === 'object' && item !== null &&
        'path' in item && typeof item.path === 'string' &&
        'ref' in item && typeof item.ref === 'string' &&
        'content' in item && typeof item.content === 'string') ||
      !('runs' in data) || !Array.isArray(data.runs) || !data.runs.every(isRun)) {
    throw new Error('Invalid dashboard response.');
  }
  return data as DashboardData;
}
