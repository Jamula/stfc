// Zod schemas + TS interfaces for the Discord-monitor feature. Authoritative
// shapes live in specs/001-discord-monitor/contracts/state-files.contract.md
// and specs/001-discord-monitor/data-model.md; this module is the runtime
// validator and TS-typed mirror, in the same convention as src/api/schemas.ts.
//
// Schemas mark every state-file structural field as REQUIRED so that loaders
// in src/discord/state.ts fail fast on malformed input (Principle III).
// Schemas are strict — unknown top-level keys are rejected — to keep state
// files free of incidental drift. Add fields explicitly when the contract
// evolves.

import { z } from "zod";

// ── Common scalars ──────────────────────────────────────────────────────────

const SnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, "must be a 17–20 digit Discord snowflake");

const IsoUtcSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    "must be an ISO 8601 UTC timestamp ending in Z",
  );

const Confidence01 = z.number().min(0).max(1);

const ContentHash16 = z
  .string()
  .regex(/^[a-f0-9]{16}$/, "must be 16 lowercase hex chars (sha256 truncated)");

// ── Entity 7: discord-allowlist.json ────────────────────────────────────────

export const DiscordAllowlistEntrySchema = z
  .object({
    serverId: SnowflakeSchema,
    serverLabel: z.string().min(1).max(80),
    channelId: SnowflakeSchema,
    channelLabel: z.string().min(1).max(80),
    addedAt: IsoUtcSchema,
    addedBy: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const DiscordAllowlistSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(DiscordAllowlistEntrySchema),
  })
  .strict();

export type DiscordAllowlistEntry = z.infer<typeof DiscordAllowlistEntrySchema>;
export type DiscordAllowlist = z.infer<typeof DiscordAllowlistSchema>;

// ── Feature 004: command-channels.json ───────────────────────────────────────

