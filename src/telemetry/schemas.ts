// Zod schemas + TS interfaces for the Tuvok telemetry feature. Authoritative
// shapes live in specs/002-tuvok-telemetry/contracts/state-files.contract.md
// and specs/002-tuvok-telemetry/data-model.md; this module is the runtime
// validator and TS-typed mirror.

import { z } from "zod";

// ── Common scalars ──────────────────────────────────────────────────────────

const IsoUtcSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    "must be an ISO 8601 UTC timestamp ending in Z",
  );

const SessionHash16 = z
  .string()
  .regex(/^[a-f0-9]{16}$/, "must be 16 lowercase hex chars (SHA-256 truncated)");

// ── Entity 1: TelemetryRecord + ModelUsage ──────────────────────────────────

export const ModelUsageSchema = z
  .object({
    model: z.string().min(1),
    tier: z.string().min(1),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    callCount: z.number().int().min(0),
  })
  .strict();

export type ModelUsage = z.infer<typeof ModelUsageSchema>;

export const TelemetryRecordSchema = z
  .object({
    sessionHash: SessionHash16,
    collectedAt: IsoUtcSchema,
    sessionStartedAt: IsoUtcSchema,
    sessionEndedAt: IsoUtcSchema,
    durationSeconds: z.number().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cacheReadTokens: z.number().int().min(0),
    modelBreakdown: z.array(ModelUsageSchema).min(1),
    agentName: z.string().min(1),
    taskCategory: z.string().min(1),
    outcome: z.enum(["success", "completed", "partial"]),
    usageEventCount: z.number().int().min(0),
    status: z.enum(["complete", "partial"]),
  })
  .strict();

export type TelemetryRecord = z.infer<typeof TelemetryRecordSchema>;

// ── Entity 4: CollectionLog ─────────────────────────────────────────────────

export const CollectionLogSchema = z
  .object({
    runAt: IsoUtcSchema,
    sessionsProcessed: z.number().int().min(0),
    sessionsSkipped: z.number().int().min(0),
    errors: z.array(z.string()),
    durationMs: z.number().min(0),
  })
  .strict();

export type CollectionLog = z.infer<typeof CollectionLogSchema>;

// ── Entity 2: TelemetrySummary + nested summaries ───────────────────────────

export const ModelSummarySchema = z
  .object({
    model: z.string().min(1),
    tier: z.string().min(1),
    sessionCount: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    avgDurationSeconds: z.number().min(0),
    successRate: z.number().min(0).max(1),
  })
  .strict();

export type ModelSummary = z.infer<typeof ModelSummarySchema>;

export const AgentSummarySchema = z
  .object({
    agentName: z.string().min(1),
    sessionCount: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    avgTokensPerSession: z.number().min(0),
    avgDurationSeconds: z.number().min(0),
  })
  .strict();

export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const CategorySummarySchema = z
  .object({
    category: z.string().min(1),
    sessionCount: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    successRate: z.number().min(0).max(1),
  })
  .strict();

export type CategorySummary = z.infer<typeof CategorySummarySchema>;

export const OutcomeSummarySchema = z
  .object({
    outcome: z.string().min(1),
    sessionCount: z.number().int().min(0),
    percentage: z.number().min(0).max(1),
  })
  .strict();

export type OutcomeSummary = z.infer<typeof OutcomeSummarySchema>;

export const TelemetrySummarySchema = z
  .object({
    generatedAt: IsoUtcSchema,
    periodStart: IsoUtcSchema,
    periodEnd: IsoUtcSchema,
    totalSessions: z.number().int().min(0),
    totalInputTokens: z.number().int().min(0),
    totalOutputTokens: z.number().int().min(0),
    byModel: z.array(ModelSummarySchema),
    byAgent: z.array(AgentSummarySchema),
    byCategory: z.array(CategorySummarySchema),
    byOutcome: z.array(OutcomeSummarySchema),
  })
  .strict();

export type TelemetrySummary = z.infer<typeof TelemetrySummarySchema>;

// ── Entity 3: ModelRecommendation + RecommendationEvidence ──────────────────

export const RecommendationEvidenceSchema = z
  .object({
    currentSuccessRate: z.number().min(0).max(1),
    recommendedSuccessRate: z.number().min(0).max(1),
    currentAvgTokens: z.number().min(0),
    recommendedAvgTokens: z.number().min(0),
    tokenSavingsPercent: z.number(),
    sessionCount: z.number().int().min(0),
  })
  .strict();

export type RecommendationEvidence = z.infer<typeof RecommendationEvidenceSchema>;

export const ModelRecommendationSchema = z
  .object({
    generatedAt: IsoUtcSchema,
    type: z.enum(["cost-saving", "quality-improving"]),
    targetAgent: z.string().min(1),
    targetCategory: z.string().nullable(),
    currentModel: z.string().min(1),
    recommendedModel: z.string().min(1),
    evidence: RecommendationEvidenceSchema,
    confidence: z.enum(["low", "medium", "high"]),
    minimumSessionsMet: z.boolean(),
  })
  .strict();

export type ModelRecommendation = z.infer<typeof ModelRecommendationSchema>;

// ── Entity 5: ModelTierMap config ───────────────────────────────────────────

export const ModelTierMapSchema = z
  .object({
    version: z.literal(1),
    tiers: z.record(z.string().min(1), z.string().min(1)),
    defaultTier: z.string().min(1),
  })
  .strict();

export type ModelTierMap = z.infer<typeof ModelTierMapSchema>;
