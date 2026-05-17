// Tuvok telemetry reporter — reads sessions.jsonl and generates
// summary reports in data/telemetry/reports/YYYY-MM-DD.md.

import { promises as fs } from "node:fs";
import { createLogger } from "../lib/logger.ts";
import {
  TelemetryRecordSchema,
  type TelemetryRecord,
  type TelemetrySummary,
  type ModelSummary,
  type AgentSummary,
  type CategorySummary,
  type OutcomeSummary,
} from "./schemas.ts";

const log = createLogger("telemetry/reporter");

const DEFAULT_DATA_DIR = "data/telemetry";

export interface ReportOptions {
  dataDir?: string;
}

export interface ReportResult {
  reportPath: string | null;
  totalSessions: number;
}

/** Load and parse all telemetry records from sessions.jsonl. */
export async function loadRecords(dataDir: string): Promise<TelemetryRecord[]> {
  const filePath = `${dataDir}/sessions.jsonl`;
  const records: TelemetryRecord[] = [];

  try {
    const content = await fs.readFile(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = TelemetryRecordSchema.parse(JSON.parse(trimmed));
        records.push(parsed);
      } catch {
        log.warn(`skipping malformed record in ${filePath}`);
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return records;
}

/** Aggregate records into a TelemetrySummary. */
export function aggregateRecords(records: TelemetryRecord[]): TelemetrySummary {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  if (records.length === 0) {
    return {
      generatedAt: now,
      periodStart: now,
      periodEnd: now,
      totalSessions: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byModel: [],
      byAgent: [],
      byCategory: [],
      byOutcome: [],
    };
  }

  const sorted = [...records].sort(
    (a, b) => new Date(a.sessionStartedAt).getTime() - new Date(b.sessionStartedAt).getTime(),
  );

  const totalInput = records.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = records.reduce((s, r) => s + r.outputTokens, 0);

  // By model
  const modelMap = new Map<string, { tier: string; sessions: TelemetryRecord[] }>();
  for (const r of records) {
    for (const mb of r.modelBreakdown) {
      const key = mb.model;
      const existing = modelMap.get(key);
      if (existing) {
        existing.sessions.push(r);
      } else {
        modelMap.set(key, { tier: mb.tier, sessions: [r] });
      }
    }
  }

  const byModel: ModelSummary[] = Array.from(modelMap.entries()).map(([model, data]) => {
    // Deduplicate sessions for this model
    const uniqueSessions = [...new Set(data.sessions.map((s) => s.sessionHash))];
    const sessionRecords = uniqueSessions.map(
      (hash) => records.find((r) => r.sessionHash === hash)!,
    );
    const modelInput = sessionRecords.reduce((s, r) => {
      const mb = r.modelBreakdown.find((m) => m.model === model);
      return s + (mb?.inputTokens ?? 0);
    }, 0);
    const modelOutput = sessionRecords.reduce((s, r) => {
      const mb = r.modelBreakdown.find((m) => m.model === model);
      return s + (mb?.outputTokens ?? 0);
    }, 0);
    const avgDuration = sessionRecords.reduce((s, r) => s + r.durationSeconds, 0) / sessionRecords.length;
    const successCount = sessionRecords.filter((r) => r.outcome === "success").length;

    return {
      model,
      tier: data.tier,
      sessionCount: uniqueSessions.length,
      inputTokens: modelInput,
      outputTokens: modelOutput,
      avgDurationSeconds: Math.round(avgDuration),
      successRate: uniqueSessions.length > 0 ? successCount / uniqueSessions.length : 0,
    };
  });

  // By agent
  const agentMap = new Map<string, TelemetryRecord[]>();
  for (const r of records) {
    const existing = agentMap.get(r.agentName);
    if (existing) existing.push(r);
    else agentMap.set(r.agentName, [r]);
  }

  const byAgent: AgentSummary[] = Array.from(agentMap.entries()).map(([agentName, sessions]) => {
    const input = sessions.reduce((s, r) => s + r.inputTokens, 0);
    const output = sessions.reduce((s, r) => s + r.outputTokens, 0);
    const totalTokens = input + output;
    const avgDuration = sessions.reduce((s, r) => s + r.durationSeconds, 0) / sessions.length;

    return {
      agentName,
      sessionCount: sessions.length,
      inputTokens: input,
      outputTokens: output,
      avgTokensPerSession: Math.round(totalTokens / sessions.length),
      avgDurationSeconds: Math.round(avgDuration),
    };
  });

  // By category
  const catMap = new Map<string, TelemetryRecord[]>();
  for (const r of records) {
    const existing = catMap.get(r.taskCategory);
    if (existing) existing.push(r);
    else catMap.set(r.taskCategory, [r]);
  }

  const byCategory: CategorySummary[] = Array.from(catMap.entries()).map(([category, sessions]) => {
    const input = sessions.reduce((s, r) => s + r.inputTokens, 0);
    const output = sessions.reduce((s, r) => s + r.outputTokens, 0);
    const successCount = sessions.filter((r) => r.outcome === "success").length;

    return {
      category,
      sessionCount: sessions.length,
      inputTokens: input,
      outputTokens: output,
      successRate: sessions.length > 0 ? successCount / sessions.length : 0,
    };
  });

  // By outcome
  const outcomeMap = new Map<string, number>();
  for (const r of records) {
    outcomeMap.set(r.outcome, (outcomeMap.get(r.outcome) ?? 0) + 1);
  }

  const byOutcome: OutcomeSummary[] = Array.from(outcomeMap.entries()).map(([outcome, count]) => ({
    outcome,
    sessionCount: count,
    percentage: count / records.length,
  }));

  return {
    generatedAt: now,
    periodStart: sorted[0]!.sessionStartedAt,
    periodEnd: sorted[sorted.length - 1]!.sessionStartedAt,
    totalSessions: records.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    byModel,
    byAgent,
    byCategory,
    byOutcome,
  };
}

/** Render a TelemetrySummary to Markdown. */
export function renderReport(summary: TelemetrySummary, recommendationsMarkdown?: string): string {
  const date = summary.generatedAt.split("T")[0]!;
  const lines: string[] = [];

  lines.push(`# Telemetry Report — ${date}`);
  lines.push("");
  lines.push(`**Generated**: ${summary.generatedAt}  `);
  lines.push(`**Period**: ${summary.periodStart.split("T")[0]} to ${summary.periodEnd.split("T")[0]}  `);
  lines.push(`**Sessions**: ${summary.totalSessions}`);

  if (summary.totalSessions === 0) {
    lines.push("");
    lines.push("*No data collected.*");
    return lines.join("\n") + "\n";
  }

  // Token Usage by Model
  lines.push("");
  lines.push("## Token Usage by Model");
  lines.push("");
  lines.push("| Model | Tier | Sessions | Input Tokens | Output Tokens | Avg Duration |");
  lines.push("|-------|------|----------|--------------|---------------|--------------|");
  for (const m of summary.byModel) {
    lines.push(
      `| ${m.model} | ${m.tier} | ${m.sessionCount} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${formatDuration(m.avgDurationSeconds)} |`,
    );
  }

  // Token Usage by Agent
  lines.push("");
  lines.push("## Token Usage by Agent");
  lines.push("");
  lines.push("| Agent | Sessions | Avg Tokens/Session | Avg Duration |");
  lines.push("|-------|----------|-------------------|--------------|");
  for (const a of summary.byAgent) {
    lines.push(
      `| ${a.agentName} | ${a.sessionCount} | ${a.avgTokensPerSession.toLocaleString()} | ${formatDuration(a.avgDurationSeconds)} |`,
    );
  }

  // Outcome Summary
  lines.push("");
  lines.push("## Outcome Summary");
  lines.push("");
  lines.push("| Outcome | Sessions | Percentage |");
  lines.push("|---------|----------|------------|");
  for (const o of summary.byOutcome) {
    lines.push(
      `| ${o.outcome} | ${o.sessionCount} | ${(o.percentage * 100).toFixed(1)}% |`,
    );
  }

  // Recommendations section
  if (recommendationsMarkdown) {
    lines.push("");
    lines.push(recommendationsMarkdown);
  }

  return lines.join("\n") + "\n";
}

/** Generate a report from sessions.jsonl data. */
export async function generateReport(opts: ReportOptions = {}): Promise<ReportResult> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const records = await loadRecords(dataDir);
  const summary = aggregateRecords(records);
  const markdown = renderReport(summary);

  const date = summary.generatedAt.split("T")[0]!;
  const reportPath = `${dataDir}/reports/${date}.md`;

  await fs.mkdir(`${dataDir}/reports`, { recursive: true });
  await fs.writeFile(reportPath, markdown, "utf-8");

  log.info(`report written to ${reportPath} (${records.length} sessions)`);

  return { reportPath, totalSessions: records.length };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
