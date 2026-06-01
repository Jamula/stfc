// Knowledge-base embedding pipeline for the crew optimizer v2.
//
// Three responsibilities:
//   1. Chunk three sources — docs/stfc-game-knowledge.md, data/crew/officers.json,
//      and data/crew/tasks/*.yaml — into citation-anchored slices.
//   2. Embed each chunk with a pluggable embedder (MiniLM-class by default,
//      injectable for tests) and persist the cache to
//      data/crew/knowledge-embeddings.json.
//   3. Retrieve the top-k chunks for a free-form query via cosine similarity.
//
// The handler at src/crew/handlers/knowledge.ts is a thin wrapper that
// loads the cache, embeds the user query, and renders top-3 with citations.
// Retrieval is intentionally non-generative — no LLM is invoked.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Versioned chunker identity — bump when chunking semantics change so caches invalidate. */
export const CHUNKER_VERSION = "v1";

/** Default embedding dimensionality (MiniLM-L6-v2 produces 384-dim vectors). */
export const EMBEDDING_DIM = 384;

/** Default model identifier; pluggable via the embedder interface for tests. */
export const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export const DEFAULT_KNOWLEDGE_DOC_PATH = path.join("docs", "stfc-game-knowledge.md");
export const DEFAULT_OFFICERS_PATH = path.join("data", "crew", "officers.json");
export const DEFAULT_TASKS_DIR = path.join("data", "crew", "tasks");
export const DEFAULT_EMBEDDINGS_PATH = path.join("data", "crew", "knowledge-embeddings.json");

const TARGET_CHUNK_CHARS = 500;
const CHUNK_OVERLAP_CHARS = 100;

export interface KnowledgeChunk {
  /** Source file path relative to repo root (used in citations). */
  source: string;
  /** 1-indexed inclusive start line. */
  startLine: number;
  /** 1-indexed inclusive end line. */
  endLine: number;
  /** Chunk text (rendered into the response on top match). */
  text: string;
}

export interface EmbeddedChunk extends KnowledgeChunk {
  embedding: number[];
}

export interface KnowledgeCache {
  model: string;
  chunkerVersion: string;
  sourcesHash: string;
  chunks: EmbeddedChunk[];
}

/** A pluggable embedder. Tests inject a deterministic stub; production uses MiniLM. */
export type Embedder = (text: string) => Promise<number[]>;

export interface SourceFile {
  source: string;
  content: string;
}

export interface KnowledgeBuildInputs {
  knowledgeDoc: SourceFile;
  officers: SourceFile;
  tasks: SourceFile[];
}

// ── Chunking ───────────────────────────────────────────────────────────────

/** Chunk the main markdown knowledge doc by `##` heading, splitting oversized
 *  sections into overlapping ~TARGET_CHUNK_CHARS slices that preserve line anchors. */
export function chunkMarkdown(source: string, content: string): KnowledgeChunk[] {
  const lines = content.split("\n");
  const sections: { startLine: number; endLine: number; lines: string[] }[] = [];

  let current: { startLine: number; lines: string[] } | null = null;

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    const isHeading = /^##\s/.test(line);
    if (isHeading) {
      if (current) {
        sections.push({
          startLine: current.startLine,
          endLine: lineNumber - 1,
          lines: current.lines,
        });
      }
      current = { startLine: lineNumber, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Preamble before the first heading.
      current = { startLine: lineNumber, lines: [line] };
    }
  });

  if (current) {
    const tail = current as { startLine: number; lines: string[] };
    sections.push({
      startLine: tail.startLine,
      endLine: tail.startLine + tail.lines.length - 1,
      lines: tail.lines,
    });
  }

  const chunks: KnowledgeChunk[] = [];
  for (const section of sections) {
    const trimmed = section.lines.join("\n").trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length <= TARGET_CHUNK_CHARS * 1.5) {
      chunks.push({
        source,
        startLine: section.startLine,
        endLine: section.endLine,
        text: trimmed,
      });
      continue;
    }

    // Oversized section: split into overlapping sub-chunks while tracking
    // per-line offsets so the citation range stays accurate.
    const lineOffsets: number[] = [];
    let runningOffset = 0;
    for (const line of section.lines) {
      lineOffsets.push(runningOffset);
      runningOffset += line.length + 1; // +1 for the joining "\n"
    }
    const sectionText = section.lines.join("\n");

    let cursor = 0;
    while (cursor < sectionText.length) {
      const sliceEnd = Math.min(cursor + TARGET_CHUNK_CHARS, sectionText.length);
      const slice = sectionText.slice(cursor, sliceEnd).trim();
      if (slice.length > 0) {
        const startLine = section.startLine + offsetToLine(cursor, lineOffsets);
        const endLine = section.startLine + offsetToLine(sliceEnd - 1, lineOffsets);
        chunks.push({ source, startLine, endLine, text: slice });
      }
      if (sliceEnd >= sectionText.length) break;
      cursor = sliceEnd - CHUNK_OVERLAP_CHARS;
      if (cursor < 0) cursor = 0;
    }
  }

  return chunks;
}

