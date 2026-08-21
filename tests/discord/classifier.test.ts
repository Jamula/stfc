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
import { createHeuristicClassifier } from "../../src/discord/classifier.ts";

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
  });

  it("load() is idempotent", async () => {
    const c = createHeuristicClassifier();
    await c.load();
    await c.load();
    const out = await c.classify({
      contentNormalized: "Tip: research the navigation tree first if you're under ops 30.",
      channelLabel: "stfc-strategy",
    });
    assert.notEqual(out.label, "chatter");
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

  it("unclassified results are not surfaced into digests (caller contract)", async () => {
    // This documents — not enforces — the caller invariant. The digest writer
    // tests in tests/digest/digest.test.ts assert that tips with label
    // `unclassified` or `chatter` are dropped before rendering.
    const c = createHeuristicClassifier();
    await c.load();
    const out = await c.classify({
      contentNormalized: "ok",
      channelLabel: "stfc-chat",
    });
    // "ok" is sub-20-char chatter; the orchestrator filters these out before
    // building Tip[] entries.
    assert.equal(out.label, "chatter");
    await c.unload();
  });
});
