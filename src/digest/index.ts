// T034 [US2] — Daily digest writer.
//
// Contract: specs/001-discord-monitor/contracts/digest-writer.contract.md
// Data model: specs/001-discord-monitor/data-model.md § 5 (DailyDigest),
//             § 4 (Tip), § 10 (RunHealth)
//
// Invariants:
//   1. Byte-stable on no-change re-run.
//   2. Embedded `DIGEST_STATE_V1` JSON state block is the round-trip source
//      of truth for idempotent merge.
//   3. Forbidden-content guard runs BEFORE every write — JWTs, the literal
//      tokens DISCORD_BOT_TOKEN / STFC_ACCOUNTS, and `"access_token":"…"`
//      bodies are NEVER written.
//   4. Tip excerpts ≤ 600 chars (truncate with `…`, FR-019).
//   5. Tips with category `chatter` or `unclassified` are dropped before
//      rendering (callers' invariant; we enforce it defensively here).
//   6. Same `contentHash` from multiple channels collapses to ONE tip entry
//      with both source[] locations (FR-018).
//
// File path: `${outputDir}/${date}.md` (UTC date at run start, FR-022).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  DailyDigest,
  RunHealth,
  Tip,
  TipCategory,
} from "../discord/schemas.ts";
import { formatPromoScanStatus } from "../discord/scanStatus.ts";
import { writeFileAtomic } from "../lib/atomicFile.ts";

// ── Public surface ─────────────────────────────────────────────────────────

export const DEFAULT_DIGESTS_DIR = "data/digests";

export interface WriteDigestOptions {
  /** Output directory (default: `data/digests`). The file path is
   *  `${outputDir}/${date}.md`. */
  outputDir?: string;
}

export interface DigestWriteResult {
  filePath: string;
  bytesWritten: number;
  mode: "created" | "merged-idempotent";
}

export class DigestForbiddenContentError extends Error {
  override readonly name = "DigestForbiddenContentError";
}

// ── Constants ──────────────────────────────────────────────────────────────

export const MAX_EXCERPT_LEN = 600;
const STATE_BLOCK_OPEN = "<!--\nDIGEST_STATE_V1 (do not edit by hand; re-rendered by the digest writer)";
const STATE_BLOCK_CLOSE = "\n-->";

const TIP_DISPLAY_ORDER: TipCategory[] = [
  "tip", "trick", "hack", "event-info", "patch-note",
];

// Forbidden patterns — scanned over the rendered string before write.
const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // JWT: 3 base64url segments separated by dots; header starts with "eyJ".
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "DISCORD_BOT_TOKEN literal", re: /DISCORD_BOT_TOKEN/ },
  { name: "STFC_ACCOUNTS literal", re: /STFC_ACCOUNTS/ },
  { name: "access_token body", re: /"(?:access_token|refresh_token|id_token|player_token|session_token)"\s*:\s*"[^"]+"/ },
];

// ── Public entry point ─────────────────────────────────────────────────────

