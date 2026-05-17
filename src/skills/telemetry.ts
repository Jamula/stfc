// Tuvok telemetry CLI skill entry point — routes subcommands to
// collector, reporter, and recommender modules.
//
// Contract: specs/002-tuvok-telemetry/contracts/telemetry-skill.contract.md

import { createLogger } from "../lib/logger.ts";
import { loadModelTiers } from "../telemetry/tiers.ts";
import { collectTelemetry } from "../telemetry/collector.ts";
import { generateReport } from "../telemetry/reporter.ts";
import { generateRecommendations, renderRecommendations } from "../telemetry/recommender.ts";

const log = createLogger("telemetry");

const DEFAULT_DATA_DIR = "data/telemetry";
const DEFAULT_TIERS_PATH = "config/model-tiers.json";
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MIN_SESSIONS = 10;

export interface TelemetryOptions {
  modelTiersPath?: string;
  dataDir?: string;
  minSessionsForRecommendation?: number;
  lookbackDays?: number;
  subcommand?: "collect" | "report" | "recommend";
}

export interface TelemetryResult {
  sessionsCollected: number;
  sessionsSkipped: number;
  errors: string[];
  reportPath: string | null;
  recommendations: number;
}

type TelemetryOutput = { result: TelemetryResult; exitCode: number };

export async function telemetry(opts: TelemetryOptions = {}): Promise<TelemetryOutput> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const tiersPath = opts.modelTiersPath ?? DEFAULT_TIERS_PATH;
  const minSessions = opts.minSessionsForRecommendation ?? DEFAULT_MIN_SESSIONS;
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const sub = opts.subcommand;

  const result: TelemetryResult = {
    sessionsCollected: 0,
    sessionsSkipped: 0,
    errors: [],
    reportPath: null,
    recommendations: 0,
  };

  try {
    const tierMap = await loadModelTiers(tiersPath);

    if (!sub || sub === "collect") {
      log.info("running telemetry collection...");
      const collectResult = await collectTelemetry({
        dataDir,
        tierMap,
        lookbackDays,
      });
      result.sessionsCollected = collectResult.sessionsCollected;
      result.sessionsSkipped = collectResult.sessionsSkipped;
      result.errors.push(...collectResult.errors);
    }

    // When running full cycle, generate recommendations first so they
    // can be included in the report (T029).
    let recommendationsMarkdown: string | undefined;
    if (!sub || sub === "recommend") {
      log.info("generating recommendations...");
      const recResult = await generateRecommendations({
        dataDir,
        tierMap,
        minSessionsForRecommendation: minSessions,
      });
      result.recommendations = recResult.recommendations.length;
      recommendationsMarkdown = renderRecommendations(recResult);
    }

    if (!sub || sub === "report") {
      log.info("generating telemetry report...");
      const reportResult = await generateReport({
        dataDir,
        recommendationsMarkdown,
      });
      result.reportPath = reportResult.reportPath;
    }

    return { result, exitCode: 0 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`telemetry skill failed: ${msg}`);
    result.errors.push(msg);
    return { result, exitCode: 1 };
  }
}