export const CommandChannelAllowlistEntrySchema = z
  .object({
    guild_id: SnowflakeSchema,
    channel_id: SnowflakeSchema,
    account: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const CommandChannelAllowlistSchema = z.array(
  CommandChannelAllowlistEntrySchema,
);

export type CommandChannelAllowlistEntry = z.infer<
  typeof CommandChannelAllowlistEntrySchema
>;

// ── Entity 6: cursors.json ──────────────────────────────────────────────────

export const IngestionCursorSchema = z
  .object({
    channelLabel: z.string().min(1),
    lastMessageId: SnowflakeSchema,
    lastTimestamp: IsoUtcSchema,
    lastRunId: z.string().min(1),
    lastRunAt: IsoUtcSchema,
  })
  .strict();

export const IngestionCursorMapSchema = z.record(
  SnowflakeSchema,
  IngestionCursorSchema,
);

export type IngestionCursor = z.infer<typeof IngestionCursorSchema>;
export type IngestionCursorMap = z.infer<typeof IngestionCursorMapSchema>;

// ── Entity 2: candidates.jsonl line shape ───────────────────────────────────

export const CandidateStatusSchema = z.enum([
  "pending",
  "redeemed",
  "already-known",
  "code-already-used",
  "invalid-or-expired",
  "transient-failure",
  "duplicate",
  "deferred-cap",
  "suppressed-cooldown",
  "suppressed-operator-deny",
  "suppressed-dead-code",
]);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

const CandidateSourceSchema = z
  .object({
    messageId: SnowflakeSchema,
    channelId: SnowflakeSchema,
    channelLabel: z.string().min(1),
    timestamp: IsoUtcSchema,
    jumpLink: z.string().url(),
  })
  .strict();

const PerAccountOutcomeSchema = z
  .object({
    accountName: z.string().min(1),
    runId: z.string().min(1),
    outcome: z.string().min(1),
    attemptedAt: IsoUtcSchema,
  })
  .strict();

export const CandidateCodeSchema = z
  .object({
    value: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{2,19}$/, "must match ^[A-Z][A-Z0-9]{2,19}$"),
    firstSeen: IsoUtcSchema,
    lastAttempted: IsoUtcSchema.nullable(),
    suppressedUntil: IsoUtcSchema.nullable(),
    extractionConfidence: Confidence01,
    status: CandidateStatusSchema,
    source: CandidateSourceSchema,
    perAccountOutcome: z.array(PerAccountOutcomeSchema),
  })
  .strict();

export type CandidateCode = z.infer<typeof CandidateCodeSchema>;

// ── Entity 4: tips-seen.jsonl line shape + Tip TS interface ─────────────────

export const TipCategorySchema = z.enum([
  "tip",
  "trick",
  "hack",
  "event-info",
  "patch-note",
  "chatter",
  "unclassified",
]);
export type TipCategory = z.infer<typeof TipCategorySchema>;

// Only the dedup-relevant subset is persisted (see PII rule in data-model.md).
export const TipsSeenLineSchema = z
  .object({
    contentHash: ContentHash16,
    firstSeenAt: IsoUtcSchema,
    category: z.enum(["tip", "trick", "hack", "event-info", "patch-note"]),
  })
  .strict();
export type TipsSeenLine = z.infer<typeof TipsSeenLineSchema>;

export interface Tip {
  category: TipCategory;
  confidence: number;
  excerpt: string;
  source: Array<{
    messageId: string;
    channelId: string;
    channelLabel: string;
    timestamp: string;
    jumpLink: string;
  }>;
  contentHash: string;
  classifierMethod: "heuristic" | "zero-shot-deberta-xsmall";
}

// ── Entity 8: suppression.json (operator-curated rules) ─────────────────────

export const OperatorSuppressionRuleSchema = z
  .object({
    action: z.enum(["deny", "allow"]),
    reason: z.string().min(1),
    addedAt: IsoUtcSchema,
    addedBy: z.string().min(1),
  })
  .strict();

export const OperatorSuppressionMapSchema = z.record(
  z.string().min(1),
  OperatorSuppressionRuleSchema,
);

export type OperatorSuppressionRule = z.infer<typeof OperatorSuppressionRuleSchema>;
export type OperatorSuppressionMap = z.infer<typeof OperatorSuppressionMapSchema>;

// ── Entity 9: cooldowns.json ────────────────────────────────────────────────

export const CooldownEntrySchema = z
  .object({
    firstFailedAt: IsoUtcSchema,
    lastFailedAt: IsoUtcSchema,
    suppressedUntil: IsoUtcSchema,
    failureOutcomes: z.array(z.string()).max(5),
  })
  .strict();

export const CooldownMapSchema = z.record(z.string().min(1), CooldownEntrySchema);

export type CooldownEntry = z.infer<typeof CooldownEntrySchema>;
export type CooldownMap = z.infer<typeof CooldownMapSchema>;

// ── classifier-model.json ───────────────────────────────────────────────────

export const ClassifierModelSchema = z
  .object({
    id: z.string().min(1),
    revision: z.string().min(1),
    weightSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "must be 64 lowercase hex chars (sha256)"),
    task: z.literal("zero-shot-classification"),
    labels: z.array(z.string().min(1)).min(1),
    confidenceFloor: Confidence01,
  })
  .strict();
export type ClassifierModel = z.infer<typeof ClassifierModelSchema>;

// ── Discord REST response shape (Entity 1 source) ──────────────────────────

export const DiscordMessageSchema = z
  .object({
    id: SnowflakeSchema,
    guild_id: SnowflakeSchema.optional(),
    channel_id: SnowflakeSchema,
    content: z.string(),
    timestamp: z.string(),
    edited_timestamp: z.string().nullable().optional(),
    author: z
      .object({
        id: SnowflakeSchema,
        username: z.string(),
        bot: z.boolean().optional(),
      })
      .passthrough(),
    type: z.number().optional(),
  })
  .passthrough();

export type DiscordMessage = z.infer<typeof DiscordMessageSchema>;

export const DiscordMessageArraySchema = z.array(DiscordMessageSchema);

export const DiscordUserMeSchema = z
  .object({
    id: SnowflakeSchema,
    username: z.string(),
    bot: z.boolean().optional(),
  })
  .passthrough();
export type DiscordUserMe = z.infer<typeof DiscordUserMeSchema>;

