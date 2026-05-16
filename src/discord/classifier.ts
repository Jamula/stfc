// T032/T033 [US2] — Local tip classifier (heuristic tier-1 + zero-shot tier-2).
//
// Contract: specs/001-discord-monitor/contracts/classifier.contract.md
//
// PRIVACY INVARIANT (FR-016 / FR-017 / Picard Condition 5):
//   `classify()` MUST NEVER issue an outbound HTTP call. The only network
//   activity allowed in this module is a one-time model download inside
//   `load()` to `huggingface.co` (transformers.js cache); the SHA-256 of the
//   downloaded weight is verified against `config/classifier-model.json` and
//   a mismatch fails the run.
//
// TIER GATING (heuristic-only vs full):
//   `config/classifier-model.json` ships with a placeholder `weightSha256`
//   (all zeros). When the placeholder is detected, `load()` SKIPS the
//   huggingface fetch entirely and the classifier runs in heuristic-only
//   mode (tier-1 only; any tier-1 fall-through returns `unclassified`).
//   To enable tier-2:
//     1. Operator downloads the model locally: `npx @xenova/transformers`
//        or runs the skill once in a sandboxed environment with network.
//     2. Operator computes `sha256sum ~/.cache/huggingface/.../model.onnx`.
//     3. Operator updates `config/classifier-model.json#weightSha256`.
//   The unit tests in tests/discord/classifier.test.ts ONLY exercise the
//   heuristic path, so CI passes without network access.
//
// LIFECYCLE (from the contract):
//   1. Skill boot → read config → probe cache → verify or download + verify.
//   2. First `classify()` call triggers `load()` if not already loaded.
//   3. Process exit → `unload()` from a finally block (~140 MB freed).

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { ClassifierModelSchema, type ClassifierModel } from "./schemas.ts";

// ── Public types (mirrors classifier.contract.md) ───────────────────────────

export type TipLabel =
  | "tip"
  | "trick"
  | "hack"
  | "event-info"
  | "patch-note"
  | "chatter"
  | "unclassified";

export interface ClassifierInput {
  contentNormalized: string;
  channelLabel: string;
}

export type ClassifierMethod = "heuristic" | "zero-shot-deberta-xsmall";

export interface ClassifierOutput {
  label: TipLabel;
  confidence: number;
  method: ClassifierMethod;
  scores: Partial<Record<TipLabel, number>>;
}

export interface Classifier {
  load(): Promise<void>;
  classify(input: ClassifierInput): Promise<ClassifierOutput>;
  unload(): Promise<void>;
}

// ── Typed errors ────────────────────────────────────────────────────────────

export class ClassifierLoadError extends Error {
  override readonly name = "ClassifierLoadError";
}

export class ClassifierIntegrityError extends Error {
  override readonly name = "ClassifierIntegrityError";
}

// ── Constants ───────────────────────────────────────────────────────────────

export const CONFIDENCE_FLOOR = 0.55;
export const DEFAULT_MODEL_CONFIG_PATH = "config/classifier-model.json";
const PLACEHOLDER_SHA = "0".repeat(64);

// Heuristic chatter triggers.
const CHATTER_MIN_LEN = 20;
const GREETING_RE = /^\s*(hi|hello|hey|gm|gn|sup|yo|ty|thanks|lol|rofl|wen|f|ok|nice|gg|wtb|wts|wen patch)\b/i;
const SINGLE_EMOJI_RE = /^\s*(?:\p{Extended_Pictographic}\s*){1,3}\s*$/u;
const RAID_MENTION_RE = /(^|\s)@(everyone|here)\b/i;

// Leading-marker patterns. Strong tier-1 signals: confidence 0.9.
const LEADING_MARKERS: Array<{ re: RegExp; label: Exclude<TipLabel, "chatter" | "unclassified"> }> = [
  { re: /^\s*pro\s*tip\s*[:\-—]/i, label: "tip" },
  { re: /^\s*tip\s*[:\-—]/i, label: "tip" },
  { re: /^\s*trick\s*[:\-—]/i, label: "trick" },
  { re: /^\s*hack\s*[:\-—]/i, label: "hack" },
  { re: /^\s*event\s*info\s*[:\-—]/i, label: "event-info" },
  { re: /^\s*patch\s*note(s)?\s*[:\-—]/i, label: "patch-note" },
];

// STFC vocabulary (lower-case substring match). Used as soft-priors when no
// leading marker matches. The token list is intentionally STFC-specific to
// avoid biasing on common English.
const STFC_VOCAB = [
  "armada", "hostile", "crew", "officer", "ship", "shipyard", "crit",
  "loot", "refit", "repair", "latinum", "dilithium", "tritanium", "ore",
  "research", "blueprint", "alliance", "territory", "outpost", "scopely",
  "borg", "augment", "khan", "tilly", "mantis", "defiant", "jellyfish",
  "vidar", "vi'dar", "talios", "reliant", "tritan", "node", "refinery",
  "survey", "mining", "pvp", "buff", "nerf",
];

