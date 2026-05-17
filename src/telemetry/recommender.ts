// Tuvok telemetry recommender — generates model-selection recommendations
// from accumulated telemetry data.

import { createLogger } from "../lib/logger.ts";
import {
  type TelemetryRecord,
  type ModelRecommendation,
  type ModelTierMap,
} from "./schemas.ts";
import { loadRecords } from "./reporter.ts";
import { resolveTier } from "./tiers.ts";

const log = createLogger("telemetry/recommender");

const DEFAULT_DATA_DIR = "data/telemetry";
const DEFAULT_MIN_SESSIONS = 10;

// Tier ordering for cost comparison (lower index = cheaper)
const TIER_ORDER: Record<string, number> = {
  standard: 0,
  high: 1,
  "extra-high": 2,
  unknown: 1, // treat unknown as mid-tier
};

function tierRank(tier: string): number {
  return TIER_ORDER[tier] ?? 1;
}

export interface RecommendOptions {
  dataDir?: string;
  tierMap: ModelTierMap;
  minSessionsForRecommendation?: number;
}

export interface RecommendResult {
  recommendations: ModelRecommendation[];
  insufficientData: Array<{ agent: string; model: string; sessionCount: number }>;
}

/**
 * Generate model-selection recommendations from telemetry data.
 *
 * Groups sessions by agent+model, compares success rates and token efficiency
 * across models for the same agent, and generates recommendations.
 */
export async function generateRecommendations(
  opts: RecommendOptions,
): Promise<RecommendResult> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const minSessions = opts.minSessionsForRecommendation ?? DEFAULT_MIN_SESSIONS;
  const records = await loadRecords(dataDir);

  return computeRecommendations(records, opts.tierMap, minSessions);
}

/** Pure computation — exported for testing. */
export function computeRecommendations(
  records: TelemetryRecord[],
  tierMap: ModelTierMap,
  minSessions: number,
): RecommendResult {
  const recommendations: ModelRecommendation[] = [];
  const insufficientData: Array<{ agent: string; model: string; sessionCount: number }> = [];

  if (records.length === 0) return { recommendations, insufficientData };

  // Group by agent
  const agentGroups = new Map<string, TelemetryRecord[]>();
  for (const r of records) {
    const existing = agentGroups.get(r.agentName);
    if (existing) existing.push(r);
    else agentGroups.set(r.agentName, [r]);
  }

  for (const [agent, agentRecords] of agentGroups) {
    // Group by primary model (first in breakdown)
    const modelGroups = new Map<string, TelemetryRecord[]>();
    for (const r of agentRecords) {
      const primaryModel = r.modelBreakdown[0]?.model ?? "unknown";
      const existing = modelGroups.get(primaryModel);
      if (existing) existing.push(r);
      else modelGroups.set(primaryModel, [r]);
    }

    const modelStats = Array.from(modelGroups.entries()).map(([model, sessions]) => {
      const successCount = sessions.filter((s) => s.outcome === "success").length;
      const totalTokens = sessions.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
      const tier = resolveTier(tierMap, model);
      return {
        model,
        tier,
        tierRank: tierRank(tier),
        sessionCount: sessions.length,
        successRate: sessions.length > 0 ? successCount / sessions.length : 0,
        avgTokens: sessions.length > 0 ? totalTokens / sessions.length : 0,
      };
    });

    // Check each model pair for recommendation opportunities
    for (const current of modelStats) {
      if (current.sessionCount < minSessions) {
        insufficientData.push({
          agent,
          model: current.model,
          sessionCount: current.sessionCount,
        });
        continue;
      }

      for (const candidate of modelStats) {
        if (candidate.model === current.model) continue;
        if (candidate.sessionCount < minSessions) continue;

        const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

        // Cost-saving: lower-tier model with similar success rate
        if (
          candidate.tierRank < current.tierRank &&
          candidate.successRate >= current.successRate * 0.9 // within 10%
        ) {
          const tokenSavings =
            current.avgTokens > 0
              ? ((current.avgTokens - candidate.avgTokens) / current.avgTokens) * 100
              : 0;

          recommendations.push({
            generatedAt: now,
            type: "cost-saving",
            targetAgent: agent,
            targetCategory: null,
            currentModel: current.model,
            recommendedModel: candidate.model,
            evidence: {
              currentSuccessRate: current.successRate,
              recommendedSuccessRate: candidate.successRate,
              currentAvgTokens: Math.round(current.avgTokens),
              recommendedAvgTokens: Math.round(candidate.avgTokens),
              tokenSavingsPercent: Math.round(tokenSavings * 10) / 10,
              sessionCount: current.sessionCount + candidate.sessionCount,
            },
            confidence: getConfidence(current.sessionCount + candidate.sessionCount),
            minimumSessionsMet: true,
          });
        }

        // Quality-improving: high failure rate on current, better candidate
        if (
          current.successRate < 0.5 &&
          candidate.successRate > current.successRate + 0.2
        ) {
          const tokenSavings =
            current.avgTokens > 0
              ? ((current.avgTokens - candidate.avgTokens) / current.avgTokens) * 100
              : 0;

          recommendations.push({
            generatedAt: now,
            type: "quality-improving",
            targetAgent: agent,
            targetCategory: null,
            currentModel: current.model,
            recommendedModel: candidate.model,
            evidence: {
              currentSuccessRate: current.successRate,
              recommendedSuccessRate: candidate.successRate,
              currentAvgTokens: Math.round(current.avgTokens),
              recommendedAvgTokens: Math.round(candidate.avgTokens),
              tokenSavingsPercent: Math.round(tokenSavings * 10) / 10,
              sessionCount: current.sessionCount + candidate.sessionCount,
            },
            confidence: getConfidence(current.sessionCount + candidate.sessionCount),
            minimumSessionsMet: true,
          });
        }
      }
    }
  }

  log.info(`generated ${recommendations.length} recommendations, ${insufficientData.length} insufficient-data exclusions`);

  return { recommendations, insufficientData };
}

