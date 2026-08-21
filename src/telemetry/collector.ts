// Tuvok telemetry collector — queries cloud session store for usage events,
// writes structured records to data/telemetry/sessions.jsonl.
//
// Privacy: NO user_content/assistant_content is ever queried (FR-009).
// Session IDs are SHA-256 hashed before storage (FR-010).

import { promises as fs } from "node:fs";
import * as crypto from "node:crypto";
import { createLogger } from "../lib/logger.ts";
import {
  TelemetryRecordSchema,
  CollectionLogSchema,
  type TelemetryRecord,
  type ModelUsage,
  type CollectionLog,
  type ModelTierMap,
} from "./schemas.ts";
import { resolveTier } from "./tiers.ts";

const log = createLogger("telemetry/collector");

// ── Public pure helpers (exported for testing) ──────────────────────────────

/** SHA-256 hash of session ID, truncated to 16 hex chars. */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

/** Derive task category from session summary via keyword matching (R-005). */
export function deriveTaskCategory(summary: string | null | undefined): string {
  if (!summary) return "uncategorized";
  const s = summary.toLowerCase();

  if (s.includes("planning")) return "planning";
  if (s.includes("specification")) return "specification";
  if (s.includes("task-generation") || s.includes("task generation") || s.includes("tasks")) {
    return "task-generation";
  }
  if (s.includes("implement") || s.includes("build") || s.includes("create") || s.includes("add")) return "implementation";
  if (s.includes("review") || s.includes("code-review")) return "review";
  if (s.includes("test") || s.includes("spec")) return "testing";
  if (s.includes("fix") || s.includes("bug") || s.includes("debug")) return "bugfix";
  if (s.includes("refactor") || s.includes("cleanup")) return "refactoring";
  if (s.includes("docs") || s.includes("document")) return "documentation";

  return "uncategorized";
}

interface SessionRef {
  ref_type: string;
  ref_value: string;
}

/** Derive outcome heuristically from session refs and duration (R-006). */
export function deriveOutcome(
  refs: SessionRef[],
  durationSeconds: number,
): "success" | "completed" | "partial" {
  const hasCommitOrPr = refs.some(
    (r) => r.ref_type === "commit" || r.ref_type === "pr",
  );
  if (hasCommitOrPr) return "success";
  if (durationSeconds < 60) return "partial";
  return "completed";
}

interface RawSession {
  id: string;
  agent_name: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface RawUsageEvent {
  usage_model: string | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  usage_cache_read_tokens: number | null;
}

/** Build a TelemetryRecord from raw session data. */
export function buildTelemetryRecord(
  session: RawSession,
  usageEvents: RawUsageEvent[],
  refs: SessionRef[],
  tierMap: ModelTierMap,
): TelemetryRecord {
  const sessionHash = hashSessionId(session.id);
  const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // Normalize timestamps
  const startedAt = normalizeTimestamp(session.created_at);
  const endedAt = normalizeTimestamp(session.updated_at);
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );

  // Aggregate tokens
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;

  // Group by model for breakdown
  const modelMap = new Map<string, { input: number; output: number; count: number }>();

  for (const evt of usageEvents) {
    const input = Math.max(0, Math.round(evt.usage_input_tokens ?? 0));
    const output = Math.max(0, Math.round(evt.usage_output_tokens ?? 0));
    const cache = Math.max(0, Math.round(evt.usage_cache_read_tokens ?? 0));
    totalInput += input;
    totalOutput += output;
    totalCacheRead += cache;

    const model = evt.usage_model ?? "unknown";
    const existing = modelMap.get(model);
    if (existing) {
      existing.input += input;
      existing.output += output;
      existing.count += 1;
    } else {
      modelMap.set(model, { input, output, count: 1 });
    }
  }

  const modelBreakdown: ModelUsage[] = Array.from(modelMap.entries()).map(
    ([model, data]) => ({
      model,
      tier: resolveTier(tierMap, model),
      inputTokens: data.input,
      outputTokens: data.output,
      callCount: data.count,
    }),
  );

  // Ensure at least one entry in modelBreakdown
  if (modelBreakdown.length === 0) {
    modelBreakdown.push({
      model: "unknown",
      tier: tierMap.defaultTier,
      inputTokens: 0,
      outputTokens: 0,
      callCount: 0,
    });
  }

  const outcome = deriveOutcome(refs, durationSeconds);
  const taskCategory = deriveTaskCategory(session.summary);
  const status: "complete" | "partial" = outcome === "partial" ? "partial" : "complete";

  return {
    sessionHash,
    collectedAt,
    sessionStartedAt: startedAt,
    sessionEndedAt: endedAt,
    durationSeconds,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    modelBreakdown,
    agentName: session.agent_name ?? "unknown",
    taskCategory,
    outcome,
    usageEventCount: usageEvents.length,
    status,
  };
}

