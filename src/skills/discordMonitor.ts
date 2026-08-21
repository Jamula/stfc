// T026 [US1] — Discord monitor skill orchestration.
//
// Implements the 11-step sequence from
// `specs/001-discord-monitor/plan.md` § Sequence (steps 5/9/10 are stubbed
// per the Phase 3 scope; see in-line comments + their owning task IDs).
//
//   1. Load allowlist; empty → graceful no-op (FR-001).
//   2. Load DISCORD_BOT_TOKEN; missing → skip Discord half, still run redeemer.
//   3. Ingest (T025).
//   4. Extract candidates (T020).
//   5. Classify tips — STUB; full implementation lands at T033 (Phase 4).
//   6. Dedup (T022) + redeem via `redeemCodes({ extraCandidates })` (T023).
//   7. Auto-commit ≤ AUTO_COMMIT_PER_RUN_CAP redeemed codes to promo-codes.txt.
//   8. State flush — cursors, candidates.jsonl, cooldowns (with eviction).
//   9. Write digest (minimal renderer in src/digest/; full at T034).
//  10. Job summary — STUB; lands at T038.
//  11. Return `{ result, exitCode }`. Never calls process.exit.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Account } from "../lib/accounts.ts";
import { createLogger } from "../lib/logger.ts";
import { Outcomes, type Outcome } from "../lib/outcomes.ts";
import { readPromoCodes } from "../lib/promoCodes.ts";
import { redactForLog } from "../lib/redact.ts";
import {
  DiscordAuthError,
  DiscordClient,
  DiscordTokenMissingError,
  loadDiscordToken,
} from "../discord/client.ts";
import { dedup } from "../discord/dedup.ts";
import {
  processCrewCommands,
  type CrewCommandResponder,
} from "../discord/crewCommandParser.ts";
import { extractCodesFromMessage } from "../discord/extractor.ts";
import { evictExpired, recordFailure } from "../discord/cooldown.ts";
import { ingestDiscord, type IngestClient } from "../discord/ingest.ts";
import {
  appendCandidate,
  appendTipSeen,
  loadAllowlist,
  loadCommandChannelAllowlist,
  loadCooldowns,
  loadCursors,
  loadSuppression,
  readCandidates,
  readTipsSeen,
  saveCooldowns,
  saveCursors,
  DEFAULT_PATHS,
} from "../discord/state.ts";
import type {
  CandidateCode,
  CommandChannelAllowlistEntry,
  DailyDigest,
  DiscordAllowlist,
  DiscordAllowlistEntry,
  IngestedMessage,
  RunHealth,
  SourceRef,
  Tip,
} from "../discord/schemas.ts";
import { createHeuristicClassifier, type Classifier } from "../discord/classifier.ts";
import { isExcludedByModeration } from "../discord/moderation.ts";
import { redeemCodes, type RedeemCodesOptions } from "./redeemCodes.ts";
import { writeDigest, DEFAULT_DIGESTS_DIR } from "../digest/index.ts";
import { createHash } from "node:crypto";

const log = createLogger("discordMonitor");

/** Per-run auto-commit cap (R5; spec § FR-014 mitigation). Asserted by name
 *  in tests/skills/discordMonitor.test.ts (T018). */
export const AUTO_COMMIT_PER_RUN_CAP = 10;

/** Exit codes returned by {@link discordMonitor} (and propagated to `process.exit`
 *  via `src/cli.ts`).  Auth and infrastructure failures are intentionally
 *  distinct so a monitoring dashboard can page on the right team.
 *
 *  0 — success / graceful no-op (empty allowlist, normal run).
 *  1 — infrastructure failure (digest could not be written).
 *  2 — Discord auth / token failure (DiscordAuthError or DiscordTokenMissingError).
 */
export const DISCORD_MONITOR_EXIT_OK = 0;
export const DISCORD_MONITOR_EXIT_INFRA_FAILURE = 1;
export const DISCORD_MONITOR_EXIT_AUTH_FAILURE = 2;

