# Skill: embedding-pipeline-review

> Review checklist for any PR that adds a retrieval pipeline (chunker + embedder
> + cache + retriever). Derived from Kirk's review of PR #130 (crew v2
> knowledge pipeline, closes #93) on 2026-06-01.

## When to apply

- PR adds or modifies a chunker, embedder, embedding cache, or cosine/BM25
  retriever.
- PR commits an embeddings artifact under `data/**`.
- PR introduces a pluggable `Embedder` interface or swaps between fallback and
  model-backed embedders.

## The five checks

### 1. Chunker overlap math — walk an oversized section by hand

The chunker must not infinite-loop or skip content when a section exceeds the
target chunk size.

```
Given: section length L = 600, TARGET = 500, OVERLAP = 100
Walk:
  cursor=0,   sliceEnd=min(500,600)=500  → push slice[0,500]
  cursor=400, sliceEnd=min(900,600)=600  → push slice[400,600]
  sliceEnd >= L → break ✅
```

Required properties:
- `TARGET - OVERLAP > 0` (otherwise cursor never advances)
- Termination via `sliceEnd >= len`, NOT `cursor >= len` (the latter loops one
  iteration short and re-pushes the tail)
- Empty slices after `.trim()` skip the push but DO advance the cursor
- Line anchors are tracked separately (binary-search over `lineOffsets`) so
  citation ranges stay accurate even for sub-chunks

### 2. Cache key completeness

List every drift source. Each must be in the hash AND each must trigger
rebuild via the staleness check.

| Drift source | In hash? | In staleness check? |
|---|---|---|
| Source content | ✅ required | (implicit via hash) |
| Model id | ✅ required | (implicit via hash) |
| Chunker version | ✅ required | ✅ defensible belt-and-suspenders |
| File paths (`source:` identifier) | ✅ required | (implicit via hash) |

Required:
- Sorted iteration on directory inputs so file-order shuffles don't invalidate
  the hash (e.g. `tasks.slice().sort((a, b) => a.source.localeCompare(b.source))`)
- No CRLF/LF normalisation needed if CI is LF-only

### 3. Tie-break determinism

The retriever's sort comparator must use **intrinsic chunk properties**
(source path, start line, chunk id), NEVER array index or insertion order.

```ts
scored.sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  if (a.chunk.source !== b.chunk.source) return a.chunk.source.localeCompare(b.chunk.source);
  return a.chunk.startLine - b.chunk.startLine;
});
```

Without this, the retriever flaps across cache rebuilds and tests become
flaky.

### 4. Non-generative invariant (for retrieval-only handlers)

Grep the handler for `${`, `.replace(`, template substitutions on `chunk.text`.
Output must be `chunk.text` verbatim (optionally truncated for display, but
never rewritten). Every byte traceable to a committed source file.

The citation header (e.g. `**source:Lstart-Lend**`) makes traceability
auditable.

### 5. Embedder/cache self-consistency

The cache must record which embedder built it (`cache.model`), and the query
path must select the matching embedder. Otherwise cosine across mismatched
embedding spaces is noise.

```ts
async function defaultEmbedderForCache(cache: KnowledgeCache): Promise<Embedder> {
  if (cache.model === DEFAULT_MODEL_ID) return createMiniLMEmbedder(cache.model);
  return createHashedEmbedder();
}
```

## Patterns worth adopting

- **Lazy import heavy optional deps** — `const transformers = await import("@huggingface/transformers");` inside the factory. Keeps unit-test cold start fast.
- **Commit a reproducible artifact built with the deterministic fallback** — lets CI / new contributors regenerate the exact same bytes without network access. Operators flip to the model-backed embedder via env var.
- **Versioned chunker identity** (`CHUNKER_VERSION = "v1"`) — bump when chunking semantics change so caches invalidate even if source bytes are unchanged.

## Anti-patterns to flag

- **Brace-counting that ignores string literals** in JSON/YAML position-map heuristics — recommend `JSON.parse` + AST positions over raw char counting.
- **Per-query `readFile` of a >100KB cache** — fine if rate-limited at the dispatcher; otherwise add an `mtime`-keyed in-memory cache.
- **Recomputed L2 norms in `cosineSimilarity`** when both vectors are already normalised — micro-overhead but signals the author may not have verified the normalisation contract. Suggest a `dotProductNormalised` fast-path.
- **No env override for the artifact path** when peer handlers in the codebase do offer one — minor consistency gap, file a follow-up.

## Verdict shape

| All five checks pass + LOW findings only | `APPROVE ✅ WITH NOTES` |
| Any check fails (correctness) | `CHANGES_REQUESTED ⚠️` with line refs + minimum-cost fix |
| All five checks pass + zero findings | `APPROVE ✅` |

## Reference review

PR #130 (Jamula/stfc) — Kirk, 2026-06-01.
Comment: https://github.com/Jamula/stfc/pull/130#issuecomment-4589762939
