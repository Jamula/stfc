// State-file I/O for the Discord monitor. One module owns the read/write
// rules for every file in specs/001-discord-monitor/contracts/state-files.contract.md
// so the rest of the pipeline never has to remember:
//   - JSON files are pretty-printed (2-space indent), keys sorted alphabetically
//     at every level, trailing newline (so diffs stay deterministic).
//   - JSONL files are append-only, one JSON object per line; readers collapse
//     duplicates by latest-line-wins (tombstone semantics).
//   - suppression.json is operator-only (we read but NEVER write — that
//     invariant is enforced by the absence of a save*Suppression export).
//   - cooldowns.json is the only skill-written cooldown telemetry file;
//     every write evicts entries with `suppressedUntil < now - 7d`.
//
// Errors are typed (Principle III) so callers can branch deterministically
// instead of inspecting strings.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  CandidateCodeSchema,
  CommandChannelAllowlistSchema,
  CooldownEntrySchema,
  CooldownMapSchema,
  DiscordAllowlistSchema,
  IngestionCursorMapSchema,
  OperatorSuppressionMapSchema,
  TipsSeenLineSchema,
  type CandidateCode,
  type CommandChannelAllowlistEntry,
  type CooldownMap,
  type DiscordAllowlist,
  type IngestionCursorMap,
  type OperatorSuppressionMap,
  type TipsSeenLine,
} from "./schemas.ts";

// ── Default committed paths (callers may override for tests) ────────────────

export const DEFAULT_PATHS = {
  allowlist: "config/discord-allowlist.json",
  commandChannels: "data/discord/command-channels.json",
  cursors: "data/discord/cursors.json",
  candidates: "data/discord/candidates.jsonl",
  tipsSeen: "data/discord/tips-seen.jsonl",
  suppression: "data/discord/suppression.json",
  cooldowns: "data/discord/cooldowns.json",
} as const;

const COOLDOWN_EVICTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ── Typed errors ────────────────────────────────────────────────────────────

export class AllowlistFileError extends Error {
  override readonly name = "AllowlistFileError";
}

export class StateFileError extends Error {
  override readonly name = "StateFileError";
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Deterministic JSON encoder: 2-space indent, keys sorted at every level,
 *  trailing newline. Used for every committed JSON state file (per
 *  state-files.contract.md). */
export function stringifyDeterministic(value: unknown): string {
  return `${JSON.stringify(value, sortReplacer, 2)}\n`;
}

function sortReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const src = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      sorted[k] = src[k];
    }
    return sorted;
  }
  return value;
}

