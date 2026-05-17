// Model tier resolution — loads config/model-tiers.json and resolves
// model identifiers to tier labels with defaultTier fallback.

import { promises as fs } from "node:fs";
import { createLogger } from "../lib/logger.ts";
import { ModelTierMapSchema, type ModelTierMap } from "./schemas.ts";

const log = createLogger("telemetry/tiers");

const DEFAULT_CONFIG_PATH = "config/model-tiers.json";

/** Loaded tier map, cached after first load. */
let cachedMap: ModelTierMap | null = null;
let cachedPath: string | null = null;

/**
 * Load and validate the model-tiers.json config from disk.
 * Caches the result for the lifetime of the process (same path only).
 */
export async function loadModelTiers(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ModelTierMap> {
  if (cachedMap && cachedPath === configPath) return cachedMap;

  const raw = await fs.readFile(configPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const tierMap = ModelTierMapSchema.parse(parsed);

  cachedMap = tierMap;
  cachedPath = configPath;
  return tierMap;
}

/**
 * Resolve a model identifier to its tier label.
 * Returns `defaultTier` for unmapped models and logs a warning.
 */
export function resolveTier(tierMap: ModelTierMap, model: string): string {
  const tier = tierMap.tiers[model];
  if (tier !== undefined) return tier;

  log.warn(`unmapped model "${model}" — using defaultTier "${tierMap.defaultTier}"`);
  return tierMap.defaultTier;
}

/** Reset the cache (for testing). */
export function _resetTierCache(): void {
  cachedMap = null;
  cachedPath = null;
}
