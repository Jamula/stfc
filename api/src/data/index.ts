import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { requireAllowedUser, requireRole } from '../_lib/auth.js';
import { errorResponse } from '../_lib/respond.js';
import { loadDashboard, parseRunQuery } from '../_lib/dashboard.js';
import type { DashboardTab } from '../../../shared/dashboard.js';

const TABS: readonly DashboardTab[] = ['redeems', 'digests', 'telemetry', 'crew', 'runs'];

export async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const principal = requireAllowedUser(req);
    void principal;
    requireRole(req, 'stfc_operator');
    const tab = TABS.find(candidate => candidate === req.params['tab']);
    if (!tab) {
      return { status: 404, jsonBody: { error: 'Unknown dashboard resource' } };
    }
    const query = parseRunQuery(new URL(req.url));
    if (!query) return { status: 400, jsonBody: { error: 'Invalid workflow or limit (1-100)' } };
    const data = await loadDashboard(tab, query);
    return {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
      jsonBody: data,
    };
  } catch (error) {
    // Never log upstream payloads, headers, or credentials.
    context.error('Dashboard read failed', error instanceof Error ? error.name : 'UnknownError');
    return errorResponse(error);
  }
}

app.http('dashboard-data', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'data/{tab}',
  handler,
});