// ── Heuristic classifier (tier-1 + optional tier-2 hook) ────────────────────

export interface HeuristicClassifierOptions {
  /** Pluggable tier-2 hook. When omitted, the classifier runs in
   *  heuristic-only mode and any tier-1 fall-through emits `unclassified`. */
  tier2?: Classifier;
}

export function createHeuristicClassifier(
  opts: HeuristicClassifierOptions = {},
): Classifier {
  let loaded = false;
  const tier2 = opts.tier2;

  return {
    async load(): Promise<void> {
      if (loaded) return;
      if (tier2) await tier2.load();
      loaded = true;
    },

    async classify(input: ClassifierInput): Promise<ClassifierOutput> {
      if (!loaded) {
        throw new ClassifierLoadError(
          "classifier.classify() called before load() — call load() first per the lifecycle contract",
        );
      }

      const text = input.contentNormalized ?? "";

      // ── Tier-1: chatter heuristics ─────────────────────────────────────
      if (isChatter(text)) {
        return {
          label: "chatter",
          confidence: 0,
          method: "heuristic",
          scores: { chatter: 1 },
        };
      }

      // ── Tier-1: leading-marker labels (strong signal) ──────────────────
      for (const { re, label } of LEADING_MARKERS) {
        if (re.test(text)) {
          return {
            label,
            confidence: 0.9,
            method: "heuristic",
            scores: { [label]: 0.9 } as Partial<Record<TipLabel, number>>,
          };
        }
      }

      // ── Tier-1: soft vocabulary score (fallback) ───────────────────────
      const vocabScore = scoreVocabulary(text);
      if (vocabScore >= CONFIDENCE_FLOOR) {
        return {
          label: "tip",
          confidence: vocabScore,
          method: "heuristic",
          scores: { tip: vocabScore },
        };
      }

      // ── Tier-2 fall-through (if real model loaded) ─────────────────────
      if (tier2) {
        const out = await tier2.classify(input);
        if (out.confidence < CONFIDENCE_FLOOR) {
          return { ...out, label: "unclassified" };
        }
        return out;
      }

      // Heuristic-only mode: anything we can't confidently label is
      // `unclassified`, NEVER fabricated.
      return {
        label: "unclassified",
        confidence: vocabScore,
        method: "heuristic",
        scores: { tip: vocabScore },
      };
    },

    async unload(): Promise<void> {
      if (tier2) await tier2.unload();
      loaded = false;
    },
  };
}

function isChatter(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (RAID_MENTION_RE.test(trimmed)) return true;
  if (SINGLE_EMOJI_RE.test(trimmed)) return true;
  if (trimmed.length < CHATTER_MIN_LEN && GREETING_RE.test(trimmed)) return true;
  if (trimmed.length < CHATTER_MIN_LEN && /^[a-z]{1,4}$/i.test(trimmed)) return true;
  return false;
}

function scoreVocabulary(text: string): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const term of STFC_VOCAB) {
    if (lower.includes(term)) hits++;
  }
  // 0 hits → 0.0; 1 → 0.25; 2 → 0.5; 3+ → 0.75. Capped at 0.85.
  return Math.min(0.85, hits * 0.25);
}

// ── Tier-2 zero-shot wrapper (Xenova/nli-deberta-v3-xsmall) ────────────────
//
// Imported lazily inside `load()` so the heuristic-only path never pulls
// `@xenova/transformers` into memory.

export interface Tier2Options {
  modelConfigPath?: string;
  /** When true, force heuristic-only mode even if the SHA is populated.
   *  Used by integration tests that want to assert "zero fetch". */
  forceSkipDownload?: boolean;
}

interface ZeroShotPipeline {
  (text: string, labels: string[], opts?: { multi_label?: boolean }): Promise<
    { labels: string[]; scores: number[] }
  >;
  dispose?: () => Promise<void>;
}

