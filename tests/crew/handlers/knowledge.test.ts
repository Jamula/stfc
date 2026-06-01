import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNKER_VERSION,
  buildCache,
  createHashedEmbedder,
  type KnowledgeCache,
} from "../../../src/crew/knowledge.ts";
import { handleKnowledge } from "../../../src/crew/handlers/knowledge.ts";
import { makeCommand } from "./helpers.ts";

async function fixtureCache(): Promise<KnowledgeCache> {
  return buildCache(
    {
      knowledgeDoc: {
        source: "docs/synthetic.md",
        content: [
          "# Synthetic",
          "",
          "## Hostiles",
          "",
          "Clearing hostiles benefits from energy mitigation officers.",
          "",
          "## Mining",
          "",
          "Mining tasks reward cargo capacity and mining-rate officers.",
        ].join("\n"),
      },
      officers: {
        source: "data/synthetic-officers.json",
        content: JSON.stringify(
          [
            {
              id: "alpha",
              name: "Alpha",
              faction: "federation",
              synergy_groups: ["alpha_crew"],
              bda_role: "captain",
              captain_maneuver: { text: "Boosts mining yield.", tags: ["mining_rate"] },
              officer_ability: { text: "Improves cargo capacity.", tags: ["cargo_capacity"] },
            },
          ],
          null,
          2,
        ),
      },
      tasks: [
        {
          source: "data/tasks/synthetic.yaml",
          content: "id: synthetic\nname: Synthetic Task\ndescription: Test task.\n",
        },
      ],
    },
    { embedder: createHashedEmbedder(), modelId: "test-embedder-v1" },
  );
}

function makeDeps(cache: KnowledgeCache): {
  cachePath: string;
  loadCache: () => Promise<KnowledgeCache>;
  embedderForCache: () => Promise<ReturnType<typeof createHashedEmbedder>>;
} {
  return {
    cachePath: "fixture://cache.json",
    loadCache: async () => cache,
    embedderForCache: async () => createHashedEmbedder(),
  };
}

describe("crew knowledge handler", () => {
  it("renders top-3 with line-anchored citations", async () => {
    const cache = await fixtureCache();
    const output = await handleKnowledge(
      makeCommand("knowledge", { _: "hostile mitigation officers", _0: "hostile", _1: "mitigation", _2: "officers" }),
      makeDeps(cache),
    );

    assert.match(output, /\*\*Crew knowledge — `hostile mitigation officers`\*\*/);
    assert.match(output, /\*\*docs\/synthetic\.md:L\d+-L\d+\*\*/);
    assert.match(output, /score \d+\.\d+/);
    assert.match(output, /#1 — score/);
  });

  it("rejects when the query is missing", async () => {
    const cache = await fixtureCache();
    await assert.rejects(
      () => handleKnowledge(makeCommand("knowledge", {}), makeDeps(cache)),
      /Usage: !crew knowledge <query>/,
    );
  });

  it("accepts --top with a value between 1 and 5 and rejects otherwise", async () => {
    const cache = await fixtureCache();
    const ok = await handleKnowledge(
      makeCommand("knowledge", { _: "mining", _0: "mining", top: "2" }),
      makeDeps(cache),
    );
    assert.match(ok, /top 2|#2 —/);

    await assert.rejects(
      () =>
        handleKnowledge(
          makeCommand("knowledge", { _: "mining", _0: "mining", top: "10" }),
          makeDeps(cache),
        ),
      /Invalid `--top` value/,
    );

    await assert.rejects(
      () =>
        handleKnowledge(
          makeCommand("knowledge", { _: "mining", _0: "mining", top: "true" }),
          makeDeps(cache),
        ),
      /Flag `--top` requires a value/,
    );
  });

  it("returns a friendly message when retrieval yields no hits", async () => {
    const cache = await fixtureCache();
    const empty: KnowledgeCache = { ...cache, chunks: [] };
    const output = await handleKnowledge(
      makeCommand("knowledge", { _: "any query", _0: "any", _1: "query" }),
      makeDeps(empty),
    );
    assert.match(output, /No matches found/);
  });

  it("throws when cache is missing", async () => {
    await assert.rejects(
      () =>
        handleKnowledge(
          makeCommand("knowledge", { _: "anything", _0: "anything" }),
          {
            cachePath: "fixture://missing.json",
            loadCache: async () => null,
            embedderForCache: async () => createHashedEmbedder(),
          },
        ),
      /Knowledge cache not found/,
    );
  });

  it("throws when the cache chunker version drifts", async () => {
    const cache = await fixtureCache();
    const stale: KnowledgeCache = { ...cache, chunkerVersion: "v0-stale" };
    await assert.rejects(
      () =>
        handleKnowledge(
          makeCommand("knowledge", { _: "anything", _0: "anything" }),
          {
            cachePath: "fixture://stale.json",
            loadCache: async () => stale,
            embedderForCache: async () => createHashedEmbedder(),
          },
        ),
      new RegExp(`chunker version mismatch.*${CHUNKER_VERSION}`),
    );
  });

  it("truncates output longer than the Discord-safe limit", async () => {
    const baseCache = await fixtureCache();
    const wideChunk = {
      ...baseCache.chunks[0]!,
      text: "X".repeat(600),
    };
    const inflated: KnowledgeCache = {
      ...baseCache,
      chunks: Array.from({ length: 10 }, (_, i) => ({
        ...wideChunk,
        startLine: i + 1,
        endLine: i + 1,
      })),
    };
    const output = await handleKnowledge(
      makeCommand("knowledge", { _: "anything", _0: "anything", top: "5" }),
      makeDeps(inflated),
    );
    assert.ok(output.length <= 1900, `expected ≤ 1900 chars, got ${output.length}`);
    assert.match(output, /output truncated to 1900 chars/);
  });
});
