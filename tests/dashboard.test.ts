/**
 * Focused tests for the #112 Phase-1 dashboard API, GitHub adapter, and UI.
 * All outbound HTTP is mocked; the UI integration uses a loopback Vite server.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HttpRequest, InvocationContext } from "../api/node_modules/@azure/functions/types/index.js";
import type { RunResult } from "../shared/contracts/run-result.ts";
import type { DashboardData, DashboardRun, DashboardTab, Workflow } from "../shared/dashboard.ts";
import { handler } from "../api/src/data/index.ts";
import {
  isRunResult,
  loadDashboard,
  mergeRuns,
  parseActions,
  parseRunQuery,
} from "../api/src/_lib/dashboard.ts";
import { _clearCache, fetchWorkflowRuns } from "../api/src/_lib/github-raw.ts";
import { loadDashboard as loadDashboardClient } from "../web/src/dashboard-client.ts";

type FetchImpl = (url: string, init: RequestInit) => Response | Promise<Response>;
type FetchCall = { url: string; init: RequestInit };

async function withMockFetch<T>(
  impl: FetchImpl,
  run: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  _clearCache();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return impl(url, requestInit);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    _clearCache();
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function contentsBody(content: string, sha = "dashboard-sha"): unknown {
  return {
    content: Buffer.from(content, "utf8").toString("base64"),
    encoding: "base64",
    sha,
  };
}

function directoryEntry(name: string, path: string, type = "file") {
  return { name, path, sha: `sha-${name}`, size: 12, type };
}

function resultFixture(overrides: Partial<Extract<RunResult, { workflow: "redeem" }>> = {}): RunResult {
  return {
    schema_version: "1",
    correlation_id: "job_abc-123",
    triggered_by: "alice",
    reason: "manual run",
    started_at: "2026-10-30T12:00:00Z",
    finished_at: "2026-10-30T12:01:00Z",
    duration_ms: 60_000,
    conclusion: "success",
    workflow: "redeem",
    business_result: { claimed: 4, redeemed: 3, infra_errors: [] },
    ...overrides,
  };
}

function actionRun(overrides: Partial<DashboardRun> = {}): DashboardRun {
  return {
    correlation_id: "job_abc-123",
    workflow: "redeem",
    actor: "alice",
    trigger: "workflow_dispatch",
    created_at: "2026-10-30T12:00:00Z",
    started_at: "2026-10-30T12:00:00Z",
    conclusion: "success",
    status: "completed",
    run_id: 501,
    business_result: null,
    ...overrides,
  };
}

function actionsItem(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    created_at: `2026-10-30T12:${String(id % 60).padStart(2, "0")}:00Z`,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    actor: { login: "alice" },
    display_title: `Run ${id}`,
    ...overrides,
  };
}

const VALID_PRINCIPAL = {
  identityProvider: "github",
  userId: "principal-id",
  userDetails: "dashboard-user",
  userRoles: ["anonymous", "authenticated", "stfc_operator"],
};

function makeRequest(
  tab: string,
  options: {
    principal?: typeof VALID_PRINCIPAL | null;
    query?: string;
  } = {},
): HttpRequest {
  const headers = new Headers();
  if (options.principal !== null) {
    const principal = options.principal ?? VALID_PRINCIPAL;
    headers.set("x-ms-client-principal", Buffer.from(JSON.stringify(principal)).toString("base64"));
  }
  return {
    headers,
    params: { tab },
    url: `https://dashboard.test/api/data/${tab}${options.query ?? ""}`,
  } as unknown as HttpRequest;
}

function makeContext(errors: unknown[][] = []): InvocationContext {
  return { error: (...values: unknown[]) => errors.push(values) } as unknown as InvocationContext;
}

describe("dashboard run query and contract validation", () => {
  it("defaults to 20 and accepts each approved workflow at the inclusive 1 and 100 limits", () => {
    assert.deepEqual(parseRunQuery(new URL("https://dashboard.test/api/data/runs")), {
      workflow: null,
      limit: 20,
    });
    for (const workflow of ["redeem", "discord-monitor", "refresh-token"] as const) {
      assert.deepEqual(
        parseRunQuery(new URL(`https://dashboard.test/api/data/runs?workflow=${workflow}&limit=1`)),
        { workflow, limit: 1 },
      );
      assert.deepEqual(
        parseRunQuery(new URL(`https://dashboard.test/api/data/runs?workflow=${workflow}&limit=100`)),
        { workflow, limit: 100 },
      );
    }
  });

  it("rejects unknown workflows and limits outside integer range 1 through 100", () => {
    for (const query of [
      "?workflow=all",
      "?workflow=other",
      "?limit=0",
      "?limit=101",
      "?limit=-1",
      "?limit=1.5",
      "?limit=NaN",
      "?limit=",
    ]) {
      assert.equal(
        parseRunQuery(new URL(`https://dashboard.test/api/data/runs${query}`)),
        null,
        `query ${query} must be rejected`,
      );
    }
  });

  it("accepts each v1 business-result variant and rejects extra top-level or variant keys", () => {
    const redeem = resultFixture();
    const monitor: RunResult = {
      ...redeem,
      workflow: "discord-monitor",
      business_result: { digests_added: 2, codes_extracted: 5, infra_errors: [] },
    };
    const refresh: RunResult = {
      ...redeem,
      workflow: "refresh-token",
      business_result: { token_refreshed_for: ["account-a"], infra_errors: [] },
    };
    for (const fixture of [redeem, monitor, refresh]) assert.equal(isRunResult(fixture), true);

    assert.equal(isRunResult({ ...redeem, uncontracted: "extra" }), false);
    assert.equal(isRunResult({
      ...redeem,
      business_result: { ...redeem.business_result, uncontracted: true },
    }), false);
    assert.equal(isRunResult({ ...redeem, started_at: "not-an-ISO-timestamp" }), false);
    assert.equal(isRunResult({ ...redeem, duration_ms: -1 }), false);
  });
});

describe("Actions run parsing and merge behavior", () => {
  it("keeps the first 20 provider-ordered Actions results without inventing correlation markers", () => {
    const runs = Array.from({ length: 25 }, (_, index) => {
      const id = 900 - index;
      return actionsItem(id, {
        event: "schedule",
        conclusion: null,
        status: "completed",
        display_title: `Scheduled run ${id}`,
      });
    });
    runs[0] = actionsItem(900, {
      event: "workflow_dispatch",
      created_at: "2026-10-30T12:20:00Z",
      run_started_at: "2026-10-30T12:34:56Z",
      display_title: "Redeem output correlation_id=manual_42",
    });
    runs[1] = actionsItem(899, {
      event: "schedule",
      conclusion: null,
      run_started_at: null,
      display_title: "Looks like xcorrelation_id=bad",
    });

    const parsed = parseActions({ workflow_runs: runs }, "redeem");
    assert.equal(parsed.length, 20);
    assert.deepEqual(parsed.map(run => run.run_id), Array.from({ length: 20 }, (_, i) => 900 - i));
    assert.equal(parsed[0]!.correlation_id, "manual_42");
    assert.equal(parsed[0]!.trigger, "workflow_dispatch");
    assert.equal(parsed[0]!.created_at, "2026-10-30T12:20:00Z");
    assert.equal(parsed[0]!.started_at, "2026-10-30T12:34:56Z", "Actions start time must come from run_started_at");
    assert.equal(parsed[1]!.correlation_id, null, "unmarked scheduled runs must remain uncorrelated");
    assert.equal(parsed[1]!.trigger, "schedule");
    assert.equal(parsed[1]!.created_at, "2026-10-30T12:59:00Z");
    assert.equal(parsed[1]!.started_at, null, "queued/no-start runs must not mislabel created_at as started_at");
    assert.equal(parsed[1]!.conclusion, null, "scheduled no-op runs remain represented");
    assert.equal(parsed[1]!.business_result, null);
    assert.equal(parseActions({ workflow_runs: [actionsItem(7)] }, "redeem")[0]!.correlation_id, null);
  });

  it("merges artifacts only when an Actions run carries the same explicit correlation id", () => {
    const artifact = resultFixture({ correlation_id: "cron-899" });
    const unmarked = parseActions({
      workflow_runs: [actionsItem(899, {
        event: "schedule",
        display_title: "Scheduled run cron-899",
      })],
    }, "redeem")[0]!;
    const uncorrelated = mergeRuns([artifact], [unmarked], 20);
    assert.equal(uncorrelated.length, 2, "run ID or title resemblance must not infer a correlation");
    assert.equal(uncorrelated.find(run => run.correlation_id === null)?.run_id, 899);

    const explicitlyMarked = {
      ...unmarked,
      correlation_id: "cron-899",
    };
    const correlated = mergeRuns([artifact], [explicitlyMarked], 20);
    assert.equal(correlated.length, 1);
    assert.equal(correlated[0]!.correlation_id, artifact.correlation_id);
    assert.equal(correlated[0]!.business_result && "claimed" in correlated[0]!.business_result
      ? correlated[0]!.business_result.claimed : null, 4);
  });

  it("rejects malformed Actions responses and malformed run elements", () => {
    assert.throws(() => parseActions({ workflow_runs: "not-an-array" }, "redeem"), /Invalid Actions response/);
    assert.throws(() => parseActions({ workflow_runs: [{}] }, "redeem"), /Invalid Actions run/);
    assert.throws(
      () => parseActions({ workflow_runs: [actionsItem(7, { run_started_at: "not-a-timestamp" })] }, "redeem"),
      /Invalid Actions run/,
    );
  });

  it("keeps queued, waiting, and pending runs unstarted despite a provider run_started_at value", () => {
    for (const [index, status] of ["queued", "waiting", "pending"].entries()) {
      const [run] = parseActions({
        workflow_runs: [actionsItem(950 + index, {
          status,
          run_started_at: "2026-10-30T12:34:56Z",
        })],
      }, "redeem");
      assert.equal(run!.created_at, actionsItem(950 + index).created_at);
      assert.equal(run!.started_at, null, `${status} must remain visibly not started`);
    }

    const [withoutStartField] = parseActions({
      workflow_runs: [actionsItem(960, { status: "completed" })],
    }, "redeem");
    assert.equal(withoutStartField!.started_at, null, "missing run_started_at remains accepted as unavailable");
  });

  it("uses true start timestamps for rerun precedence while retaining the artifact business result", () => {
    const artifact = resultFixture();
    const older = actionRun({
      actor: "alice",
      created_at: "2026-10-30T12:40:05Z",
      started_at: "2026-10-30T12:30:05+02:00",
      conclusion: "failure",
      status: "completed",
      run_id: 502,
      business_result: null,
    });
    const latest = actionRun({
      actor: "bob",
      created_at: "2026-10-30T12:20:05Z",
      started_at: "2026-10-30T11:00:05Z",
      conclusion: null,
      status: "in_progress",
      run_id: 501,
      trigger: "workflow_dispatch",
    });

    const merged = mergeRuns([artifact], [latest, older], 10);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.actor, "bob");
    assert.equal(merged[0]!.started_at, "2026-10-30T11:00:05Z");
    assert.equal(merged[0]!.status, "in_progress");
    assert.equal(merged[0]!.created_at, "2026-10-30T12:20:05Z");
    assert.equal(merged[0]!.run_id, 501);
    const businessResult = merged[0]!.business_result;
    assert.ok(businessResult !== null && "claimed" in businessResult);
    assert.equal(businessResult.claimed, 4);
    assert.equal(businessResult.redeemed, 3);
  });

  it("promotes queued metadata when a later true start timestamp is observed", () => {
    const queued = actionRun({
      actor: "alice",
      correlation_id: "queued-correlation",
      created_at: "2026-10-30T12:00:00Z",
      started_at: null,
      status: "queued",
      run_id: 801,
    });
    const started = actionRun({
      actor: "bob",
      correlation_id: "queued-correlation",
      created_at: "2026-10-30T11:59:00Z",
      started_at: "2026-10-30T12:05:00Z",
      status: "in_progress",
      run_id: 802,
    });

    const [merged] = mergeRuns([], [started, queued], 20);
    assert.equal(merged!.actor, "bob");
    assert.equal(merged!.created_at, "2026-10-30T11:59:00Z");
    assert.equal(merged!.started_at, "2026-10-30T12:05:00Z");
    assert.equal(merged!.status, "in_progress");
    assert.equal(merged!.run_id, 802);
  });

  it("rejects one correlation id assigned to different artifact workflows", () => {
    const redeem = resultFixture({ correlation_id: "duplicate-id" });
    const monitor: RunResult = {
      ...resultFixture(),
      workflow: "discord-monitor",
      correlation_id: "duplicate-id",
      business_result: { digests_added: 1, codes_extracted: 2, infra_errors: [] },
    };
    assert.throws(() => mergeRuns([redeem, monitor], [], 20), /Conflicting run correlation/);
  });
});

describe("GitHub Actions workflow-run cache", () => {
  it("requests only approved workflows with per_page=20 and caches each result hot", async () => {
    await withMockFetch(url => jsonResponse(200, {
      workflow_runs: [{ id: 33, event: "schedule", conclusion: null }],
    }, { etag: '"runs-v1"' }), async calls => {
      for (const workflow of ["redeem", "discord-monitor", "refresh-token"] as const) {
        const result = await fetchWorkflowRuns(workflow) as { workflow_runs: Array<{ id: number }> };
        assert.equal(result.workflow_runs[0]!.id, 33);
        const repeat = await fetchWorkflowRuns(workflow) as { workflow_runs: Array<{ id: number }> };
        assert.equal(repeat.workflow_runs[0]!.id, 33);
      }

      assert.equal(calls.length, 3, "one HTTP request per approved workflow; hot reads make none");
      for (const [index, workflow] of ["redeem", "discord-monitor", "refresh-token"].entries()) {
        assert.equal(
          calls[index]!.url,
          `https://api.github.com/repos/Jamula/stfc/actions/workflows/${workflow}.yml/runs?per_page=20`,
        );
      }
    });
  });

  it("revalidates an expired cache entry with If-None-Match and serves the 304 cached body", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      await withMockFetch((url, init) => {
        if (new Headers(init.headers).get("if-none-match") === '"runs-v1"') {
          return new Response(null, { status: 304 });
        }
        return jsonResponse(200, { workflow_runs: [{ id: 44, event: "schedule" }] }, { etag: '"runs-v1"' });
      }, async calls => {
        const first = await fetchWorkflowRuns("redeem") as { workflow_runs: Array<{ id: number }> };
        const hot = await fetchWorkflowRuns("redeem") as { workflow_runs: Array<{ id: number }> };
        assert.equal(first.workflow_runs[0]!.id, 44);
        assert.equal(hot.workflow_runs[0]!.id, 44);
        assert.equal(calls.length, 1, "hot cache should not make a network request");

        now += 60_001;
        const refreshed = await fetchWorkflowRuns("redeem") as { workflow_runs: Array<{ id: number }> };
        assert.equal(refreshed.workflow_runs[0]!.id, 44, "304 must return the cached payload");
        assert.equal(calls.length, 2);
        assert.equal(new Headers(calls[1]!.init.headers).get("if-none-match"), '"runs-v1"');
      });
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects unapproved workflows without HTTP and propagates Actions API errors", async () => {
    await withMockFetch(() => new Response("upstream detail", { status: 502 }), async calls => {
      await assert.rejects(() => fetchWorkflowRuns("untrusted"), /Unsupported dashboard workflow/);
      assert.equal(calls.length, 0);
      await assert.rejects(() => fetchWorkflowRuns("redeem"), /GitHub Actions API 502/);
      assert.equal(calls.length, 1);
    });
  });
});

describe("dashboard data source loading", () => {
  it("reads redemption history from automation-state and crew officers from main", async () => {
    await withMockFetch(url => {
      if (url.includes("/docs/redeem-history.md")) {
        return jsonResponse(200, contentsBody("# Redemption history\n- success"));
      }
      if (url.includes("/data/crew/officers.json")) {
        return jsonResponse(200, contentsBody('[{"name":"Officer One"}]'));
      }
      return new Response(null, { status: 404 });
    }, async calls => {
      const redeems = await loadDashboard("redeems", { workflow: null, limit: 20 });
      const crew = await loadDashboard("crew", { workflow: null, limit: 20 });
      assert.equal(redeems.documents[0]!.path, "docs/redeem-history.md");
      assert.equal(redeems.documents[0]!.ref, "automation-state");
      assert.equal(redeems.documents[0]!.content, "# Redemption history\n- success");
      assert.equal(crew.documents[0]!.path, "data/crew/officers.json");
      assert.equal(crew.documents[0]!.ref, "main");
      assert.deepEqual(JSON.parse(crew.documents[0]!.content), [{ name: "Officer One" }]);
      assert.deepEqual(calls.map(call => call.url), [
        "https://api.github.com/repos/Jamula/stfc/contents/docs/redeem-history.md?ref=automation-state",
        "https://api.github.com/repos/Jamula/stfc/contents/data/crew/officers.json?ref=main",
      ]);
    });
  });

  it("selects only the newest 20 dated digests from automation-state and represents an empty directory", async () => {
    let directoryRead = 0;
    const entries = Array.from({ length: 23 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return directoryEntry(`2026-10-${day}.md`, `data/digests/2026-10-${day}.md`);
    });
    await withMockFetch(url => {
      if (url.includes("/contents/data/digests?")) {
        directoryRead++;
        return jsonResponse(200, directoryRead === 1 ? entries : []);
      }
      if (url.includes("/contents/data/digests/")) {
        const name = url.split("/").at(-1)?.split("?")[0] ?? "unknown";
        return jsonResponse(200, contentsBody(`Digest ${name}`));
      }
      return new Response(null, { status: 404 });
    }, async calls => {
      const digests = await loadDashboard("digests", { workflow: null, limit: 20 });
      assert.equal(digests.documents.length, 20);
      assert.equal(digests.documents[0]!.path, "data/digests/2026-10-23.md");
      assert.equal(digests.documents[19]!.path, "data/digests/2026-10-04.md");
      assert.ok(digests.documents.every(document => document.ref === "automation-state"));
      assert.equal(calls[0]!.url, "https://api.github.com/repos/Jamula/stfc/contents/data/digests?ref=automation-state");

      _clearCache();
      const emptyDirectory = await loadDashboard("digests", { workflow: null, limit: 20 });
      assert.equal(emptyDirectory.available, true);
      assert.equal(emptyDirectory.documents.length, 0, "an empty committed directory is distinct from a missing source");
    });
  });

  it("marks missing digest source and telemetry unavailable without inventing data", async () => {
    await withMockFetch(() => new Response(null, { status: 404 }), async calls => {
      const missingDigests = await loadDashboard("digests", { workflow: null, limit: 20 });
      assert.equal(missingDigests.available, false);
      assert.match(missingDigests.message ?? "", /automation-state/);
      assert.deepEqual(missingDigests.documents, []);

      const beforeTelemetry = calls.length;
      const telemetry = await loadDashboard("telemetry", { workflow: null, limit: 20 });
      assert.equal(telemetry.available, false);
      assert.match(telemetry.message ?? "", /no approved telemetry artifact producer/);
      assert.deepEqual(telemetry.documents, []);
      assert.equal(calls.length, beforeTelemetry, "telemetry unavailable state must not call an upstream");
    });
  });

  it("rejects malformed crew JSON and malformed committed run artifacts", async () => {
    await withMockFetch(url => {
      if (url.includes("/data/crew/officers.json")) return jsonResponse(200, contentsBody("{bad-json"));
      if (url.endsWith("/contents/data/runs?ref=main")) {
        return jsonResponse(200, [directoryEntry("broken.json", "data/runs/broken.json")]);
      }
      if (url.includes("/contents/data/runs/broken.json")) return jsonResponse(200, contentsBody('{"schema_version":"2"}'));
      if (url.includes("/actions/workflows/")) return jsonResponse(200, { workflow_runs: [] });
      return new Response(null, { status: 404 });
    }, async () => {
      await assert.rejects(
        () => loadDashboard("crew", { workflow: null, limit: 20 }),
        SyntaxError,
      );
      await assert.rejects(
        () => loadDashboard("runs", { workflow: null, limit: 20 }),
        /Invalid run artifact/,
      );
    });
  });

  it("filters Actions requests by workflow, applies the requested limit, and retains cron no-op runs", async () => {
    await withMockFetch(url => {
      if (url.endsWith("/contents/data/runs?ref=main")) return new Response(null, { status: 404 });
      if (url.endsWith("/actions/workflows/redeem.yml/runs?per_page=20")) {
        return jsonResponse(200, {
          workflow_runs: [
            actionsItem(111, {
              event: "schedule",
              conclusion: null,
              display_title: "Scheduled maintenance",
              created_at: "2026-10-30T12:00:00Z",
            }),
            actionsItem(110, {
              event: "workflow_dispatch",
              display_title: "Manual run correlation_id=correlation-110",
              created_at: "2026-10-29T12:00:00Z",
            }),
          ],
        });
      }
      return new Response("unexpected upstream path", { status: 500 });
    }, async calls => {
      const data = await loadDashboard("runs", { workflow: "redeem", limit: 1 });
      assert.equal(data.runs.length, 1);
      assert.equal(data.runs[0]!.correlation_id, null, "scheduled no-op rows stay visible without an invented correlation");
      assert.equal(data.runs[0]!.workflow, "redeem");
      assert.equal(data.runs[0]!.trigger, "schedule");
      assert.equal(data.runs[0]!.conclusion, null);
      assert.equal(data.runs[0]!.business_result, null);
      assert.equal(calls.filter(call => call.url.includes("/actions/workflows/")).length, 1);
      const workflowRequest = calls.find(call => call.url.includes("/actions/workflows/"));
      assert.ok(workflowRequest, "expected a request for the redeem workflow runs");
      const workflowUrl = new URL(workflowRequest.url);
      assert.ok(workflowUrl.pathname.endsWith("/actions/workflows/redeem.yml/runs"));
      assert.equal(workflowUrl.searchParams.get("per_page"), "20");
    });
  });
});

describe("dashboard HTTP handler and deployment entrypoint", () => {
  it("serves each contracted GET tab through the authenticated handler", async () => {
    const previousAllowlist = process.env["STFC_ALLOWED_USERS"];
    process.env["STFC_ALLOWED_USERS"] = "dashboard-user";
    try {
      await withMockFetch(url => {
        if (url.includes("/docs/redeem-history.md")) return jsonResponse(200, contentsBody("# history"));
        if (url.includes("/data/crew/officers.json")) return jsonResponse(200, contentsBody("[]"));
        if (url.endsWith("/contents/data/digests?ref=automation-state")) return jsonResponse(200, []);
        if (url.endsWith("/contents/data/runs?ref=main")) return new Response(null, { status: 404 });
        if (url.includes("/actions/workflows/")) return jsonResponse(200, { workflow_runs: [] });
        return new Response(null, { status: 404 });
      }, async () => {
        const tabs = ["redeems", "digests", "telemetry", "crew", "runs"] as const;
        const responses = await Promise.all(tabs.map(tab =>
          handler(makeRequest(tab), makeContext()),
        ));
        assert.deepEqual(responses.map(response => response.status), [200, 200, 200, 200, 200]);
        assert.equal((responses[0]!.jsonBody as DashboardData).documents[0]!.content, "# history");
        assert.equal((responses[1]!.jsonBody as DashboardData).documents.length, 0);
        assert.equal((responses[2]!.jsonBody as DashboardData).available, false);
        assert.deepEqual((responses[3]!.jsonBody as DashboardData).documents, [{
          path: "data/crew/officers.json",
          ref: "main",
          content: "[]",
        }]);
        assert.deepEqual((responses[4]!.jsonBody as DashboardData).runs, []);
      });
    } finally {
      if (previousAllowlist === undefined) delete process.env["STFC_ALLOWED_USERS"];
      else process.env["STFC_ALLOWED_USERS"] = previousAllowlist;
    }
  });

  it("returns 401/403 before upstream access and returns 200 for an allowlisted operator", async () => {
    const previousAllowlist = process.env["STFC_ALLOWED_USERS"];
    process.env["STFC_ALLOWED_USERS"] = "dashboard-user";
    try {
      await withMockFetch(url => {
        if (url.includes("/data/crew/officers.json")) return jsonResponse(200, contentsBody("[]"));
        return new Response(null, { status: 404 });
      }, async calls => {
        const unauthenticated = await handler(
          makeRequest("crew", { principal: null }),
          makeContext(),
        );
        assert.equal(unauthenticated.status, 401);
        assert.equal(calls.length, 0, "unauthenticated request must not read upstream data");

        const blockedPrincipal = { ...VALID_PRINCIPAL, userDetails: "not-allowed" };
        const blocked = await handler(
          makeRequest("crew", { principal: blockedPrincipal }),
          makeContext(),
        );
        assert.equal(blocked.status, 403);
        assert.equal(calls.length, 0, "allowlist denial must happen before upstream access");

        const missingRole = {
          ...VALID_PRINCIPAL,
          userRoles: ["authenticated"],
        };
        const forbiddenRole = await handler(
          makeRequest("crew", { principal: missingRole }),
          makeContext(),
        );
        assert.equal(forbiddenRole.status, 403);
        assert.equal(calls.length, 0, "role denial must happen before upstream access");

        const allowed = await handler(makeRequest("crew"), makeContext());
        assert.equal(allowed.status, 200);
        assert.equal((allowed.jsonBody as DashboardData).documents[0]!.content, "[]");
        assert.equal(calls.length, 1, "authorized operator reaches the approved source");
      });
    } finally {
      if (previousAllowlist === undefined) delete process.env["STFC_ALLOWED_USERS"];
      else process.env["STFC_ALLOWED_USERS"] = previousAllowlist;
    }
  });

  it("rejects unknown tabs and invalid queries before upstream access", async () => {
    const previousAllowlist = process.env["STFC_ALLOWED_USERS"];
    process.env["STFC_ALLOWED_USERS"] = "dashboard-user";
    try {
      await withMockFetch(() => new Response(null, { status: 404 }), async calls => {
        assert.equal((await handler(makeRequest("private-store"), makeContext())).status, 404);
        assert.equal((await handler(makeRequest("runs", { query: "?workflow=unknown" }), makeContext())).status, 400);
        assert.equal((await handler(makeRequest("runs", { query: "?limit=101" }), makeContext())).status, 400);
        assert.equal(calls.length, 0);
      });
    } finally {
      if (previousAllowlist === undefined) delete process.env["STFC_ALLOWED_USERS"];
      else process.env["STFC_ALLOWED_USERS"] = previousAllowlist;
    }
  });

  it("returns a generic 500 for malformed upstream content without exposing its body", async () => {
    const previousAllowlist = process.env["STFC_ALLOWED_USERS"];
    process.env["STFC_ALLOWED_USERS"] = "dashboard-user";
    try {
      await withMockFetch(() => jsonResponse(200, contentsBody("malformed private upstream payload")), async () => {
        const log: unknown[][] = [];
        const response = await handler(makeRequest("crew"), makeContext(log));
        assert.equal(response.status, 500);
        assert.deepEqual(JSON.parse(String(response.body)), { error: "Internal server error" });
        assert.ok(!String(response.body).includes("malformed private upstream payload"));
        assert.deepEqual(log, [["Dashboard read failed", "SyntaxError"]]);
      });
    } finally {
      if (previousAllowlist === undefined) delete process.env["STFC_ALLOWED_USERS"];
      else process.env["STFC_ALLOWED_USERS"] = previousAllowlist;
    }
  });

  it("declares the GET data route and points the Functions package entrypoint at its compiled main", async () => {
    const repo = resolve(import.meta.dirname, "..");
    const packageJson = JSON.parse(await readFile(resolve(repo, "api/package.json"), "utf8")) as { main: string };
    const tsconfig = JSON.parse(await readFile(resolve(repo, "api/tsconfig.json"), "utf8")) as {
      compilerOptions: { outDir: string; rootDir: string };
    };
    const entrypoint = await readFile(resolve(repo, "api/src/index.ts"), "utf8");
    const route = await readFile(resolve(repo, "api/src/data/index.ts"), "utf8");

    assert.equal(packageJson.main, "dist/api/src/index.js");
    assert.equal(tsconfig.compilerOptions.outDir, "dist");
    assert.equal(tsconfig.compilerOptions.rootDir, "..");
    assert.match(entrypoint, /import\s+['"]\.\/data\/index\.js['"]/);
    assert.match(route, /app\.http\(\s*['"]dashboard-data['"]/);
    assert.match(route, /methods:\s*\[\s*['"]GET['"]\s*\]/);
    assert.match(route, /authLevel:\s*['"]anonymous['"]/);
    assert.match(route, /route:\s*['"]data\/\{tab\}['"]/);
    assert.match(route, /handler\s*,?\s*\}/);
  });
});

describe("dashboard browser client validation", () => {
  it("uses same-origin JSON requests and rejects malformed run elements", async () => {
    await withMockFetch(() => jsonResponse(200, {
      available: true,
      message: null,
      documents: [],
      runs: [{
        correlation_id: "bad-run",
        workflow: "redeem",
        actor: "alice",
        trigger: "workflow_dispatch",
        started_at: null,
        conclusion: "success",
        status: "completed",
        run_id: 700,
        business_result: null,
      }],
    }), async calls => {
      await assert.rejects(
        () => loadDashboardClient("runs"),
        /Invalid dashboard response/,
      );
      assert.equal(calls[0]!.url, "/api/data/runs");
      assert.equal(calls[0]!.init.credentials, "same-origin");
      assert.equal(new Headers(calls[0]!.init.headers).get("accept"), "application/json");
    });
  });
});

describe("dashboard tab browser rendering", () => {
  it("loads all five real tabs, escapes HTML, handles empty/unavailable/error states, and marks unmatched runs", async (t) => {
    const [{ createServer }, { chromium }] = await Promise.all([
      import("../web/node_modules/vite/dist/node/index.js"),
      import("playwright"),
    ]);
    const webRoot = resolve(import.meta.dirname, "../web");
    const server = await createServer({
      configFile: resolve(webRoot, "vite.config.ts"),
      root: webRoot,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await server.listen();
      const address = server.httpServer?.address();
      assert.ok(address && typeof address === "object", "Vite must bind a loopback HTTP server");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      try {
        browser = await chromium.launch({ headless: true });
      } catch (error) {
        if (
          error instanceof Error &&
          /Executable doesn't exist at .+/.test(error.message)
        ) {
          t.skip("Chromium executable not installed");
          return;
        }
        throw error;
      }

      const page = await browser.newPage();
      const requests: string[] = [];

      await page.route("**/*", route => {
        if (new URL(route.request().url()).origin !== baseUrl) return route.abort();
        return route.continue();
      });
      await page.route("**/api/data/*", async route => {
        const url = new URL(route.request().url());
        const tab = url.pathname.split("/").at(-1) as DashboardTab;
        requests.push(tab);
        assert.equal(route.request().headers().accept, "application/json");
        const body: DashboardData = {
          available: true,
          message: null,
          documents: [],
          runs: [],
        };
        if (tab === "redeems") {
          body.documents = [{
            path: "docs/redeem-history.md",
            ref: "automation-state",
            content: '<img src=x onerror="window.dashboardPwned=true">literal markdown',
          }];
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        } else if (tab === "digests") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        } else if (tab === "telemetry") {
          body.available = false;
          body.message = "Telemetry is unavailable: no approved telemetry artifact producer is configured.";
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        } else if (tab === "crew") {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: '<!doctype html><script>window.dashboardPwned=true</script>sign-in page',
          });
        } else {
          body.runs = [{
            correlation_id: null,
            workflow: "redeem",
            actor: "schedule",
            trigger: "schedule",
            created_at: "2026-10-30T12:00:00Z",
            started_at: null,
            conclusion: null,
            status: "queued",
            run_id: 900,
            business_result: null,
          }, {
            correlation_id: null,
            workflow: "redeem",
            actor: "alice",
            trigger: "workflow_dispatch",
            created_at: "2026-10-30T11:59:00Z",
            started_at: null,
            conclusion: "success",
            status: "completed",
            run_id: 901,
            business_result: { claimed: 1, redeemed: 1, infra_errors: [] },
          }];
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        }
      });

      await page.goto(baseUrl);
      const readTabText = (tagName: string) => page.evaluate((tag: string) => {
        const appRoot = document.querySelector("stfc-app")?.shadowRoot;
        const tab = appRoot?.querySelector(tag)?.shadowRoot;
        return tab?.textContent ?? "";
      }, tagName);
      const waitForTabText = async (tagName: string, expected: string) => {
        await page.waitForFunction(({ tag, value }: { tag: string; value: string }) => {
          const tab = document.querySelector("stfc-app")?.shadowRoot?.querySelector(tag)?.shadowRoot;
          return tab?.textContent?.includes(value) ?? false;
        }, { tag: tagName, value: expected });
      };

      await waitForTabText("stfc-redeems-tab", "literal markdown");
      const redeemDom = await page.evaluate(() => {
        const root = document.querySelector("stfc-app")?.shadowRoot
          ?.querySelector("stfc-redeems-tab")?.shadowRoot;
        const pre = root?.querySelector("pre");
        return {
          text: pre?.textContent ?? "",
          imageCount: pre?.querySelectorAll("img").length ?? 0,
          pwned: (window as unknown as { dashboardPwned?: boolean }).dashboardPwned === true,
        };
      });
      assert.equal(redeemDom.text, '<img src=x onerror="window.dashboardPwned=true">literal markdown');
      assert.equal(redeemDom.imageCount, 0, "document content must remain escaped text, not an element");
      assert.equal(redeemDom.pwned, false, "document content must not execute as markup");

      await page.getByRole("tab", { name: "digests" }).click();
      await waitForTabText("stfc-digests-tab", "No digests data available.");
      assert.match(await readTabText("stfc-digests-tab"), /No digests data available\./);

      await page.getByRole("tab", { name: "telemetry" }).click();
      await waitForTabText("stfc-telemetry-tab", "no approved telemetry artifact producer");
      assert.match(await readTabText("stfc-telemetry-tab"), /Telemetry is unavailable/);

      await page.getByRole("tab", { name: "crew" }).click();
      await waitForTabText("stfc-crew-tab", "Expected dashboard JSON.");
      const crewText = await readTabText("stfc-crew-tab");
      assert.match(crewText, /Expected dashboard JSON\./);
      assert.ok(!crewText.includes("sign-in page"));
      assert.equal(await page.evaluate(() => (window as unknown as { dashboardPwned?: boolean }).dashboardPwned === true), false);

      await page.getByRole("tab", { name: "runs" }).click();
      await waitForTabText("stfc-runs-tab", "Not correlated");
      const runText = await readTabText("stfc-runs-tab");
      assert.match(runText, /schedule/);
      assert.match(runText, /Not correlated/);
      assert.match(runText, /Not started/);
      assert.match(runText, /Start time unavailable/);
      assert.equal((await page.locator("stfc-runs-tab table tbody tr").count()), 2);
      assert.match(runText, /Not emitted/);
      assert.deepEqual(requests, ["redeems", "digests", "telemetry", "crew", "runs"]);
    } finally {
      await browser?.close();
      await server.close();
    }
  });
});

after(() => {
  _clearCache();
});
