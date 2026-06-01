import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CHUNKER_VERSION,
  buildCache,
  buildChunks,
  cacheNeedsRebuild,
  chunkMarkdown,
  chunkOfficers,
  chunkTask,
  cosineSimilarity,
  createHashedEmbedder,
  embedHashed,
  hashSources,
  readCache,
  rebuildCommand,
  retrieve,
  writeCache,
  type KnowledgeBuildInputs,
} from "../../src/crew/knowledge.ts";

function syntheticInputs(): KnowledgeBuildInputs {
  return {
    knowledgeDoc: {
      source: "docs/synthetic.md",
      content: [
        "# Synthetic doc",
        "",
        "## Hostiles",
        "",
        "Clearing hostiles benefits from energy mitigation officers.",
        "",
        "## Mining",
        "",
        "Mining tasks reward cargo capacity and mining-rate officers.",
        "",
        "## Armadas",
        "",
        "Armadas favour synergy crews with armada damage tags.",
      ].join("\n"),
    },
    officers: {
      source: "data/synthetic-officers.json",
      content: JSON.stringify(
        [
          {
            id: "alpha",
            name: "Alpha Officer",
            faction: "federation",
            synergy_groups: ["alpha_crew"],
            bda_role: "captain",
            captain_maneuver: { text: "Boosts mining yield.", tags: ["mining_rate"] },
            officer_ability: { text: "Improves cargo capacity.", tags: ["cargo_capacity"] },
          },
          {
            id: "beta",
            name: "Beta Officer",
            faction: "klingon",
            synergy_groups: ["beta_crew"],
            bda_role: "officer",
            captain_maneuver: { text: "Hostile energy mitigation.", tags: ["hostile_mitigation"] },
            officer_ability: { text: "Reduces hostile damage.", tags: ["hostile_mitigation"] },
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
  };
}

describe("crew knowledge — chunking", () => {
  it("is deterministic across repeated calls", () => {
    const inputs = syntheticInputs();
    const a = buildChunks(inputs);
    const b = buildChunks(inputs);
    assert.deepEqual(a, b);
    assert.ok(a.length >= 4, `expected ≥ 4 chunks, got ${a.length}`);
  });

  it("chunks markdown by heading with line anchors", () => {
    const inputs = syntheticInputs();
    const chunks = chunkMarkdown(inputs.knowledgeDoc.source, inputs.knowledgeDoc.content);
    const hostiles = chunks.find((c) => c.text.startsWith("## Hostiles"));
    assert.ok(hostiles, "expected a Hostiles chunk");
    assert.equal(hostiles!.source, "docs/synthetic.md");
    assert.equal(hostiles!.startLine, 3);
    // ## Hostiles is line 3; ## Mining starts at line 7 → Hostiles section ends at line 6.
    assert.equal(hostiles!.endLine, 6);
  });

  it("splits oversized markdown sections with overlap", () => {
    const longSection = ["## Long"];
    for (let i = 0; i < 40; i++) {
      longSection.push(
        `Paragraph ${i} discussing hostiles, mining, armadas, and synergy crews with various tags and notes.`,
      );
    }
    const content = ["# Doc", "", ...longSection].join("\n");
    const chunks = chunkMarkdown("docs/long.md", content);
    assert.ok(chunks.length >= 2, `expected ≥ 2 sub-chunks for oversized section, got ${chunks.length}`);
    for (const chunk of chunks) {
      assert.ok(chunk.startLine >= 1);
      assert.ok(chunk.endLine >= chunk.startLine);
    }
  });

  it("emits one chunk per officer with id-anchored line numbers", () => {
    const inputs = syntheticInputs();
    const chunks = chunkOfficers(inputs.officers.source, inputs.officers.content);
    assert.equal(chunks.length, 2);
    const alpha = chunks.find((c) => c.text.startsWith("Officer Alpha Officer"));
    assert.ok(alpha, "expected alpha chunk");
    assert.match(alpha!.text, /Faction: federation/);
    assert.match(alpha!.text, /Synergy groups: alpha_crew/);
    assert.ok(alpha!.startLine >= 1 && alpha!.endLine >= alpha!.startLine);
  });

  it("emits a single full-file chunk per task yaml", () => {
    const chunks = chunkTask("data/tasks/synthetic.yaml", "id: synthetic\nname: foo\n");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.startLine, 1);
    // trailing newline trimmed → 2 physical content lines
    assert.equal(chunks[0]!.endLine, 2);
  });

  it("chunkTask endLine regression: trailing newline must not inflate line count", () => {
    // Build a 23-line content string — mirrors armada-25.yaml which Garak found was
    // cited as L1-L24 due to the off-by-one.
    const lines23 = Array.from({ length: 23 }, (_, i) => `line: ${i + 1}`);
    const withTrailing = lines23.join("\n") + "\n";   // POSIX file: ends with \n
    const withoutTrailing = lines23.join("\n");        // file without trailing newline

    const chunksWith = chunkTask("data/tasks/armada-like.yaml", withTrailing);
    const chunksWithout = chunkTask("data/tasks/armada-like.yaml", withoutTrailing);

    assert.equal(chunksWith.length, 1, "expected one chunk with trailing newline");
    assert.equal(chunksWithout.length, 1, "expected one chunk without trailing newline");

    // Both variants must agree on end line = 23 (the last non-empty line).
    assert.equal(chunksWith[0]!.endLine, 23, "trailing-newline variant: endLine must be 23, not 24");
    assert.equal(chunksWithout[0]!.endLine, 23, "no-trailing-newline variant: endLine must be 23");

    // The two representations must produce identical chunk shapes.
    assert.equal(
      chunksWith[0]!.endLine,
      chunksWithout[0]!.endLine,
      "trailing-newline and no-trailing-newline must yield the same endLine",
    );
  });
});

describe("crew knowledge — embedder + cache invalidation", () => {
  it("hashed embedder produces normalised, deterministic vectors", () => {
    const a = embedHashed("hostile mitigation officer");
    const b = embedHashed("hostile mitigation officer");
    assert.deepEqual(a, b);
    const norm = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`);
  });

  it("hashSources changes when content changes, model changes, or chunker version drifts", () => {
    const baseline = syntheticInputs();
    const baselineHash = hashSources(baseline, "model-a");
    assert.equal(baselineHash, hashSources(syntheticInputs(), "model-a"));
    assert.notEqual(baselineHash, hashSources(baseline, "model-b"));

    const mutated = syntheticInputs();
    mutated.knowledgeDoc.content += "\nnew sentence";
    assert.notEqual(baselineHash, hashSources(mutated, "model-a"));
  });

  it("cacheNeedsRebuild returns true on missing cache, hash drift, and chunker drift", () => {
    const inputs = syntheticInputs();
    const hash = hashSources(inputs, "model-a");
    assert.equal(cacheNeedsRebuild(null, hash), true);
    assert.equal(
      cacheNeedsRebuild(
        { model: "model-a", chunkerVersion: CHUNKER_VERSION, sourcesHash: hash, chunks: [] },
        hash,
      ),
      false,
    );
    assert.equal(
      cacheNeedsRebuild(
        { model: "model-a", chunkerVersion: CHUNKER_VERSION, sourcesHash: "OTHER", chunks: [] },
        hash,
      ),
      true,
    );
    assert.equal(
      cacheNeedsRebuild(
        { model: "model-a", chunkerVersion: "v0-stale", sourcesHash: hash, chunks: [] },
        hash,
      ),
      true,
    );
  });

  it("rebuildCommand writes a fresh cache and skips when up-to-date", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-knowledge-"));
    try {
      const cachePath = path.join(dir, "embeddings.json");
      const inputs = syntheticInputs();
      const docPath = path.join(dir, "doc.md");
      const officersPath = path.join(dir, "officers.json");
      const tasksDir = path.join(dir, "tasks");
      await fs.mkdir(tasksDir, { recursive: true });
      await fs.writeFile(docPath, inputs.knowledgeDoc.content);
      await fs.writeFile(officersPath, inputs.officers.content);
      await fs.writeFile(path.join(tasksDir, "synthetic.yaml"), inputs.tasks[0]!.content);

      const first = await rebuildCommand({
        paths: { knowledgeDocPath: docPath, officersPath, tasksDir },
        cachePath,
        embedder: createHashedEmbedder(),
        modelId: "test-embedder-v1",
      });
      assert.equal(first.status, "rebuilt");
      assert.ok(first.chunkCount > 0);

      const second = await rebuildCommand({
        paths: { knowledgeDocPath: docPath, officersPath, tasksDir },
        cachePath,
        embedder: createHashedEmbedder(),
        modelId: "test-embedder-v1",
      });
      assert.equal(second.status, "up-to-date");

      await fs.appendFile(docPath, "\n## New section\n\nNew content.\n");
      const third = await rebuildCommand({
        paths: { knowledgeDocPath: docPath, officersPath, tasksDir },
        cachePath,
        embedder: createHashedEmbedder(),
        modelId: "test-embedder-v1",
      });
      assert.equal(third.status, "rebuilt");
      assert.notEqual(third.sourcesHash, first.sourcesHash);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("crew knowledge — retrieval", () => {
  it("cosineSimilarity returns 1.0 for identical vectors and 0 for orthogonal", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
    assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
    assert.equal(cosineSimilarity([0, 0, 0], [1, 1, 1]), 0);
  });

  it("retrieves the most relevant chunk first and respects topK", async () => {
    const inputs = syntheticInputs();
    const cache = await buildCache(inputs, {
      embedder: createHashedEmbedder(),
      modelId: "test-embedder-v1",
      now: () => new Date("2026-06-01T00:00:00Z"),
    });

    const hostileHits = await retrieve("hostile mitigation officers", cache, createHashedEmbedder(), 2);
    assert.equal(hostileHits.length, 2);
    const top = hostileHits[0]!;
    assert.ok(
      /Hostile|hostile/.test(top.chunk.text),
      `expected hostile-related top hit, got: ${top.chunk.text.slice(0, 80)}`,
    );
    // Verify descending score ordering across all returned hits.
    for (let i = 0; i + 1 < hostileHits.length; i++) {
      assert.ok(
        hostileHits[i]!.score >= hostileHits[i + 1]!.score,
        `expected hit[${i}].score (${hostileHits[i]!.score.toFixed(4)}) >= hit[${i + 1}].score (${hostileHits[i + 1]!.score.toFixed(4)})`,
      );
    }

    const miningHits = await retrieve("mining rate cargo capacity", cache, createHashedEmbedder(), 1);
    assert.equal(miningHits.length, 1);
    assert.ok(
      /[Mm]ining|cargo/.test(miningHits[0]!.chunk.text),
      `expected mining-related top hit, got: ${miningHits[0]!.chunk.text.slice(0, 80)}`,
    );
  });

  it("returns deterministic ordering for tied scores", async () => {
    const inputs = syntheticInputs();
    const cache = await buildCache(inputs, {
      embedder: createHashedEmbedder(),
      modelId: "test-embedder-v1",
      now: () => new Date("2026-06-01T00:00:00Z"),
    });
    const a = await retrieve("xyz-no-such-token", cache, createHashedEmbedder(), 5);
    const b = await retrieve("xyz-no-such-token", cache, createHashedEmbedder(), 5);
    assert.deepEqual(
      a.map((h) => `${h.chunk.source}:${h.chunk.startLine}`),
      b.map((h) => `${h.chunk.source}:${h.chunk.startLine}`),
    );
  });

  it("returns [] for empty query and empty cache", async () => {
    const cache = await buildCache(syntheticInputs(), {
      embedder: createHashedEmbedder(),
      modelId: "test-embedder-v1",
    });
    assert.deepEqual(await retrieve("   ", cache, createHashedEmbedder(), 3), []);
    const emptyCache = { ...cache, chunks: [] };
    assert.deepEqual(await retrieve("anything", emptyCache, createHashedEmbedder(), 3), []);
  });

  it("round-trips cache through writeCache + readCache", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-knowledge-"));
    try {
      const cachePath = path.join(dir, "cache.json");
      const cache = await buildCache(syntheticInputs(), {
        embedder: createHashedEmbedder(),
        modelId: "test-embedder-v1",
      });
      await writeCache(cache, cachePath);
      const loaded = await readCache(cachePath);
      assert.ok(loaded);
      assert.equal(loaded!.chunks.length, cache.chunks.length);
      assert.equal(loaded!.sourcesHash, cache.sourcesHash);
      assert.deepEqual(loaded!.chunks[0]!.embedding, cache.chunks[0]!.embedding);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