function offsetToLine(offset: number, lineOffsets: number[]): number {
  // Returns the 0-indexed line within the section that contains `offset`.
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Chunk the officers JSON into one chunk per officer entry. Line anchors
 *  approximate the location of each officer in the source file. */
export function chunkOfficers(source: string, content: string): KnowledgeChunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // Anchor each officer to the line where its `"id":` field appears.
  const lines = content.split("\n");
  const idLineFor = new Map<string, number>();
  lines.forEach((line, idx) => {
    const match = line.match(/"id"\s*:\s*"([^"]+)"/);
    if (match && !idLineFor.has(match[1]!)) idLineFor.set(match[1]!, idx + 1);
  });

  const chunks: KnowledgeChunk[] = [];
  for (const entry of parsed as Array<Record<string, unknown>>) {
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) continue;
    const name = typeof entry.name === "string" ? entry.name : id;
    const faction = typeof entry.faction === "string" ? entry.faction : "unknown";
    const role = typeof entry.bda_role === "string" ? entry.bda_role : "unknown";
    const groups = Array.isArray(entry.synergy_groups)
      ? (entry.synergy_groups as string[]).join(", ")
      : "";
    const captain = renderAbility(entry.captain_maneuver);
    const officer = renderAbility(entry.officer_ability);
    const text = [
      `Officer ${name} (id: ${id})`,
      `Faction: ${faction}. Role: ${role}.`,
      `Synergy groups: ${groups || "none"}.`,
      `Captain maneuver: ${captain}`,
      `Officer ability: ${officer}`,
    ].join("\n");

    const startLine = idLineFor.get(id) ?? 1;
    // End line: scan forward until we find the matching brace at depth zero.
    const endLine = findOfficerEndLine(lines, startLine - 1);
    chunks.push({ source, startLine, endLine, text });
  }
  return chunks;
}

function renderAbility(value: unknown): string {
  if (!value || typeof value !== "object") return "n/a";
  const v = value as Record<string, unknown>;
  const text = typeof v.text === "string" ? v.text : "n/a";
  const tags = Array.isArray(v.tags) ? (v.tags as string[]).join(", ") : "";
  return tags ? `${text} (tags: ${tags})` : text;
}

function findOfficerEndLine(lines: string[], fromIdx: number): number {
  // Walk backwards from fromIdx to find the enclosing `{`, then forward to
  // its matching `}`. Conservative bound: cap at fromIdx + 60.
  let openIdx = fromIdx;
  for (let i = fromIdx; i >= Math.max(0, fromIdx - 20); i--) {
    if (lines[i]?.trimEnd().endsWith("{")) {
      openIdx = i;
      break;
    }
  }
  let depth = 0;
  for (let i = openIdx; i < Math.min(lines.length, openIdx + 60); i++) {
    const line = lines[i] ?? "";
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
  }
  return Math.min(lines.length, openIdx + 30);
}

/** Each task YAML is small (< 30 lines); emit one chunk per file. */
export function chunkTask(source: string, content: string): KnowledgeChunk[] {
  // trimEnd() removes any trailing newline before splitting so length equals
  // the physical last non-empty line number (POSIX files end with \n, giving
  // an extra empty element without the trim — see regression test).
  const lineCount = content.trimEnd().split("\n").length;
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];
  return [{ source, startLine: 1, endLine: lineCount, text: trimmed }];
}

export function buildChunks(inputs: KnowledgeBuildInputs): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  chunks.push(...chunkMarkdown(inputs.knowledgeDoc.source, inputs.knowledgeDoc.content));
  chunks.push(...chunkOfficers(inputs.officers.source, inputs.officers.content));
  for (const task of inputs.tasks) {
    chunks.push(...chunkTask(task.source, task.content));
  }
  return chunks;
}

// ── Hashing & cache identity ───────────────────────────────────────────────