export async function createTier2Classifier(
  opts: Tier2Options = {},
): Promise<Classifier> {
  const modelConfigPath = opts.modelConfigPath ?? DEFAULT_MODEL_CONFIG_PATH;
  let model: ClassifierModel | null = null;
  let pipeline: ZeroShotPipeline | null = null;
  let loaded = false;

  return {
    async load(): Promise<void> {
      if (loaded) return;
      model = await loadModelConfig(modelConfigPath);

      // Heuristic-only gate: placeholder SHA → skip the download entirely.
      if (model.weightSha256 === PLACEHOLDER_SHA || opts.forceSkipDownload) {
        loaded = true;
        return;
      }

      // Probe the HF cache; if the weight is present, verify; if absent,
      // download then verify. Any failure produces a ClassifierLoadError
      // so the run fails fast (Principle III).
      const weightPath = await probeHuggingFaceWeight(model);
      if (weightPath) {
        await verifyWeightSha(weightPath, model.weightSha256);
      } else {
        // TODO(operator): the download path requires network. The unit-test
        // gate above (placeholder SHA → skip) prevents this branch from
        // executing in CI; when an operator populates a real SHA, the first
        // boot in a network-enabled environment will lazy-load the model
        // via the @xenova/transformers pipeline call below.
        try {
          const transformers = await import("@xenova/transformers");
          const p = await transformers.pipeline(
            "zero-shot-classification",
            model.id,
            { revision: model.revision } as unknown as Record<string, string>,
          );
          pipeline = p as unknown as ZeroShotPipeline;
        } catch (err) {
          throw new ClassifierLoadError(
            `Failed to load tier-2 zero-shot pipeline: ${(err as Error).message}`,
          );
        }
        const downloadedPath = await probeHuggingFaceWeight(model);
        if (!downloadedPath) {
          throw new ClassifierLoadError(
            `Tier-2 model weight not present after download attempt: ${model.id}`,
          );
        }
        await verifyWeightSha(downloadedPath, model.weightSha256);
      }

      loaded = true;
    },

    async classify(input: ClassifierInput): Promise<ClassifierOutput> {
      if (!loaded) {
        throw new ClassifierLoadError(
          "tier-2 classify() called before load()",
        );
      }
      if (!pipeline || !model) {
        // Heuristic-only mode: emit unclassified, never fabricate a label.
        return {
          label: "unclassified",
          confidence: 0,
          method: "heuristic",
          scores: {},
        };
      }
      // Privacy invariant: stub fetch during inference so any accidental
      // network call by the inference pipeline throws loudly.
      const origFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error("classifier tier-2 inference must not fetch");
      }) as unknown as typeof globalThis.fetch;
      try {
        const labels = model.labels;
        const result = await pipeline(input.contentNormalized, labels);
        const scores: Partial<Record<TipLabel, number>> = {};
        for (let i = 0; i < result.labels.length; i++) {
          scores[result.labels[i] as TipLabel] = result.scores[i] ?? 0;
        }
        const top = result.labels[0] as TipLabel;
        const topConf = result.scores[0] ?? 0;
        const label: TipLabel = topConf >= CONFIDENCE_FLOOR ? top : "unclassified";
        return {
          label,
          confidence: topConf,
          method: "zero-shot-deberta-xsmall",
          scores,
        };
      } finally {
        globalThis.fetch = origFetch;
      }
    },

    async unload(): Promise<void> {
      if (pipeline?.dispose) {
        try { await pipeline.dispose(); } catch { /* best-effort */ }
      }
      pipeline = null;
      loaded = false;
    },
  };
}

async function loadModelConfig(filePath: string): Promise<ClassifierModel> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new ClassifierLoadError(
      `Could not read classifier model config at ${filePath}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ClassifierLoadError(
      `Malformed JSON in ${filePath}: ${(err as Error).message}`,
    );
  }
  const valid = ClassifierModelSchema.safeParse(parsed);
  if (!valid.success) {
    throw new ClassifierLoadError(
      `Classifier model config ${filePath} failed schema validation: ${valid.error.message}`,
    );
  }
  return valid.data;
}

async function probeHuggingFaceWeight(
  model: ClassifierModel,
): Promise<string | null> {
  // transformers.js caches under ~/.cache/huggingface/hub/models--{org}--{name}/
  const cacheRoot = process.env.HF_HOME
    ?? path.join(os.homedir(), ".cache", "huggingface");
  const safeId = model.id.replace(/\//g, "--");
  const candidateRoot = path.join(cacheRoot, "hub", `models--${safeId}`);
  try {
    const stat = await fs.stat(candidateRoot);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  return findOnnxWeight(candidateRoot);
}

async function findOnnxWeight(root: string): Promise<string | null> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /\.onnx$/i.test(e.name)) return full;
    }
  }
  return null;
}

async function verifyWeightSha(
  weightPath: string,
  expected: string,
): Promise<void> {
  const buf = await fs.readFile(weightPath);
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== expected) {
    try { await fs.unlink(weightPath); } catch { /* best-effort */ }
    throw new ClassifierIntegrityError(
      `Tier-2 model SHA-256 mismatch at ${weightPath}: expected ${expected}, got ${actual}; bad file deleted`,
    );
  }
}

// ── Default factory used by the orchestrator ───────────────────────────────

/**
 * Default classifier: heuristic tier-1 + tier-2 hook that auto-detects the
 * heuristic-only gate (placeholder SHA → tier-2 stays disabled).
 */
export async function createDefaultClassifier(
  opts: Tier2Options = {},
): Promise<Classifier> {
  const tier2 = await createTier2Classifier(opts);
  return createHeuristicClassifier({ tier2 });
}