// ── Feature 003: BotIdentity (validated /users/@me result) ─────────────────
//
// Stricter than `DiscordUserMeSchema` — the latter is the raw upstream
// envelope; `BotIdentitySchema` is what `DiscordClient.getMe()` returns to
// callers after asserting `bot === true` (per data-model.md §BotIdentity).
export const BotIdentitySchema = z
  .object({
    id: SnowflakeSchema,
    username: z.string().min(1).max(32),
    discriminator: z.string().default("0"),
    bot: z.literal(true),
  })
  .passthrough();
export type BotIdentity = z.infer<typeof BotIdentitySchema>;

// ── Feature 003: per-channel error taxonomy (RunHealth.channelsErrored[]) ──
export const ChannelErrorReasonSchema = z.enum([
  "forbidden_guild",
  "forbidden_channel",
  "forbidden_other",
  "not_found",
  "rate_limited",
  "transient",
  "schema_mismatch",
  "unknown",
]);
export type ChannelErrorReason = z.infer<typeof ChannelErrorReasonSchema>;

export const ChannelErroredEntrySchema = z.object({
  channelId: z.string(),
  errorClass: z.string(),
  reason: ChannelErrorReasonSchema,
  discordErrorCode: z.number().int().optional(),
  remediation: z.string().optional(),
});
export type ChannelErroredEntry = z.infer<typeof ChannelErroredEntrySchema>;

// ── Entity 1: IngestedMessage (transient, in-memory only) ───────────────────

export interface IngestedMessage {
  channelId: string;
  channelLabel: string;
  messageId: string;
  timestamp: string;
  editedTimestamp: string | null;
  authorDisplay: string;
  contentRaw: string;
  contentNormalized: string;
  jumpLink: string;
}

// ── Entity 3: RedemptionResult (flows through, not persisted standalone) ────

export type RedemptionOutcome =
  | "REDEEMED"
  | "CODE_ALREADY_USED"
  | "CODE_INVALID_OR_EXPIRED"
  | "TOKEN_EXPIRED"
  | "TRANSIENT"
  | "UNKNOWN_RESULT";

export interface RedemptionResult {
  code: string;
  accountName: string;
  runId: string;
  attemptedAt: string;
  outcome: RedemptionOutcome;
  responseSummary: string;
}

// ── Entity 5: DailyDigest ───────────────────────────────────────────────────

export interface SourceRef {
  channelLabel: string;
  timestamp: string;
  jumpLink: string;
}

export interface DailyDigest {
  date: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  runIds: string[];
  codes: {
    redeemed: Array<{ code: string; accounts: string[]; source: SourceRef }>;
    failed: Array<{ code: string; outcome: string; source: SourceRef }>;
    alreadyKnown: Array<{ code: string; source: SourceRef }>;
    deferredCap: Array<{ code: string; source: SourceRef }>;
  };
  tips: Tip[];
  health: RunHealth;
  /** Feature 003 (T024 / US3): bot username from `getMe()` — rendered in
   *  the digest health header so operators can confirm WHICH bot identity
   *  produced this digest. Optional for backwards-compat. */
  botUsername?: string;
}

// ── Entity 10: RunHealth ────────────────────────────────────────────────────

export interface RunHealth {
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** Enabled entries in config/discord-allowlist.json for the latest run. */
  promoChannelsConfigured?: number;
  /** Promo-code channels successfully read in the latest run. */
  promoChannelsRead?: number;
  channelsConfigured: number;
  channelsRead: number;
  channelsErrored: Array<{
    channelId: string;
    errorClass: string;
    /** Feature 003: classification used by digest renderer. Optional for
     *  backwards-compat with existing in-memory health objects that may
     *  pre-date the extension. */
    reason?: ChannelErrorReason;
    discordErrorCode?: number;
    remediation?: string;
  }>;
  messagesScanned: number;
  candidatesExtracted: number;
  candidatesSubmitted: number;
  candidatesSuppressedDedup: number;
  candidatesSuppressedCooldown: number;
  candidatesSuppressedDead?: number;
  deadCodeCacheUnavailable?: boolean;
  candidatesDeferredCap: number;
  tipsClassified: {
    tip: number;
    trick: number;
    hack: number;
    "event-info": number;
    "patch-note": number;
  };
  dropped: { moderation: number; lowConfidence: number; chatter: number };
  errorsByClass: Record<string, number>;
  modelLoaded: { name: string; sha256Verified: boolean; loadMs: number };
}
