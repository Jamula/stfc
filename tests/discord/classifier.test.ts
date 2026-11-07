// T028 [US2] — Classifier tests (write FIRST per Principle IX).
//
// Exercises the tier-1 heuristic path of `Classifier`. The tier-2 zero-shot
// model lifecycle (huggingface download + SHA verification + ONNX inference)
// CANNOT be exercised in CI without network access; it is mocked here to
// no-op for `load()` (heuristic-only mode). Real tier-2 is validated manually
// by an operator on first deploy via the procedure documented in T033 and
// in `src/discord/classifier.ts`.
//
// PRIVACY INVARIANT (FR-016 / FR-017 / Picard Condition 5):
//   `classify()` MUST NEVER issue an outbound fetch. We stub `globalThis.fetch`
//   in beforeEach and assert callCount === 0 after every `classify()` block.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ClassifierIntegrityError,
  ClassifierLoadError,
  createTier2Classifier,
  createHeuristicClassifier,
  type Classifier,
} from "../../src/discord/classifier.ts";

let origFetch: typeof globalThis.fetch | undefined;
let fetchCallCount = 0;

function stubFetch(): void {
  origFetch = globalThis.fetch;
  fetchCallCount = 0;
  globalThis.fetch = (async (..._args: unknown[]): Promise<Response> => {
    fetchCallCount++;
    throw new Error("classifier test: outbound fetch blocked");
  }) as unknown as typeof globalThis.fetch;
}

function restoreFetch(): void {
  if (origFetch !== undefined) globalThis.fetch = origFetch;
  origFetch = undefined;
}

async function withTemporaryModelRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "classifier-model-test-"));
  const previousHome = process.env["HF_HOME"];
  process.env["HF_HOME"] = path.join(root, "hf");
  try {
    await run(root);
  } finally {
    if (previousHome === undefined) delete process.env["HF_HOME"];
    else process.env["HF_HOME"] = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}

describe("classifier / privacy invariant (FR-016, FR-017)", () => {
  beforeEach(stubFetch);
  afterEach(restoreFetch);

  it("classify() makes zero outbound fetch calls (top-level invariant)", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const samples = [
      "Tip: keep your shipyard upgrades queued during the weekend event.",
      "Trick: queue a 15-minute research right before reset.",
      "Hack: bind your favorite armada composition to slot 1.",
      "Event info: PvP arena starts Friday 18:00 UTC.",
      "Patch note: Vi'dar Talios hull HP +3%.",
      "lol",
      "@everyone free latinum here",
      "🚀",
      "gm",
    ];
    for (const text of samples) {
      await c.classify({ contentNormalized: text, channelLabel: "stfc-chat" });
    }
    assert.equal(fetchCallCount, 0, "classify() must not touch the network");
    await c.unload();
  });
});