async function readJsonOrUndefined(filePath: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new StateFileError(
      `Could not read ${filePath}: ${(err as Error).message}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new StateFileError(
      `Malformed JSON in ${filePath}: ${(err as Error).message}`,
    );
  }
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function readJsonlLines(filePath: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new StateFileError(
      `Could not read ${filePath}: ${(err as Error).message}`,
    );
  }
  const out: unknown[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new StateFileError(
        `Malformed JSONL line ${i + 1} in ${filePath}: ${(err as Error).message}`,
      );
    }
  }
  return out;
}

async function appendJsonlLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

// ── Allowlist (read-only) ───────────────────────────────────────────────────

export async function loadAllowlist(
  filePath: string = DEFAULT_PATHS.allowlist,
): Promise<DiscordAllowlist> {
  let raw: unknown;
  try {
    raw = await readJsonOrUndefined(filePath);
  } catch (err) {
    // Re-classify generic state errors as allowlist-specific so callers can
    // branch on the more precise type (the allowlist is a hard requirement
    // per FR-001 — a malformed file should fail fast).
    throw new AllowlistFileError(
      err instanceof Error ? err.message : String(err),
    );
  }
  if (raw === undefined) {
    throw new AllowlistFileError(
      `Allowlist file missing: ${filePath} — expected committed default { "version": 1, "entries": [] }`,
    );
  }
  const parsed = DiscordAllowlistSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AllowlistFileError(
      `Allowlist file ${filePath} failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function loadCommandChannelAllowlist(
  filePath: string = DEFAULT_PATHS.commandChannels,
): Promise<CommandChannelAllowlistEntry[]> {
  const raw = await readJsonOrUndefined(filePath);
  if (raw === undefined) return [];
  const parsed = CommandChannelAllowlistSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StateFileError(
      `Command-channel allowlist ${filePath} failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ── Cursors ─────────────────────────────────────────────────────────────────

export async function loadCursors(
  filePath: string = DEFAULT_PATHS.cursors,
): Promise<IngestionCursorMap> {
  const raw = await readJsonOrUndefined(filePath);
  if (raw === undefined) return {};
  const parsed = IngestionCursorMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StateFileError(
      `Cursors file ${filePath} failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function saveCursors(
  map: IngestionCursorMap,
  filePath: string = DEFAULT_PATHS.cursors,
): Promise<void> {
  const parsed = IngestionCursorMapSchema.safeParse(map);
  if (!parsed.success) {
    throw new StateFileError(
      `Refusing to write cursors: ${parsed.error.message}`,
    );
  }
  await writeFileAtomic(filePath, stringifyDeterministic(parsed.data));
}

// ── Candidates (append-only JSONL with latest-line-wins semantics) ──────────

export async function appendCandidate(
  entry: CandidateCode,
  filePath: string = DEFAULT_PATHS.candidates,
): Promise<void> {
  const parsed = CandidateCodeSchema.safeParse(entry);
  if (!parsed.success) {
    throw new StateFileError(
      `Refusing to append candidate: ${parsed.error.message}`,
    );
  }
  await appendJsonlLine(filePath, parsed.data);
}

export async function readCandidates(
  filePath: string = DEFAULT_PATHS.candidates,
): Promise<Map<string, CandidateCode>> {
  const lines = await readJsonlLines(filePath);
  const out = new Map<string, CandidateCode>();
  for (let i = 0; i < lines.length; i++) {
    const parsed = CandidateCodeSchema.safeParse(lines[i]);
    if (!parsed.success) {
      throw new StateFileError(
        `Candidate line ${i + 1} in ${filePath} failed schema validation: ${parsed.error.message}`,
      );
    }
    out.set(parsed.data.value, parsed.data);
  }
  return out;
}

// ── Tips-seen (append-only JSONL with latest-line-wins semantics) ───────────

export async function appendTipSeen(
  entry: TipsSeenLine,
  filePath: string = DEFAULT_PATHS.tipsSeen,
): Promise<void> {
  const parsed = TipsSeenLineSchema.safeParse(entry);
  if (!parsed.success) {
    throw new StateFileError(
      `Refusing to append tip-seen: ${parsed.error.message}`,
    );
  }
  await appendJsonlLine(filePath, parsed.data);
}

export async function readTipsSeen(
  filePath: string = DEFAULT_PATHS.tipsSeen,
): Promise<Map<string, TipsSeenLine>> {
  const lines = await readJsonlLines(filePath);
  const out = new Map<string, TipsSeenLine>();
  for (let i = 0; i < lines.length; i++) {
    const parsed = TipsSeenLineSchema.safeParse(lines[i]);
    if (!parsed.success) {
      throw new StateFileError(
        `Tips-seen line ${i + 1} in ${filePath} failed schema validation: ${parsed.error.message}`,
      );
    }
    out.set(parsed.data.contentHash, parsed.data);
  }
  return out;
}

// ── Suppression (READ-ONLY — operator-curated, cross-file invariant #4) ─────
//
// Intentionally NO saveSuppression / writeSuppression export. The operator
// curates this file manually via reviewed PR; feature code that mutates it
// would violate state-files.contract.md.

export async function loadSuppression(
  filePath: string = DEFAULT_PATHS.suppression,
): Promise<OperatorSuppressionMap> {
  const raw = await readJsonOrUndefined(filePath);
  if (raw === undefined) return {};
  const parsed = OperatorSuppressionMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StateFileError(
      `Suppression file ${filePath} failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ── Cooldowns ───────────────────────────────────────────────────────────────

export async function loadCooldowns(
  filePath: string = DEFAULT_PATHS.cooldowns,
): Promise<CooldownMap> {
  const raw = await readJsonOrUndefined(filePath);
  if (raw === undefined) return {};
  const parsed = CooldownMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StateFileError(
      `Cooldowns file ${filePath} failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * Save cooldowns telemetry. Validates each entry, evicts any whose
 * `suppressedUntil` is older than `now - 7 days` (per state-files.contract.md
 * § cooldowns), then writes deterministically.
 *
 * `now` is injected so tests stay deterministic.
 */
export async function saveCooldowns(
  map: CooldownMap,
  now: Date,
  filePath: string = DEFAULT_PATHS.cooldowns,
): Promise<void> {
  const validated: CooldownMap = {};
  for (const [code, entry] of Object.entries(map)) {
    const parsed = CooldownEntrySchema.safeParse(entry);
    if (!parsed.success) {
      throw new StateFileError(
        `Refusing to write cooldowns: entry "${code}" failed schema validation: ${parsed.error.message}`,
      );
    }
    validated[code] = parsed.data;
  }

  const evictionCutoff = now.getTime() - COOLDOWN_EVICTION_WINDOW_MS;
  const kept: CooldownMap = {};
  for (const [code, entry] of Object.entries(validated)) {
    const suppressedUntilMs = Date.parse(entry.suppressedUntil);
    if (Number.isNaN(suppressedUntilMs)) {
      throw new StateFileError(
        `Cooldown entry "${code}" has unparseable suppressedUntil: ${entry.suppressedUntil}`,
      );
    }
    if (suppressedUntilMs < evictionCutoff) continue;
    kept[code] = entry;
  }

  await writeFileAtomic(filePath, stringifyDeterministic(kept));
}