export interface DiscordMonitorOptions {
  accounts?: Account[];
  promoCodesPath?: string;
  /** Test seam — override the Discord REST client factory (after token check). */
  clientFactory?: (token: string) => IngestClient;
  /** Test seam — override the redeemer skill (default: in-process redeemCodes). */
  redeemFn?: (opts: RedeemCodesOptions) => ReturnType<typeof redeemCodes>;
  /** Override committed-file paths (cursors, candidates, cooldowns, suppression, allowlist). */
  paths?: {
    allowlist?: string;
    commandChannels?: string;
    cursors?: string;
    candidates?: string;
    tipsSeen?: string;
    suppression?: string;
    cooldowns?: string;
    digestsDir?: string;
    promoCodes?: string;
  };
  /** Override the classifier (test seam). Default: heuristic-only. */
  classifierFactory?: () => Classifier;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
  /** Stable run id for cursors / candidates / digest. */
  runId?: string;
  /** Test hook fired right after `appendToPromoCodesTxt` would commit. */
  onPromoCodesAppend?: (added: string[]) => void;
}

export interface DiscordMonitorOutput {
  result: RunHealth & {
    digestPath?: string;
    redeemedCodes: string[];
    deferredCodes: string[];
    reason?: "no-channels-configured" | "no-token";
  };
  exitCode: number;
}

