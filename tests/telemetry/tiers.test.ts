// Tier resolution tests — known model, unknown model, invalid config.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadModelTiers, resolveTier, _resetTierCache } from "../../src/telemetry/tiers.ts";
import type { ModelTierMap } from "../../src/telemetry/schemas.ts";

afterEach(() => {
  _resetTierCache();
});

describe("resolveTier", () => {
  const tierMap: ModelTierMap = {
    version: 1,
    tiers: {
      "claude-opus-4.6": "high",
      "gpt-5.4-mini": "standard",
    },
    defaultTier: "unknown",
  };

  it("returns correct tier for a known model", () => {
    assert.equal(resolveTier(tierMap, "claude-opus-4.6"), "high");
  });

  it("returns correct tier for another known model", () => {
    assert.equal(resolveTier(tierMap, "gpt-5.4-mini"), "standard");
  });

  it("returns defaultTier for an unknown model", () => {
    assert.equal(resolveTier(tierMap, "some-new-model"), "unknown");
  });
});

describe("loadModelTiers", () => {
  it("loads and validates config/model-tiers.json", async () => {
    const tierMap = await loadModelTiers("config/model-tiers.json");
    assert.equal(tierMap.version, 1);
    assert.equal(typeof tierMap.defaultTier, "string");
    assert.equal(typeof tierMap.tiers, "object");
    assert.equal(tierMap.tiers["claude-opus-4.6"], "high");
  });

  it("rejects invalid config (missing version)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tiers-"));
    const tmpFile = path.join(tmpDir, "bad.json");
    await fs.writeFile(tmpFile, JSON.stringify({ tiers: {}, defaultTier: "x" }));
    await assert.rejects(() => loadModelTiers(tmpFile), /version/i);
    await fs.rm(tmpDir, { recursive: true });
  });

  it("handles missing file gracefully", async () => {
    await assert.rejects(
      () => loadModelTiers("/nonexistent/model-tiers.json"),
      /ENOENT/,
    );
  });
});
