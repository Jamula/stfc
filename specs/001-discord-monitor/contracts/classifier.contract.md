# Contract: Local Tip Classifier

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13

## Function interface

```ts
// src/discord/classifier.ts (target location)

export type TipLabel =
  | "tip" | "trick" | "hack"
  | "event-info" | "patch-note"
  | "chatter" | "unclassified";

export interface ClassifierInput {
  contentNormalized: string;     // pre-stripped of markdown / zero-width
  channelLabel: string;          // hint, may bias priors (e.g. #patch-notes)
}

export interface ClassifierOutput {
  label: TipLabel;
  confidence: number;            // 0..1
  method: "heuristic" | "zero-shot-deberta-xsmall";
  scores: Record<TipLabel, number>;  // full distribution from tier-2; partial from tier-1
}

export interface Classifier {
  /** Loads model weights (or no-ops for heuristic-only). Idempotent. */
  load(): Promise<void>;

  /** Synchronous after load(). Throws if called before load(). */
  classify(input: ClassifierInput): Promise<ClassifierOutput>;

  /** Frees model memory; safe to no-op. */
  unload(): Promise<void>;
}
```

## Confidence threshold

- Tier-1 heuristic discards anything scored below 0.4 as `chatter`
  WITHOUT invoking tier-2.
- Tier-2 zero-shot model output:
  - `confidence ≥ 0.55` → emit with reported `label`.
  - `confidence < 0.55` → emit `unclassified` with the raw `scores` map
    (callers MUST NOT surface `unclassified` into the digest).

## Model lifecycle

1. **Boot of the discord-monitor skill:**
   - Read `config/classifier-model.json` for `{ id, revision, weightSha256 }`.
   - Probe the HuggingFace cache directory; if the weight file exists,
     verify its SHA-256 against the pinned value. Mismatch → fatal error,
     do not run.
   - If absent, download via Transformers.js's cache mechanism, then verify
     SHA-256. Mismatch → fatal error, delete the bad file, do not run.
2. **First call to `classify()`** triggers `await load()` if not already loaded.
3. **Process exit:** `unload()` is called from a `finally` block to free
   ~140 MB of RAM promptly (the redeem orchestrator may still need RAM
   headroom in the same workflow run).

## Determinism / drift

- The model id + revision + SHA-256 pin guarantees byte-identical weights
  across runs. Bumping the model is a PR that changes
  `config/classifier-model.json` and refreshes the test fixtures.
- Inference is deterministic on a given input (no sampling; we call
  zero-shot pipeline with `top_k: null`).

## Privacy invariant (FR-016, FR-017)

- **No network calls during `classify()`.** The function MUST NOT issue
  any outbound HTTP except the one-time model download during `load()`.
- This invariant is testable: a unit test stubs `globalThis.fetch` and
  asserts it is never called within `classify()`.

## Moderation pre-filter (FR-020)

A separate function `isExcludedByModeration(contentNormalized): boolean`
runs BEFORE `classify()` and discards messages matching:

- known harassment keyword list (curated, in `src/discord/moderation.ts`),
- `@everyone` / `@here` mass-mention patterns without staff role context,
- Discord's standard NSFW marker conventions (channel name, spoiler-only
  body containing flagged tokens),
- doxxing patterns (street-address regex, phone-number regex).

Excluded messages are counted in `RunHealth.dropped.moderation` and
NEVER reach the classifier.

## Failure modes

| Condition                                  | Behavior                                              |
|--------------------------------------------|-------------------------------------------------------|
| Model file missing AND no network access   | `ClassifierLoadError`, fail the run (Principle III)   |
| Model SHA-256 mismatch                     | `ClassifierIntegrityError`, fail the run, delete file |
| onnxruntime-node native binding missing    | `ClassifierLoadError`, fail the run                   |
| Per-message inference exception            | log via `redactForLog`, treat that message as `chatter`, continue |
| Per-message inference > 5 s                | abort via `AbortSignal`, treat as `chatter`, count in `RunHealth.errorsByClass.classifierTimeout` |