/** Stable cache key. Any drift in source content, model id, or chunker
 *  version produces a different hash → rebuild is required. */
export function hashSources(inputs: KnowledgeBuildInputs, modelId: string): string {
  const hash = createHash("sha256");
  hash.update(`model:${modelId}\n`);
  hash.update(`chunker:${CHUNKER_VERSION}\n`);
  hash.update(`source:${inputs.knowledgeDoc.source}\n`);
  hash.update(inputs.knowledgeDoc.content);
  hash.update("\n");
  hash.update(`source:${inputs.officers.source}\n`);
  hash.update(inputs.officers.content);
  hash.update("\n");
  for (const task of inputs.tasks.slice().sort((a, b) => a.source.localeCompare(b.source))) {
    hash.update(`source:${task.source}\n`);
    hash.update(task.content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

// ── Embedder implementations ───────────────────────────────────────────────

/** Deterministic, network-free fallback embedder. Bag-of-words tokens are
 *  projected into a fixed-dim vector via SHA-256-based feature hashing and
 *  the resulting vector is L2-normalised. This is the embedder used by the
 *  unit-test suite and the committed `data/crew/knowledge-embeddings.json`
 *  artifact so the cache is reproducible without network access.
 *
 *  The query path uses the SAME embedder so cosine similarity is meaningful.
 *  Swap in `MiniLMEmbedder` (below) once the operator has cached MiniLM
 *  weights and `STFC_KNOWLEDGE_MODEL=minilm` is set. */
export function createHashedEmbedder(dim: number = EMBEDDING_DIM): Embedder {
  return async (text: string) => embedHashed(text, dim);
}

export function embedHashed(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;

  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    // First 4 bytes → bucket index; next 4 bytes (sign bit) → +1/-1.
    const bucket = digest.readUInt32BE(0) % dim;
    const sign = (digest.readUInt32BE(4) & 1) === 0 ? 1 : -1;
    vector[bucket] = (vector[bucket] ?? 0) + sign;
  }

  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/** Real MiniLM-L6-v2 embedder via @huggingface/transformers. Lazy-imported
 *  and never invoked in unit tests; intended for the operator-run rebuild
 *  CLI when network + cached weights are available. */
export async function createMiniLMEmbedder(modelId: string = DEFAULT_MODEL_ID): Promise<Embedder> {
  const transformers = await import("@huggingface/transformers");
  const pipe = await transformers.pipeline("feature-extraction", modelId);
  return async (text: string) => {
    const result = (await pipe(text, { pooling: "mean", normalize: true })) as unknown as {
      data: Float32Array | number[];
    };
    return Array.from(result.data);
  };
}

// ── Cache I/O ──────────────────────────────────────────────────────────────

export async function writeCache(cache: KnowledgeCache, cachePath: string = DEFAULT_EMBEDDINGS_PATH): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export async function readCache(cachePath: string = DEFAULT_EMBEDDINGS_PATH): Promise<KnowledgeCache | null> {
  let raw: string;
  try {
    raw = await fs.readFile(cachePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as KnowledgeCache;
}

/** True if the cache is stale relative to the current source hash. */
export function cacheNeedsRebuild(cache: KnowledgeCache | null, sourcesHash: string): boolean {
  if (cache === null) return true;
  if (cache.sourcesHash !== sourcesHash) return true;
  if (cache.chunkerVersion !== CHUNKER_VERSION) return true;
  return false;
}

// ── Build pipeline ─────────────────────────────────────────────────────────

export interface BuildOptions {
  embedder?: Embedder;
  modelId?: string;
  now?: () => Date;
}

export async function buildCache(
  inputs: KnowledgeBuildInputs,
  opts: BuildOptions = {},
): Promise<KnowledgeCache> {
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const embedder = opts.embedder ?? createHashedEmbedder();
  // opts.now is retained in BuildOptions for call-site compatibility but is
  // no longer used now that generatedAt has been removed from the artifact.

  const chunks = buildChunks(inputs);
  const embeddedChunks: EmbeddedChunk[] = [];
  for (const chunk of chunks) {
    const embedding = await embedder(chunk.text);
    embeddedChunks.push({ ...chunk, embedding });
  }

  return {
    model: modelId,
    chunkerVersion: CHUNKER_VERSION,
    sourcesHash: hashSources(inputs, modelId),
    chunks: embeddedChunks,
  };
}

// ── Retrieval ──────────────────────────────────────────────────────────────

export interface RetrievalHit {
  chunk: EmbeddedChunk;
  score: number;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function retrieve(
  query: string,
  cache: KnowledgeCache,
  embedder: Embedder,
  topK: number = 3,
): Promise<RetrievalHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  if (cache.chunks.length === 0) return [];

  const queryVector = await embedder(trimmed);
  const scored: RetrievalHit[] = cache.chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryVector, chunk.embedding),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break by source + startLine so identical scores
    // produce the same ordering across runs.
    if (a.chunk.source !== b.chunk.source) return a.chunk.source.localeCompare(b.chunk.source);
    return a.chunk.startLine - b.chunk.startLine;
  });
  return scored.slice(0, Math.max(0, topK));
}

// ── Source loading (CLI helpers) ───────────────────────────────────────────

export interface SourcePaths {
  knowledgeDocPath?: string;
  officersPath?: string;
  tasksDir?: string;
}

export async function loadInputs(paths: SourcePaths = {}): Promise<KnowledgeBuildInputs> {
  const knowledgeDocPath = paths.knowledgeDocPath ?? DEFAULT_KNOWLEDGE_DOC_PATH;
  const officersPath = paths.officersPath ?? DEFAULT_OFFICERS_PATH;
  const tasksDir = paths.tasksDir ?? DEFAULT_TASKS_DIR;

  const [knowledgeDoc, officers] = await Promise.all([
    fs.readFile(knowledgeDocPath, "utf8"),
    fs.readFile(officersPath, "utf8"),
  ]);
  const taskFiles = (await fs.readdir(tasksDir))
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  const tasks = await Promise.all(
    taskFiles.map(async (file) => ({
      source: path.join(tasksDir, file),
      content: await fs.readFile(path.join(tasksDir, file), "utf8"),
    })),
  );

  return {
    knowledgeDoc: { source: knowledgeDocPath, content: knowledgeDoc },
    officers: { source: officersPath, content: officers },
    tasks,
  };
}

// ── CLI entry ─────────────────────────────────────────────────────────────

export interface RebuildResult {
  status: "rebuilt" | "up-to-date";
  cachePath: string;
  sourcesHash: string;
  chunkCount: number;
}

export async function rebuildCommand(opts: {
  paths?: SourcePaths;
  cachePath?: string;
  force?: boolean;
  embedder?: Embedder;
  modelId?: string;
} = {}): Promise<RebuildResult> {
  const cachePath = opts.cachePath ?? DEFAULT_EMBEDDINGS_PATH;
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const inputs = await loadInputs(opts.paths);
  const sourcesHash = hashSources(inputs, modelId);

  if (!opts.force) {
    const existing = await readCache(cachePath);
    if (!cacheNeedsRebuild(existing, sourcesHash)) {
      return {
        status: "up-to-date",
        cachePath,
        sourcesHash,
        chunkCount: existing!.chunks.length,
      };
    }
  }

  const cache = await buildCache(inputs, { embedder: opts.embedder, modelId });
  await writeCache(cache, cachePath);
  return {
    status: "rebuilt",
    cachePath,
    sourcesHash: cache.sourcesHash,
    chunkCount: cache.chunks.length,
  };
}

async function mainCli(argv: string[]): Promise<number> {
  const cmd = argv[2] ?? "";
  if (cmd !== "rebuild") {
    process.stderr.write(`Usage: tsx src/crew/knowledge.ts rebuild [--force]\n`);
    return 2;
  }
  const force = argv.includes("--force");
  const useMiniLM = process.env.STFC_KNOWLEDGE_MODEL === "minilm";
  const embedder = useMiniLM ? await createMiniLMEmbedder() : createHashedEmbedder();
  const modelId = useMiniLM ? DEFAULT_MODEL_ID : `hashed-bow-${CHUNKER_VERSION}`;

  const result = await rebuildCommand({ force, embedder, modelId });
  process.stdout.write(
    `${result.status}: ${result.cachePath} (${result.chunkCount} chunks, hash ${result.sourcesHash.slice(0, 12)}…)\n`,
  );
  return 0;
}

// CLI guard: only run when invoked directly via `tsx src/crew/knowledge.ts ...`.
// Compares the script's URL to process.argv[1] so the module remains importable
// from tests and from the handler without side effects.
const invokedDirectly = (() => {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return import.meta.url === new URL(`file://${path.resolve(arg1)}`).href;
})();

if (invokedDirectly) {
  mainCli(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${(err as Error).message ?? String(err)}\n`);
      process.exit(1);
    },
  );
}