function getConfidence(totalSessions: number): "low" | "medium" | "high" {
  if (totalSessions >= 50) return "high";
  if (totalSessions >= 20) return "medium";
  return "low";
}

/** Render recommendations to Markdown for inclusion in reports. */
export function renderRecommendations(result: RecommendResult): string {
  const lines: string[] = [];

  lines.push("## Recommendations");
  lines.push("");
  lines.push("> ⚠️ Recommendations require human review before action (FR-011).");
  lines.push("");

  if (result.recommendations.length === 0 && result.insufficientData.length === 0) {
    lines.push("No recommendations at this time.");
    return lines.join("\n");
  }

  for (let i = 0; i < result.recommendations.length; i++) {
    const rec = result.recommendations[i]!;
    lines.push(`### ${i + 1}. ${rec.type === "cost-saving" ? "Cost Saving" : "Quality Improvement"}: ${rec.targetAgent}`);
    lines.push("");
    lines.push(`- **Type**: ${rec.type}`);
    lines.push(`- **Target**: ${rec.targetAgent}${rec.targetCategory ? ` on ${rec.targetCategory}` : ""}`);
    lines.push(`- **Current model**: ${rec.currentModel}`);
    lines.push(`- **Recommended model**: ${rec.recommendedModel}`);
    lines.push(`- **Evidence**: Success rate ${(rec.evidence.currentSuccessRate * 100).toFixed(0)}% → ${(rec.evidence.recommendedSuccessRate * 100).toFixed(0)}%, Token savings: ${rec.evidence.tokenSavingsPercent.toFixed(1)}%`);
    lines.push(`- **Confidence**: ${rec.confidence}`);
    lines.push("");
  }

  if (result.insufficientData.length > 0) {
    lines.push("### Insufficient Data");
    lines.push("");
    for (const item of result.insufficientData) {
      lines.push(`- ${item.agent} / ${item.model}: ${item.sessionCount} sessions (below threshold)`);
    }
  }

  return lines.join("\n");
}