describe("classifier / tier-2 offline model integrity", () => {
  beforeEach(stubFetch);
  afterEach(restoreFetch);

  it("rejects unreadable, malformed, and schema-invalid model configuration", async () => {
    await withTemporaryModelRoot(async (root) => {
      const missing = await createTier2Classifier({
        modelConfigPath: path.join(root, "missing.json"),
      });
      await assert.rejects(
        missing.load(),
        (error: unknown) =>
          error instanceof ClassifierLoadError &&
          /Could not read classifier model config/.test(error.message),
      );

      const malformedPath = path.join(root, "malformed.json");
      await writeFile(malformedPath, "{", "utf8");
      const malformed = await createTier2Classifier({ modelConfigPath: malformedPath });
      await assert.rejects(
        malformed.load(),
        (error: unknown) =>
          error instanceof ClassifierLoadError && /Malformed JSON/.test(error.message),
      );

      const invalidPath = path.join(root, "invalid-schema.json");
      await writeFile(invalidPath, JSON.stringify({ id: "incomplete" }), "utf8");
      const invalid = await createTier2Classifier({ modelConfigPath: invalidPath });
      await assert.rejects(
        invalid.load(),
        (error: unknown) =>
          error instanceof ClassifierLoadError &&
          /failed schema validation/.test(error.message),
      );
    });
  });

  it("accepts cached weights with the expected SHA and deletes a mismatched model", async () => {
    await withTemporaryModelRoot(async (root) => {
      const validBytes = Buffer.from("known offline model weights");
      const validSha = createHash("sha256").update(validBytes).digest("hex");
      const validModelPath = path.join(root, "valid-model.json");
      const validWeightPath = path.join(
        root,
        "hf",
        "hub",
        "models--test--valid",
        "snapshots",
        "rev",
        "model.onnx",
      );
      await mkdir(path.dirname(validWeightPath), { recursive: true });
      await writeFile(validWeightPath, validBytes);
      await writeFile(
        validModelPath,
        JSON.stringify({
          id: "test/valid",
          revision: "rev",
          weightSha256: validSha,
          task: "zero-shot-classification",
          labels: ["tip"],
          confidenceFloor: 0.55,
        }),
        "utf8",
      );

      const valid = await createTier2Classifier({ modelConfigPath: validModelPath });
      await valid.load();
      assert.deepEqual(
        await valid.classify({ contentNormalized: "synthetic input", channelLabel: "test" }),
        { label: "unclassified", confidence: 0, method: "heuristic", scores: {} },
      );
      await valid.unload();
      await assert.rejects(
        () => valid.classify({ contentNormalized: "synthetic input", channelLabel: "test" }),
        /before load/i,
      );

      const invalidBytes = Buffer.from("corrupted offline model weights");
      const actualInvalidSha = createHash("sha256").update(invalidBytes).digest("hex");
      const wrongSha = actualInvalidSha === "a".repeat(64) ? "b".repeat(64) : "a".repeat(64);
      const invalidModelPath = path.join(root, "invalid-model.json");
      const invalidWeightPath = path.join(
        root,
        "hf",
        "hub",
        "models--test--invalid",
        "snapshots",
        "rev",
        "model.onnx",
      );
      await mkdir(path.dirname(invalidWeightPath), { recursive: true });
      await writeFile(invalidWeightPath, invalidBytes);
      await writeFile(
        invalidModelPath,
        JSON.stringify({
          id: "test/invalid",
          revision: "rev",
          weightSha256: wrongSha,
          task: "zero-shot-classification",
          labels: ["tip"],
          confidenceFloor: 0.55,
        }),
        "utf8",
      );

      const invalid = await createTier2Classifier({ modelConfigPath: invalidModelPath });
      await assert.rejects(
        invalid.load(),
        (error: unknown) =>
          error instanceof ClassifierIntegrityError &&
          /SHA-256 mismatch/.test(error.message),
      );
      await assert.rejects(
        readFile(invalidWeightPath),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT",
      );
      await assert.rejects(
        () => invalid.classify({ contentNormalized: "synthetic input", channelLabel: "test" }),
        /before load/i,
      );
      assert.equal(fetchCallCount, 0, "cache verification must not fetch model weights");
    });
  });
});

describe("classifier / tier-1 chatter heuristics (no tier-2 invocation)", () => {
  beforeEach(stubFetch);
  afterEach(restoreFetch);

  it("single-emoji message → chatter without invoking tier-2 (zero fetch)", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized: "🚀",
      channelLabel: "stfc-chat",
    });
    assert.equal(out.label, "chatter");
    assert.equal(out.method, "heuristic");
    assert.equal(fetchCallCount, 0);
    await c.unload();
  });

  it("sub-20-char greeting → chatter without invoking tier-2", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    for (const text of ["gm", "hi all", "hey", "yo", "sup"]) {
      const out = await c.classify({
        contentNormalized: text,
        channelLabel: "stfc-chat",
      });
      assert.equal(out.label, "chatter", `expected "${text}" → chatter`);
      assert.equal(out.method, "heuristic");
    }
    assert.equal(fetchCallCount, 0);
    await c.unload();
  });

  it("@everyone raid-ping → chatter without invoking tier-2", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized: "@everyone free latinum here — click this sketchy link",
      channelLabel: "stfc-chat",
    });
    assert.equal(out.label, "chatter");
    assert.equal(out.method, "heuristic");
    assert.equal(fetchCallCount, 0);
    await c.unload();
  });

  it("@here mass-mention → chatter without invoking tier-2", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized: "@here drama incoming",
      channelLabel: "stfc-chat",
    });
    assert.equal(out.label, "chatter");
    assert.equal(fetchCallCount, 0);
    await c.unload();
  });
});

describe("classifier / lifecycle", () => {
  beforeEach(stubFetch);
  afterEach(restoreFetch);

  it("classify() before load() throws", async () => {
    const c = createHeuristicClassifier();
    await assert.rejects(
      () => c.classify({ contentNormalized: "Tip: hello", channelLabel: "x" }),
      /load/i,
    );
  });

  it("unload() is safe to call multiple times", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    await c.unload();
    await c.unload();
    await c.unload();
    await assert.rejects(
      () => c.classify({ contentNormalized: "Tip: a valid tip", channelLabel: "x" }),
      /before load/i,
    );
  });

  it("load() is idempotent", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    await c.load();
    const out = await c.classify({
      contentNormalized: "Tip: research the navigation tree first if you're under ops 30.",
      channelLabel: "stfc-strategy",
    });
    assert.equal(out.label, "tip");
    assert.equal(out.method, "heuristic");
  });
});

