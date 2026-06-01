// Discord-facing handler for `!crew knowledge <query>`. Retrieval-only:
// loads the embedding cache, embeds the query with the same embedder that
// produced the cache, and renders the top-3 chunks with line-anchored
// citations. No LLM generation — every byte of output is traceable to a
// committed source file.

import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import {
  CHUNKER_VERSION,
  DEFAULT_EMBEDDINGS_PATH,
  DEFAULT_MODEL_ID,
  createHashedEmbedder,
  createMiniLMEmbedder,
  readCache,
  retrieve,
  type Embedder,
  type KnowledgeCache,
  type RetrievalHit,
} from "../knowledge.ts";

const MAX_DISCORD_CHARS = 1900;
const TRUNCATION_FOOTER = "\n\n_…output truncated to 1900 chars; narrow the query for full details._";
const PREVIEW_CHARS = 320;
const DEFAULT_TOP = 3;
const MAX_TOP = 5;

export interface KnowledgeHandlerDeps {
  cachePath?: string;
  loadCache?: (cachePath: string) => Promise<KnowledgeCache | null>;
  embedderForCache?: (cache: KnowledgeCache) => Promise<Embedder>;
}

export async function handleKnowledge(
  command: CrewCommand,
  deps: KnowledgeHandlerDeps = {},
): Promise<string> {
  const query = readQuery(command);
  if (!query) {
    throw new Error("Usage: !crew knowledge <query> [--top N (1-5)]");
  }
  const top = parseTop(command.args.top);

  const cachePath = deps.cachePath ?? DEFAULT_EMBEDDINGS_PATH;
  const loadCache = deps.loadCache ?? readCache;
  const embedderForCache = deps.embedderForCache ?? defaultEmbedderForCache;

  const cache = await loadCache(cachePath);
  if (!cache) {
    throw new Error(
      `Knowledge cache not found at ${cachePath}. Run \`npm run crew:knowledge:rebuild\`.`,
    );
  }
  if (cache.chunkerVersion !== CHUNKER_VERSION) {
    throw new Error(
      `Knowledge cache chunker version mismatch (cache: ${cache.chunkerVersion}, expected: ${CHUNKER_VERSION}). ` +
        `Run \`npm run crew:knowledge:rebuild\`.`,
    );
  }

  const embedder = await embedderForCache(cache);
  const hits = await retrieve(query, cache, embedder, top);
  return render(query, top, hits);
}

function readQuery(command: CrewCommand): string {
  // Accept either the parser-collected free-form query (args._) OR the
  // first positional token (args._0). Combine remaining positionals so
  // multi-word queries without quoting still work.
  const direct = command.args._?.trim();
  if (direct) return direct;
  const parts: string[] = [];
  for (let i = 0; ; i++) {
    const piece = command.args[`_${i}`];
    if (piece === undefined) break;
    parts.push(piece);
  }
  return parts.join(" ").trim();
}

function parseTop(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TOP;
  if (raw === "true") {
    throw new Error("Flag `--top` requires a value (1-5).");
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP) {
    throw new Error(`Invalid \`--top\` value. Use an integer between 1 and ${MAX_TOP}.`);
  }
  return parsed;
}

async function defaultEmbedderForCache(cache: KnowledgeCache): Promise<Embedder> {
  // The cache records which embedder built it so the query path stays
  // self-consistent. The committed artifact is built with the hashed
  // fallback; operators with cached MiniLM weights can rebuild with
  // STFC_KNOWLEDGE_MODEL=minilm.
  if (cache.model === DEFAULT_MODEL_ID) {
    return createMiniLMEmbedder(cache.model);
  }
  return createHashedEmbedder();
}

function render(query: string, top: number, hits: RetrievalHit[]): string {
  if (hits.length === 0) {
    return [
      `**Crew knowledge — \`${query}\`**`,
      "",
      "_No matches found._ Try fewer or different keywords.",
    ].join("\n");
  }

  const lines: string[] = [
    `**Crew knowledge — \`${query}\`** (top ${Math.min(top, hits.length)})`,
    "",
  ];
  hits.forEach((hit, idx) => {
    const { source, startLine, endLine, text } = hit.chunk;
    const cite = `**${source}:L${startLine}-L${endLine}**`;
    const preview = previewText(text);
    lines.push(`### #${idx + 1} — score ${hit.score.toFixed(3)}`);
    lines.push(`${cite}`);
    lines.push("```text");
    lines.push(preview);
    lines.push("```");
    lines.push("");
  });

  return truncateForDiscord(lines.join("\n").trimEnd());
}

function previewText(text: string): string {
  const collapsed = text.replace(/\r\n/g, "\n");
  if (collapsed.length <= PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, PREVIEW_CHARS).trimEnd()}…`;
}

function truncateForDiscord(markdown: string): string {
  if (markdown.length <= MAX_DISCORD_CHARS) return markdown;
  const keep = Math.max(0, MAX_DISCORD_CHARS - TRUNCATION_FOOTER.length);
  return `${markdown.slice(0, keep)}${TRUNCATION_FOOTER}`;
}