// ── File I/O ────────────────────────────────────────────────────────────────

/** Load existing sessionHash values from sessions.jsonl for dedup (FR-004). */
export async function loadExistingHashes(filePath: string): Promise<Set<string>> {
  const hashes = new Set<string>();
  try {
    const content = await fs.readFile(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { sessionHash?: string };
        if (obj.sessionHash) hashes.add(obj.sessionHash);
      } catch {
        log.warn(`skipping malformed JSONL line in ${filePath}`);
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // File doesn't exist yet — empty set
  }
  return hashes;
}

/** Append a validated TelemetryRecord to sessions.jsonl. */
export async function appendTelemetryRecord(
  filePath: string,
  record: TelemetryRecord,
): Promise<void> {
  // Validate before writing
  TelemetryRecordSchema.parse(record);
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(filePath, line, "utf-8");
}

/** Append a CollectionLog entry to collection-log.jsonl (FR-012). */
export async function appendCollectionLog(
  filePath: string,
  entry: CollectionLog,
): Promise<void> {
  CollectionLogSchema.parse(entry);
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(filePath, line, "utf-8");
}

// ── Main collection orchestrator ────────────────────────────────────────────

export interface CollectOptions {
  dataDir?: string;
  tierMap: ModelTierMap;
  /** How many days back to look for sessions (default: 7). */
  lookbackDays?: number;
  /** Optional JSONL file path containing session/usage/ref tuples. */
  sessionsFile?: string;
  /** Supply session data directly (for testing / offline mode). */
  sessions?: Array<{
    session: RawSession;
    usageEvents: RawUsageEvent[];
    refs: SessionRef[];
  }>;
}

export interface CollectResult {
  sessionsCollected: number;
  sessionsSkipped: number;
  errors: string[];
}

type CollectSessionInput = NonNullable<CollectOptions["sessions"]>[number];

/**
 * Collect telemetry from provided session data, write to sessions.jsonl.
 * Deduplicates by sessionHash (FR-004).
 */
export async function collectTelemetry(opts: CollectOptions): Promise<CollectResult> {
  const dataDir = opts.dataDir ?? "data/telemetry";
  const sessionsPath = `${dataDir}/sessions.jsonl`;
  const logPath = `${dataDir}/collection-log.jsonl`;

  const startMs = Date.now();
  const existingHashes = await loadExistingHashes(sessionsPath);

  let collected = 0;
  let skipped = 0;
  const errors: string[] = [];

  const fileSessions = opts.sessionsFile
    ? await loadSessionsFromFile(opts.sessionsFile)
    : [];
  const sessions = [...(opts.sessions ?? []), ...fileSessions];

  if (sessions.length === 0) {
    log.warn(
      "no session input provided; export session-store rows to JSONL and pass --sessions-file <path> (or TELEMETRY_SESSIONS_FILE), or provide sessions directly in collectTelemetry()",
    );
  }

  for (const { session, usageEvents, refs } of sessions) {
    try {
      const record = buildTelemetryRecord(session, usageEvents, refs, opts.tierMap);

      if (existingHashes.has(record.sessionHash)) {
        skipped++;
        log.info(`skipping already-collected session ${record.sessionHash}`);
        continue;
      }

      await appendTelemetryRecord(sessionsPath, record);
      existingHashes.add(record.sessionHash);
      collected++;
    } catch (err: unknown) {
      const msg = `failed to process session ${session.id}: ${err instanceof Error ? err.message : String(err)}`;
      log.error(msg);
      errors.push(msg);
    }
  }

  // Write collection log (FR-012)
  const durationMs = Date.now() - startMs;
  const logEntry: CollectionLog = {
    runAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    sessionsProcessed: collected,
    sessionsSkipped: skipped,
    errors,
    durationMs,
  };
  await appendCollectionLog(logPath, logEntry);

  log.info(`collection complete: ${collected} collected, ${skipped} skipped, ${errors.length} errors`);

  return { sessionsCollected: collected, sessionsSkipped: skipped, errors };
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function loadSessionsFromFile(filePath: string): Promise<CollectSessionInput[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const out: CollectSessionInput[] = [];
  for (const [i, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`invalid JSONL in ${filePath} at line ${i + 1}`);
    }
    const row = parsed as Partial<CollectSessionInput>;
    if (
      !row ||
      typeof row !== "object" ||
      !row.session ||
      !Array.isArray(row.usageEvents) ||
      !Array.isArray(row.refs)
    ) {
      throw new Error(
        `invalid session input shape in ${filePath} at line ${i + 1}; expected {session,usageEvents,refs}`,
      );
    }
    out.push(row as CollectSessionInput);
  }
  return out;
}

function normalizeTimestamp(ts: string): string {
  // Ensure ISO 8601 UTC format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(ts)) return ts;
  // Try to parse and re-format
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}