describe("classifier / tier-1 useful classifications", () => {
  beforeEach(stubFetch);
  afterEach(restoreFetch);

  it("clean STFC tip message → label !== chatter (≥ confidence floor)", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized:
        "Tip: keep your shipyard upgrades queued during the weekend event for the 2x build buff — saves about 8 hours per node.",
      channelLabel: "stfc-strategy",
    });
    // Heuristic should identify this as a tip with high confidence.
    assert.equal(out.label, "tip");
    assert.equal(out.method, "heuristic");
    assert.ok(out.confidence >= 0.55, `expected ≥ floor, got ${out.confidence}`);
    assert.equal(fetchCallCount, 0);
    await c.unload();
  });

  it("clean trick message → trick", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized:
        "Trick: stagger your survey deploy times to avoid overlapping refinery cycles wasting loot.",
      channelLabel: "stfc-strategy",
    });
    assert.equal(out.label, "trick");
    await c.unload();
  });

  it("clean hack message → hack", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized:
        "Hack: turn cloud sync off during a battle — it shaves ~80ms off ability latency on Android.",
      channelLabel: "stfc-strategy",
    });
    assert.equal(out.label, "hack");
    await c.unload();
  });

  it("classifies event-info and patch-note markers with their own scores", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    for (const [contentNormalized, label] of [
      ["Event info: the next event starts Friday.", "event-info"],
      ["Patch note: the refinery queue is now fixed.", "patch-note"],
    ] as const) {
      const out = await c.classify({ contentNormalized, channelLabel: "stfc-strategy" });
      assert.deepEqual(out, {
        label,
        confidence: 0.9,
        method: "heuristic",
        scores: { [label]: 0.9 },
      });
    }
    await c.unload();
  });

  it("pins blank, short-alpha, and greeting chatter boundaries", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const cases = [
      { contentNormalized: " \t ", label: "chatter", confidence: 0, scores: { chatter: 1 } },
      { contentNormalized: "blip", label: "chatter", confidence: 0, scores: { chatter: 1 } },
      { contentNormalized: "blips", label: "unclassified", confidence: 0, scores: { tip: 0 } },
      {
        contentNormalized: `hello ${"x".repeat(13)}`,
        label: "chatter",
        confidence: 0,
        scores: { chatter: 1 },
      },
      {
        contentNormalized: `hello ${"x".repeat(14)}`,
        label: "unclassified",
        confidence: 0,
        scores: { tip: 0 },
      },
    ] as const;
    for (const { contentNormalized, ...expected } of cases) {
      const out = await c.classify({ contentNormalized, channelLabel: "stfc-chat" });
      assert.deepEqual(out, { ...expected, method: "heuristic" });
    }
    await c.unload();
  });

  it("caps accumulated STFC vocabulary confidence at 0.85", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized: "Armada hostile crew officer shipyard research blueprint.",
      channelLabel: "stfc-strategy",
    });
    assert.deepEqual(out, {
      label: "tip",
      confidence: 0.85,
      method: "heuristic",
      scores: { tip: 0.85 },
    });
    await c.unload();
  });
});

describe("classifier / confidence floor → unclassified", () => {
  beforeEach(stubFetch);
  afterEach(restoreFetch);

  it("borderline message with no STFC vocabulary returns confidence < 0.55 → unclassified", async () => {
    // The heuristic-only path falls back to tier-2; tier-2 in heuristic-only
    // mode (no real model loaded) returns "unclassified" — never a fabricated
    // confident label. Callers (the orchestrator + the digest writer) MUST
    // filter `unclassified` and `chatter` from any digest output.
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized:
        "anyone else lagging in beta quadrant tonight after that big patch download finished",
      channelLabel: "stfc-chat",
    });
    // Either the tier-1 heuristic emits a low-confidence label that's downgraded
    // to "unclassified", or the message survives tier-1 to be classified by
    // tier-2; in heuristic-only mode tier-2 emits "unclassified".
    assert.ok(
      out.label === "unclassified" || out.confidence < 0.55,
      `expected unclassified or below floor; got label=${out.label} conf=${out.confidence}`,
    );
    if (out.confidence < 0.55) {
      assert.equal(out.label, "unclassified");
    }
    assert.equal(fetchCallCount, 0);
    await c.unload();
  });

  it("classifies a short acknowledgement as chatter before digest filtering", async () => {
    // Digest filtering is asserted by tests/digest/digest.test.ts; this pins the
    // classifier's own observable result instead of claiming caller coverage.
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized: "ok",
      channelLabel: "stfc-chat",
    });
    // "ok" is sub-20-char chatter; the orchestrator filters these out before
    // building Tip[] entries.
    assert.deepEqual(out, {
      label: "chatter",
      confidence: 0,
      method: "heuristic",
      scores: { chatter: 1 },
    });
    await c.unload();
  });
});

// Defensive use of types in this file (TS narrowing aid).
type _UnusedClassifier = Classifier;