export async function writeDigest(
  input: DailyDigest,
  opts: WriteDigestOptions = {},
): Promise<DigestWriteResult> {
  const outputDir = opts.outputDir ?? DEFAULT_DIGESTS_DIR;
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${input.date}.md`);

  // Read prior file (if any) → parse state block.
  const prior = await readPriorState(filePath);
  const mode: DigestWriteResult["mode"] = prior === null ? "created" : "merged-idempotent";
  const unioned = prior === null ? sanitize(input) : merge(prior, sanitize(input));

  // Render.
  const rendered = render(unioned);

  // Forbidden-content guard. Run BEFORE write.
  for (const { name, re } of FORBIDDEN_PATTERNS) {
    if (re.test(rendered)) {
      throw new DigestForbiddenContentError(
        `Refusing to write digest ${filePath}: forbidden pattern detected (${name})`,
      );
    }
  }

  // Byte-compare; skip write if identical.
  let existing: Buffer | null = null;
  try {
    existing = await fs.readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const buf = Buffer.from(rendered, "utf8");
  if (existing && existing.equals(buf)) {
    return { filePath, bytesWritten: 0, mode };
  }

  await writeFileAtomic(filePath, buf);
  return { filePath, bytesWritten: buf.byteLength, mode };
}

// ── Sanitization (drop chatter/unclassified, truncate excerpts) ────────────

function sanitize(input: DailyDigest): DailyDigest {
  const tips: Tip[] = [];
  for (const t of input.tips ?? []) {
    if (t.category === "chatter" || t.category === "unclassified") continue;
    tips.push({ ...t, excerpt: truncate(t.excerpt, MAX_EXCERPT_LEN) });
  }
  // Collapse duplicates by contentHash within this single input.
  return { ...input, tips: collapseTipsByHash(tips) };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function collapseTipsByHash(tips: Tip[]): Tip[] {
  const byHash = new Map<string, Tip>();
  for (const t of tips) {
    const prev = byHash.get(t.contentHash);
    if (!prev) {
      byHash.set(t.contentHash, { ...t, source: [...t.source] });
      continue;
    }
    const seen = new Set(prev.source.map(sourceKey));
    for (const s of t.source) {
      const k = sourceKey(s);
      if (!seen.has(k)) {
        prev.source.push(s);
        seen.add(k);
      }
    }
    // Prefer the higher confidence + the non-chatter category.
    if (t.confidence > prev.confidence) prev.confidence = t.confidence;
  }
  return [...byHash.values()];
}

function sourceKey(s: Tip["source"][number]): string {
  return `${s.channelId}/${s.messageId}`;
}

// ── State block read / merge ───────────────────────────────────────────────

async function readPriorState(filePath: string): Promise<DailyDigest | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseStateBlock(raw);
}

function parseStateBlock(markdown: string): DailyDigest | null {
  const m = /<!--\s*\nDIGEST_STATE_V1\b[^\n]*\n([^\n]+)\n-->/m.exec(markdown);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as DailyDigest;
  } catch {
    return null;
  }
}

function merge(prior: DailyDigest, next: DailyDigest): DailyDigest {
  // Idempotency fast-path: if every runId in next is
  // already present in prior, this is a fully-covered re-run. Return prior
  // unchanged so the downstream byte-compare short-circuits the write.
  const priorRunSet = new Set(prior.runIds ?? []);
  if ((next.runIds ?? []).every((id) => priorRunSet.has(id))) {
    return prior;
  }

  // Codes: dedup by code; most-recent outcome wins (we use next's value).
  const codes = mergeCodes(prior.codes, next.codes);

  // Tips: union by contentHash; merge source[] arrays.
  const tips = collapseTipsByHash([...(prior.tips ?? []), ...next.tips]);

  // runIds union (sorted).
  const runIds = uniqueSorted([...(prior.runIds ?? []), ...next.runIds]);

  // Health: sum scalar counters; carry the newer modelLoaded / startedAt+finishedAt range.
  const health = mergeHealth(prior.health, next.health, runIds);

  return {
    date: next.date,
    generatedAt: next.generatedAt,
    windowStart: earliest(prior.windowStart, next.windowStart),
    windowEnd: latest(prior.windowEnd, next.windowEnd),
    runIds,
    codes,
    tips,
    health,
    ...(next.botUsername !== undefined
      ? { botUsername: next.botUsername }
      : prior.botUsername !== undefined
        ? { botUsername: prior.botUsername }
        : {}),
  };
}

function mergeCodes(
  prior: DailyDigest["codes"],
  next: DailyDigest["codes"],
): DailyDigest["codes"] {
  // Build a per-code "latest seen" map across all four lists; the bucket of
  // the next run wins on collision.
  type Entry =
    | { kind: "redeemed"; row: DailyDigest["codes"]["redeemed"][number] }
    | { kind: "failed"; row: DailyDigest["codes"]["failed"][number] }
    | { kind: "alreadyKnown"; row: DailyDigest["codes"]["alreadyKnown"][number] }
    | { kind: "deferredCap"; row: DailyDigest["codes"]["deferredCap"][number] };

  const byCode = new Map<string, Entry>();
  for (const r of prior.redeemed) byCode.set(r.code, { kind: "redeemed", row: r });
  for (const r of prior.failed) byCode.set(r.code, { kind: "failed", row: r });
  for (const r of prior.alreadyKnown) byCode.set(r.code, { kind: "alreadyKnown", row: r });
  for (const r of prior.deferredCap) byCode.set(r.code, { kind: "deferredCap", row: r });
  for (const r of next.redeemed) byCode.set(r.code, { kind: "redeemed", row: r });
  for (const r of next.failed) byCode.set(r.code, { kind: "failed", row: r });
  for (const r of next.alreadyKnown) {
    const previous = byCode.get(r.code);
    if (previous && previous.kind !== "alreadyKnown" && previous.row.source.jumpLink === r.source.jumpLink) {
      continue;
    }
    byCode.set(r.code, { kind: "alreadyKnown", row: r });
  }
  for (const r of next.deferredCap) byCode.set(r.code, { kind: "deferredCap", row: r });

  const out: DailyDigest["codes"] = {
    redeemed: [], failed: [], alreadyKnown: [], deferredCap: [],
  };
  for (const [, e] of [...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (e.kind === "redeemed") out.redeemed.push(e.row);
    else if (e.kind === "failed") out.failed.push(e.row);
    else if (e.kind === "alreadyKnown") out.alreadyKnown.push(e.row);
    else out.deferredCap.push(e.row);
  }
  return out;
}

function mergeHealth(prior: RunHealth, next: RunHealth, runIds: string[]): RunHealth {
  const errors: Record<string, number> = { ...prior.errorsByClass };
  for (const [k, v] of Object.entries(next.errorsByClass)) {
    errors[k] = (errors[k] ?? 0) + v;
  }
  const channelsErrored = dedupChannelsErrored([
    ...prior.channelsErrored, ...next.channelsErrored,
  ]);
  return {
    runId: next.runId, // most-recent for display
    startedAt: earliest(prior.startedAt, next.startedAt),
    finishedAt: latest(prior.finishedAt, next.finishedAt),
    // Scan status is per-run, so retain the latest run's configuration/read counts.
    promoChannelsConfigured: next.promoChannelsConfigured ?? prior.promoChannelsConfigured,
    promoChannelsRead: next.promoChannelsRead ?? prior.promoChannelsRead,
    channelsConfigured: Math.max(prior.channelsConfigured, next.channelsConfigured),
    channelsRead: prior.channelsRead + next.channelsRead,
    channelsErrored,
    messagesScanned: prior.messagesScanned + next.messagesScanned,
    candidatesExtracted: prior.candidatesExtracted + next.candidatesExtracted,
    candidatesSubmitted: prior.candidatesSubmitted + next.candidatesSubmitted,
    candidatesSuppressedDedup: prior.candidatesSuppressedDedup + next.candidatesSuppressedDedup,
    candidatesSuppressedCooldown: prior.candidatesSuppressedCooldown + next.candidatesSuppressedCooldown,
    candidatesDeferredCap: prior.candidatesDeferredCap + next.candidatesDeferredCap,
    tipsClassified: {
      tip: prior.tipsClassified.tip + next.tipsClassified.tip,
      trick: prior.tipsClassified.trick + next.tipsClassified.trick,
      hack: prior.tipsClassified.hack + next.tipsClassified.hack,
      "event-info": prior.tipsClassified["event-info"] + next.tipsClassified["event-info"],
      "patch-note": prior.tipsClassified["patch-note"] + next.tipsClassified["patch-note"],
    },
    dropped: {
      moderation: prior.dropped.moderation + next.dropped.moderation,
      lowConfidence: prior.dropped.lowConfidence + next.dropped.lowConfidence,
      chatter: prior.dropped.chatter + next.dropped.chatter,
    },
    errorsByClass: errors,
    modelLoaded: next.modelLoaded, // most-recent
    // The shape doesn't carry runIds; that lives on DailyDigest.
    ...(void runIds, {}),
  };
}

function dedupChannelsErrored(
  rows: RunHealth["channelsErrored"],
): RunHealth["channelsErrored"] {
  const seen = new Set<string>();
  const out: RunHealth["channelsErrored"] = [];
  for (const r of rows) {
    const k = `${r.channelId}/${r.errorClass}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function uniqueSorted(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

function earliest(a: string, b: string): string { return a < b ? a : b; }
function latest(a: string, b: string): string { return a > b ? a : b; }

// ── Render ─────────────────────────────────────────────────────────────────

function render(d: DailyDigest): string {
  const lines: string[] = [];
  lines.push(`# STFC Discord Monitor Digest — ${d.date} (UTC)`);
  lines.push("");
  lines.push(
    `_Last updated: ${d.generatedAt} · Runs: ${d.runIds.length} · Source: discord-monitor skill_`,
  );
  lines.push("");

  // Codes redeemed.
  lines.push(`## Codes redeemed (${d.codes.redeemed.length})`);
  lines.push("");
  if (d.codes.redeemed.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Code | Accounts | Source |");
    lines.push("|------|----------|--------|");
    for (const r of d.codes.redeemed) {
      lines.push(
        `| ${r.code} | ${r.accounts.join(", ")} | ${renderSource(r.source)} |`,
      );
    }
  }
  lines.push("");

  // Codes attempted but not redeemed (failed + alreadyKnown + deferredCap).
  const attempted = [
    ...d.codes.failed.map((r) => ({ code: r.code, outcome: r.outcome, source: r.source })),
    ...d.codes.alreadyKnown.map((r) => ({ code: r.code, outcome: "already-known", source: r.source })),
    ...d.codes.deferredCap.map((r) => ({ code: r.code, outcome: "deferred-cap", source: r.source })),
  ];
  lines.push(`## Codes attempted but not redeemed (${attempted.length})`);
  lines.push("");
  if (attempted.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Code | Outcome | Source |");
    lines.push("|------|---------|--------|");
    for (const r of attempted) {
      lines.push(`| ${r.code} | ${r.outcome} | ${renderSource(r.source)} |`);
    }
  }
  lines.push("");

  // Tips by category.
  const tips = d.tips ?? [];
  lines.push(`## Tips & tricks (${tips.length})`);
  lines.push("");
  if (tips.length === 0) {
    lines.push("_None._");
    lines.push("");
  } else {
    for (const cat of TIP_DISPLAY_ORDER) {
      const inCat = tips.filter((t) => t.category === cat);
      if (inCat.length === 0) continue;
      lines.push(`### ${cat} (${inCat.length})`);
      lines.push("");
      // Sort tips within a category by first-source timestamp for determinism.
      inCat.sort((a, b) =>
        firstTs(a) < firstTs(b) ? -1 : firstTs(a) > firstTs(b) ? 1 : 0,
      );
      for (const t of inCat) {
        lines.push(`> ${t.excerpt}`);
        lines.push("");
        // One source line per source[] entry.
        const srcs = [...t.source].sort((a, b) =>
          a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
        );
        const renderedSrcs = srcs
          .map((s) => `#${s.channelLabel} · ${s.timestamp} · [jump](${s.jumpLink})`)
          .join(" · ");
        lines.push(`— ${renderedSrcs}`);
        lines.push("");
      }
    }
  }

  // Ingestion health.
  lines.push("## Ingestion health");
  lines.push("");
  if (d.botUsername !== undefined && d.botUsername.length > 0) {
    lines.push(`- Bot identity: ${d.botUsername}`);
  }
  const h = d.health;
  lines.push(`- Promo-code scan: ${formatPromoScanStatus(h)}`);
  if (h.channelsConfigured === 0) {
    lines.push("- 0 channels configured");
  } else {
    lines.push(
      `- Channels read: ${h.channelsRead} / ${h.channelsConfigured}` +
      (h.channelsErrored.length > 0
        ? ` (${h.channelsErrored.length} errored: ${h.channelsErrored.map((e) => e.errorClass).join(", ")})`
        : ""),
    );
  }
  // Per-channel remediation lines (Feature 003 / T024 / FR-006).
  for (const e of h.channelsErrored) {
    const reason = e.reason ?? "unknown";
    const remediation = e.remediation ?? "";
    const codeFragment =
      e.discordErrorCode !== undefined ? ` (Discord code ${e.discordErrorCode})` : "";
    lines.push(`- ${e.channelId} — ${reason}${codeFragment}: ${remediation}`);
  }
  lines.push(`- Messages scanned: ${h.messagesScanned}`);
  lines.push(`- Candidates extracted: ${h.candidatesExtracted}`);
  lines.push(
    `- Candidates submitted to redeemer: ${h.candidatesSubmitted}` +
    ` (${h.candidatesSuppressedDedup} deduped, ${h.candidatesSuppressedCooldown} suppressed by cool-down, ${h.candidatesDeferredCap} deferred by cap)`,
  );
  lines.push(
    `- Tips classified: tip=${h.tipsClassified.tip}, trick=${h.tipsClassified.trick}, hack=${h.tipsClassified.hack}, event-info=${h.tipsClassified["event-info"]}, patch-note=${h.tipsClassified["patch-note"]}`,
  );
  lines.push(
    `- Dropped: moderation=${h.dropped.moderation}, low-confidence=${h.dropped.lowConfidence}, chatter=${h.dropped.chatter}`,
  );
  const errorEntries = Object.entries(h.errorsByClass).sort(([a], [b]) => (a < b ? -1 : 1));
  lines.push(
    `- Errors by class: ${errorEntries.length === 0
      ? "none"
      : errorEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`,
  );
  lines.push(
    `- Model: ${h.modelLoaded.name} (sha256 ${h.modelLoaded.sha256Verified ? "verified" : "not-verified"} · loaded in ${h.modelLoaded.loadMs}ms)`,
  );
  lines.push("");

  // State block — single-line minified JSON inside an HTML comment.
  lines.push(STATE_BLOCK_OPEN);
  lines.push(JSON.stringify(d));
  lines.push("-->");
  lines.push("");

  return lines.join("\n");
}

function firstTs(t: Tip): string {
  if (t.source.length === 0) return "";
  return t.source.reduce((acc, s) => (s.timestamp < acc ? s.timestamp : acc), t.source[0]!.timestamp);
}

function renderSource(s: { channelLabel: string; timestamp: string; jumpLink: string }): string {
  return `#${s.channelLabel} · ${s.timestamp} · [jump](${s.jumpLink})`;
}