export async function discordMonitor(
  opts: DiscordMonitorOptions = {},
): Promise<DiscordMonitorOutput> {
  const now = opts.now ? opts.now() : new Date();
  const runId = opts.runId ?? `discord-monitor-${now.toISOString()}`;
  const startedAt = now.toISOString();

  const allowlistPath = opts.paths?.allowlist ?? DEFAULT_PATHS.allowlist;
  const commandChannelsPath = opts.paths?.commandChannels ?? DEFAULT_PATHS.commandChannels;
  const cursorsPath = opts.paths?.cursors ?? DEFAULT_PATHS.cursors;
  const candidatesPath = opts.paths?.candidates ?? DEFAULT_PATHS.candidates;
  const tipsSeenPath = opts.paths?.tipsSeen ?? DEFAULT_PATHS.tipsSeen;
  const suppressionPath = opts.paths?.suppression ?? DEFAULT_PATHS.suppression;
  const cooldownsPath = opts.paths?.cooldowns ?? DEFAULT_PATHS.cooldowns;
  const digestsDir = opts.paths?.digestsDir ?? DEFAULT_DIGESTS_DIR;
  const promoCodesPath = opts.paths?.promoCodes ?? opts.promoCodesPath ?? "promo-codes.txt";

  const accounts = opts.accounts ?? [];

  const health: RunHealth = {
    runId,
    startedAt,
    finishedAt: startedAt,
    channelsConfigured: 0,
    channelsRead: 0,
    channelsErrored: [],
    messagesScanned: 0,
    candidatesExtracted: 0,
    candidatesSubmitted: 0,
    candidatesSuppressedDedup: 0,
    candidatesSuppressedCooldown: 0,
    candidatesDeferredCap: 0,
    tipsClassified: {
      tip: 0, trick: 0, hack: 0, "event-info": 0, "patch-note": 0,
    },
    dropped: { moderation: 0, lowConfidence: 0, chatter: 0 },
    errorsByClass: {},
    modelLoaded: { name: "(deferred-T033)", sha256Verified: false, loadMs: 0 },
  };

  // ── Step 1: allowlists ────────────────────────────────────────────────────
  const allowlist = await loadAllowlist(allowlistPath);
  const commandChannels = await loadCommandChannelAllowlist(commandChannelsPath);
  const ingestAllowlist = withCommandChannels(allowlist, commandChannels, now);
  const codeChannelIds = new Set(
    allowlist.entries.filter((entry) => entry.enabled).map((entry) => entry.channelId),
  );
  health.channelsConfigured = ingestAllowlist.entries.length;

  if (ingestAllowlist.entries.length === 0) {
    log.info("allowlists empty — graceful no-op (FR-001)");
    return finalize({
      health,
      startedAt,
      now,
      digestsDir,
      runId,
      reason: "no-channels-configured",
      annotated: [],
      tips: [],
    });
  }

  // ── Step 2: token check ───────────────────────────────────────────────────
  let token: string | null = null;
  let failureExitCode = DISCORD_MONITOR_EXIT_OK;
  try {
    token = loadDiscordToken();
  } catch (err) {
    if (err instanceof DiscordTokenMissingError) {
      log.error(`Discord token missing — skipping Discord half. ${redactForLog(err)}`);
      recordError(health, "DiscordTokenMissingError");
      failureExitCode = DISCORD_MONITOR_EXIT_AUTH_FAILURE;
    } else {
      throw err;
    }
  }

  // ── Steps 3+4+5+6: ingest + extract + classify + dedup + redeem ─────────────
  let ingestedMessages: IngestedMessage[] = [];
  let extractedCandidates: CandidateCode[] = [];
  let freshAnnotated: CandidateCode[] = [];
  let allAnnotated: CandidateCode[] = [];
  let classifiedTips: Tip[] = [];
  let newCursors = await loadCursors(cursorsPath);
  let cooldowns = await loadCooldowns(cooldownsPath);
  let botUsername: string | undefined;

  if (token !== null) {
    const client: IngestClient = opts.clientFactory
      ? opts.clientFactory(token)
      : new DiscordClient({ token });

    try {
      const ingestOut = await ingestDiscord(ingestAllowlist, newCursors, client, runId, now);
      ingestedMessages = ingestOut.messages;
      newCursors = ingestOut.newCursors;
      botUsername = ingestOut.botIdentity.username;
      mergeHealth(health, ingestOut.health);
      // T015 [US3] — emit exactly one structured success-path auth log line
      // per run, after ingestDiscord resolves. Tests in
      // tests/skills/discordMonitor.test.ts pin the message text and count.
      log.info({
        msg: "discord bot authenticated",
        botUsername: ingestOut.botIdentity.username,
        botId: ingestOut.botIdentity.id,
      });

      if (commandChannels.length > 0 && ingestOut.discordMessages.length > 0) {
        if (isCrewCommandResponder(client)) {
          const commandStats = await processCrewCommands(
            ingestOut.discordMessages,
            commandChannels,
            client,
            {
              now,
              logger: (message) => log.info(message),
            },
          );
          if (commandStats.seen > 0 || commandStats.rateLimited > 0) {
            log.info({ msg: "crew commands processed", ...commandStats });
          }
        } else {
          log.warn("client cannot post Discord replies; skipping !crew command handling");
        }
      }
    } catch (err) {
      if (err instanceof DiscordAuthError) {
        log.error(`Discord auth failed — skipping Discord half. ${redactForLog(err)}`);
        recordError(health, "DiscordAuthError");
        failureExitCode = DISCORD_MONITOR_EXIT_AUTH_FAILURE;
      } else {
        recordError(health, (err as Error).name ?? "Error");
        throw err;
      }
    }

    const codeMessages = ingestedMessages.filter((message) => codeChannelIds.has(message.channelId));

    // Step 4: extract codes.
    for (const m of codeMessages) {
      const extracted = extractCodesFromMessage(m.contentRaw, {
        channelLabel: m.channelLabel,
      });
      for (const e of extracted) {
        extractedCandidates.push(toCandidate(e, m, now));
      }
    }
    health.candidatesExtracted = extractedCandidates.length;

    // Step 5: classify tips (T033 classifier + T037 health wiring).
    const classifierStartMs = Date.now();
    const classifier = opts.classifierFactory
      ? opts.classifierFactory()
      : createHeuristicClassifier();
    await classifier.load();
    health.modelLoaded = {
      name: classifier.constructor?.name ?? "heuristicClassifier",
      sha256Verified: true, // heuristic-only has no model to verify
      loadMs: Date.now() - classifierStartMs,
    };

    const tipsSeen = await readTipsSeen(tipsSeenPath);
    classifiedTips = [];

    for (const m of codeMessages) {
      // Moderation pre-filter (FR-020).
      if (isExcludedByModeration(m.contentNormalized, { channelLabel: m.channelLabel })) {
        health.dropped.moderation++;
        continue;
      }

      const out = await classifier.classify({
        contentNormalized: m.contentNormalized,
        channelLabel: m.channelLabel,
      });

      if (out.label === "chatter") {
        health.dropped.chatter++;
        continue;
      }
      if (out.label === "unclassified" || out.confidence < 0.55) {
        health.dropped.lowConfidence++;
        continue;
      }

      // Count classified tip.
      const label = out.label as keyof RunHealth["tipsClassified"];
      if (label in health.tipsClassified) {
        health.tipsClassified[label]++;
      }

      // Content hash for dedup.
      const contentHash = createHash("sha256")
        .update(m.contentNormalized)
        .digest("hex")
        .slice(0, 16);

      // Skip already-seen tips (dedup by contentHash).
      if (tipsSeen.has(contentHash)) continue;

      classifiedTips.push({
        category: out.label,
        confidence: out.confidence,
        excerpt: m.contentNormalized.slice(0, 600),
        source: [{
          messageId: m.messageId,
          channelId: m.channelId,
          channelLabel: m.channelLabel,
          timestamp: m.timestamp,
          jumpLink: m.jumpLink,
        }],
        contentHash,
        classifierMethod: out.method,
      });
    }

    await classifier.unload();
  }

  // Step 6: dedup against the four sources.
  const promoCodesTxt = new Set((await readPromoCodes(promoCodesPath)).map((c) => c.toUpperCase()));
  const priorCandidates = await readCandidates(candidatesPath);
  const suppression = await loadSuppression(suppressionPath);

  const { fresh, annotated } = dedup(extractedCandidates, {
    promoCodesTxt,
    priorCandidates,
    suppression,
    cooldowns,
    now,
  });
  freshAnnotated = fresh;
  allAnnotated = annotated;

  health.candidatesSuppressedDedup = annotated.filter(
    (c) => c.status === "already-known" || c.status === "duplicate" || c.status === "suppressed-operator-deny",
  ).length;
  health.candidatesSuppressedCooldown = annotated.filter(
    (c) => c.status === "suppressed-cooldown",
  ).length;

  // Step 6b: redeem via the existing skill — exactly ONE call per run, only
  // when there's at least one fresh candidate (matches the integration
  // contract's spy-call expectation).
  const redeemFn = opts.redeemFn ?? redeemCodes;
  const failedByCode = new Map<string, string>();
  const redeemedCodes: string[] = [];
  if (fresh.length > 0 && accounts.length > 0) {
    const redeemOut = await redeemFn({
      accounts,
      extraCandidates: fresh.map((c) => c.value),
      promoCodesPath: undefined, // monitor never re-submits the static file
    });
    health.candidatesSubmitted = fresh.length;

    // Merge per-account outcomes onto each candidate.
    const byCode = new Map<string, Array<{ accountName: string; outcome: Outcome | "ERROR"; detail?: string }>>();
    for (const row of redeemOut.result.rows) {
      for (const att of row.attempts) {
        if (!byCode.has(att.code)) byCode.set(att.code, []);
        byCode.get(att.code)!.push({ accountName: row.accountName, outcome: att.outcome, detail: att.detail });
      }
    }
    for (let i = 0; i < freshAnnotated.length; i++) {
      const cand = freshAnnotated[i]!;
      const attempts = byCode.get(cand.value) ?? [];
      const outcomes = attempts.map((a) => ({
        accountName: a.accountName,
        runId,
        outcome: a.outcome,
        attemptedAt: now.toISOString(),
      }));
      const anySuccess = attempts.some((a) => a.outcome === Outcomes.CODE_REDEEMED);
      const allUsed = attempts.length > 0 && attempts.every((a) => a.outcome === Outcomes.CODE_ALREADY_USED);
      let status: CandidateCode["status"] = "pending";
      if (anySuccess) {
        status = "redeemed";
        redeemedCodes.push(cand.value);
      } else if (allUsed) {
        status = "code-already-used";
      } else if (attempts.length > 0) {
        // Record the first non-success outcome for cooldown attribution.
        const first = attempts.find((a) => a.outcome !== Outcomes.CODE_REDEEMED);
        if (first) failedByCode.set(cand.value, String(first.outcome));
        if (attempts.some((a) => a.outcome === Outcomes.TRANSIENT || a.outcome === "ERROR")) {
          status = "transient-failure";
        } else {
          status = "invalid-or-expired";
        }
      }
      freshAnnotated[i] = { ...cand, status, lastAttempted: now.toISOString(), perAccountOutcome: outcomes };
    }

    // Re-merge freshAnnotated back into allAnnotated.
    const freshById = new Map(freshAnnotated.map((c) => [c.value, c]));
    allAnnotated = allAnnotated.map((c) => freshById.get(c.value) ?? c);
  }

  // ── Step 7: auto-commit successful new codes (cap 10) ─────────────────────
  const deferredCodes: string[] = [];
  if (redeemedCodes.length > 0) {
    const allowed = redeemedCodes.slice(0, AUTO_COMMIT_PER_RUN_CAP);
    const deferred = redeemedCodes.slice(AUTO_COMMIT_PER_RUN_CAP);
    deferredCodes.push(...deferred);
    await appendToPromoCodesTxt(promoCodesPath, allowed);
    opts.onPromoCodesAppend?.(allowed);

    // Update candidate statuses for the deferred slice.
    const deferredSet = new Set(deferred);
    allAnnotated = allAnnotated.map((c) =>
      deferredSet.has(c.value) ? { ...c, status: "deferred-cap" } : c,
    );
    health.candidatesDeferredCap = deferred.length;
  }

  // ── Step 8: state flush ───────────────────────────────────────────────────
  await saveCursors(newCursors, cursorsPath);
  for (const c of allAnnotated) {
    try {
      await appendCandidate(c, candidatesPath);
    } catch (err) {
      log.warn(`could not append candidate ${c.value}: ${redactForLog(err)}`);
    }
  }
  // Persist classified tips to tips-seen.jsonl.
  for (const t of classifiedTips) {
    try {
      await appendTipSeen(
        {
          contentHash: t.contentHash as `${string}`,
          firstSeenAt: t.source[0]?.timestamp ?? now.toISOString(),
          category: t.category as "tip" | "trick" | "hack" | "event-info" | "patch-note",
        },
        tipsSeenPath,
      );
    } catch (err) {
      log.warn(`could not append tip-seen ${t.contentHash}: ${redactForLog(err)}`);
    }
  }
  // Cooldowns: recordFailure for each failed redeem, then evict + save.
  for (const [code, outcome] of failedByCode) {
    cooldowns = recordFailure(cooldowns, code, outcome, now);
  }
  cooldowns = evictExpired(cooldowns, now);
  await saveCooldowns(cooldowns, now, cooldownsPath);

  // ── Step 9: digest ────────────────────────────────────────────────────────
  return finalize({
    health,
    startedAt,
    now,
    digestsDir,
    runId,
    annotated: allAnnotated,
    tips: classifiedTips,
    redeemedCodes,
    deferredCodes,
    botUsername,
    failureExitCode,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isCrewCommandResponder(client: IngestClient): client is IngestClient & CrewCommandResponder {
  return typeof (client as Partial<CrewCommandResponder>).postMessage === "function";
}

function withCommandChannels(
  allowlist: DiscordAllowlist,
  commandChannels: CommandChannelAllowlistEntry[],
  now: Date,
): DiscordAllowlist {
  const entries: DiscordAllowlistEntry[] = [...allowlist.entries];
  const seen = new Set(entries.map((entry) => `${entry.serverId}:${entry.channelId}`));

  for (const entry of commandChannels) {
    const key = `${entry.guild_id}:${entry.channel_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      serverId: entry.guild_id,
      serverLabel: `crew-command-${entry.guild_id}`,
      channelId: entry.channel_id,
      channelLabel: entry.account ? `crew-command-${entry.account}` : `crew-command-${entry.channel_id}`,
      addedAt: now.toISOString(),
      addedBy: "command-channel-allowlist",
      enabled: true,
    });
  }

  return { version: 1, entries };
}

interface FinalizeArgs {
  health: RunHealth;
  startedAt: string;
  now: Date;
  digestsDir: string;
  runId: string;
  annotated: CandidateCode[];
  tips: Tip[];
  redeemedCodes?: string[];
  deferredCodes?: string[];
  reason?: "no-channels-configured" | "no-token";
  /** Feature 003 (T024 / US3): bot username from `getMe()`, threaded into
   *  the digest health header. Undefined when token was missing or
   *  ingest never ran (e.g. allowlist empty). */
  botUsername?: string;
  /** Non-zero when auth or token failure was recorded earlier in the run.
   *  Preserved through `finalize` so that a digest-write error can only
   *  raise, never lower, the exit code. */
  failureExitCode?: number;
}

async function finalize(args: FinalizeArgs): Promise<DiscordMonitorOutput> {
  const finishedAt = args.now.toISOString();
  args.health.finishedAt = finishedAt;

  const date = finishedAt.slice(0, 10);
  const digest: DailyDigest = {
    date,
    generatedAt: finishedAt,
    windowStart: args.startedAt,
    windowEnd: finishedAt,
    runIds: [args.runId],
    codes: {
      redeemed: args.annotated
        .filter((c) => c.status === "redeemed")
        .map((c) => ({ code: c.value, accounts: c.perAccountOutcome.map((p) => p.accountName), source: sourceRef(c) })),
      failed: args.annotated
        .filter((c) => c.status === "code-already-used" || c.status === "invalid-or-expired" || c.status === "transient-failure")
        .map((c) => ({ code: c.value, outcome: c.status, source: sourceRef(c) })),
      alreadyKnown: args.annotated
        .filter((c) => c.status === "already-known")
        .map((c) => ({ code: c.value, source: sourceRef(c) })),
      deferredCap: args.annotated
        .filter((c) => c.status === "deferred-cap")
        .map((c) => ({ code: c.value, source: sourceRef(c) })),
    },
    tips: args.tips,
    health: args.health,
    ...(args.botUsername !== undefined ? { botUsername: args.botUsername } : {}),
  };

  let digestPath: string | undefined;
  let digestWriteFailed = false;
  try {
    digestPath = (await writeDigest(digest, { outputDir: args.digestsDir })).filePath;
  } catch (err) {
    log.warn(`could not write digest: ${redactForLog(err)}`);
    digestWriteFailed = true;
  }

  // ── Step 10: Job Summary (T038 — FR-027) ────────────────────────────────
  // Emits even if the digest write above failed (own try/catch).
  try {
    await emitJobSummary(args.health);
  } catch (err) {
    log.warn(`could not emit job summary: ${redactForLog(err)}`);
  }

  const result = {
    ...args.health,
    digestPath,
    redeemedCodes: args.redeemedCodes ?? [],
    deferredCodes: args.deferredCodes ?? [],
    ...(args.reason ? { reason: args.reason } : {}),
  };
  const exitCode = Math.max(
    args.failureExitCode ?? DISCORD_MONITOR_EXIT_OK,
    digestWriteFailed ? DISCORD_MONITOR_EXIT_INFRA_FAILURE : DISCORD_MONITOR_EXIT_OK,
  );
  return { result, exitCode };
}

function sourceRef(c: CandidateCode): SourceRef {
  return {
    channelLabel: c.source.channelLabel,
    timestamp: c.source.timestamp,
    jumpLink: c.source.jumpLink,
  };
}

function recordError(health: RunHealth, klass: string): void {
  health.errorsByClass[klass] = (health.errorsByClass[klass] ?? 0) + 1;
}

function mergeHealth(target: RunHealth, partial: Partial<RunHealth>): void {
  if (partial.channelsConfigured !== undefined) target.channelsConfigured = partial.channelsConfigured;
  if (partial.channelsRead !== undefined) target.channelsRead = partial.channelsRead;
  if (partial.channelsErrored !== undefined) target.channelsErrored = partial.channelsErrored;
  if (partial.messagesScanned !== undefined) target.messagesScanned = partial.messagesScanned;
}

function toCandidate(
  e: { value: string; extractionConfidence: number },
  m: IngestedMessage,
  now: Date,
): CandidateCode {
  return {
    value: e.value,
    firstSeen: m.timestamp,
    lastAttempted: null,
    suppressedUntil: null,
    extractionConfidence: e.extractionConfidence,
    status: "pending",
    source: {
      messageId: m.messageId,
      channelId: m.channelId,
      channelLabel: m.channelLabel,
      timestamp: m.timestamp,
      jumpLink: m.jumpLink,
    },
    perAccountOutcome: [],
  };
  void now; // reserved for lastAttempted on direct-from-prior callsites
}

async function appendToPromoCodesTxt(filePath: string, codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  // Read existing to dedup (case-insensitive after trim).
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const existingSet = new Set(
    existing
      .split(/\r?\n/)
      .map((l) => l.split("#")[0]!.trim().toUpperCase())
      .filter((l) => l.length > 0),
  );
  const toAppend = codes.filter((c) => !existingSet.has(c.toUpperCase()));
  if (toAppend.length === 0) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const suffix = (existing.length > 0 && !existing.endsWith("\n")) ? "\n" : "";
  await fs.appendFile(filePath, suffix + toAppend.join("\n") + "\n", "utf8");
}

// T038 — Emit RunHealth as GitHub Actions Job Summary (FR-027).
// No-op when GITHUB_STEP_SUMMARY is not set (local runs).
async function emitJobSummary(h: RunHealth): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const errorEntries = Object.entries(h.errorsByClass).sort(([a], [b]) => (a < b ? -1 : 1));
  const lines: string[] = [
    `### 🔭 Discord Monitor — Run Health`,
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Run ID | \`${h.runId}\` |`,
    `| Started | ${h.startedAt} |`,
    `| Finished | ${h.finishedAt} |`,
    `| Channels read | ${h.channelsRead} / ${h.channelsConfigured}${h.channelsErrored.length > 0 ? ` (${h.channelsErrored.length} errored)` : ""} |`,
    `| Messages scanned | ${h.messagesScanned} |`,
    `| Candidates extracted | ${h.candidatesExtracted} |`,
    `| Candidates submitted | ${h.candidatesSubmitted} |`,
    `| Suppressed (dedup) | ${h.candidatesSuppressedDedup} |`,
    `| Suppressed (cooldown) | ${h.candidatesSuppressedCooldown} |`,
    `| Deferred (cap) | ${h.candidatesDeferredCap} |`,
    `| Tips classified | tip=${h.tipsClassified.tip}, trick=${h.tipsClassified.trick}, hack=${h.tipsClassified.hack}, event-info=${h.tipsClassified["event-info"]}, patch-note=${h.tipsClassified["patch-note"]} |`,
    `| Dropped | moderation=${h.dropped.moderation}, low-confidence=${h.dropped.lowConfidence}, chatter=${h.dropped.chatter} |`,
    `| Errors | ${errorEntries.length === 0 ? "none" : errorEntries.map(([k, v]) => `${k}=${v}`).join(", ")} |`,
    `| Model | ${h.modelLoaded.name} (sha256 ${h.modelLoaded.sha256Verified ? "✅" : "❌"}, ${h.modelLoaded.loadMs}ms) |`,
    "",
  ];

  await fs.appendFile(summaryPath, lines.join("\n") + "\n", "utf8");
}
