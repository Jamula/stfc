/**
 * api/_lib/github-raw.ts
 *
 * Typed wrapper for fetching content from Jamula/stfc via the GitHub Contents
 * API with ETag-based caching and optional raw streaming.
 *
 * Phase 1 authentication: GITHUB_TOKEN env var (pat / actions token) for
 * higher rate limits.  Phase 2 will swap to a GitHub App installation token
 * for actions:read.
 *
 * Cache is per-Function-instance — Azure Functions can spin up multiple
 * instances; cache is best-effort, not authoritative.
 */

const GITHUB_API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";
const REPO_OWNER = "Jamula";
const REPO_NAME = "stfc";
const USER_AGENT = "stfc-control-panel/0.1.0";
const DEFAULT_TTL_MS = 60_000;

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  etag: string;
  body: string;   // decoded UTF-8 for fetchContent; JSON string for listDirectory
  sha: string;
  fetchedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** Evict entries older than EVICT_MS to bound memory use.  Separate from the
 *  hot-cache TTL — expired entries are kept long enough for ETag reuse. */
const EVICT_MS = 300_000; // 5 minutes

function evictStale(): void {
  const threshold = Date.now() - EVICT_MS;
  for (const [k, v] of _cache) {
    if (v.fetchedAt < threshold) _cache.delete(k);
  }
}

function cacheKey(
  path: string,
  ref: string | undefined,
  kind: "content" | "dir",
): string {
  return `${kind}:${ref ?? "HEAD"}:${path}`;
}

/** Exposed for test teardown only. */
export function _clearCache(): void {
  _cache.clear();
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];
  const h: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function rateLimitRemaining(res: Response): number | null {
  const v = res.headers.get("x-ratelimit-remaining");
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface ContentResult {
  content: string;
  sha: string;
  etag: string;
  /** True when the response was served from the in-memory ETag cache. */
  cached: boolean;
  /** Value of `x-ratelimit-remaining` from the last actual HTTP response; null
   *  when served from local cache (no network call was made). */
  rateLimitRemaining: number | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
}

export interface DirectoryResult {
  entries: DirectoryEntry[];
  etag: string;
  cached: boolean;
  rateLimitRemaining: number | null;
}

// ── fetchContent ──────────────────────────────────────────────────────────────

/**
 * Fetch a single file from the GitHub Contents API.
 *
 * - Within `ttlMs` of the last fetch: returns the cached value immediately
 *   (no network call, `cached: true`, `rateLimitRemaining: null`).
 * - After `ttlMs`: sends `If-None-Match` with the stored ETag; on 304 refreshes
 *   the TTL clock and returns cached content.
 * - On 200: decodes the base64 `content` field and updates the cache.
 * - On 404: returns `null`.
 * - On other errors: throws.
 *
 * The caller SHOULD check `rateLimitRemaining` and return HTTP 503 +
 * `Retry-After` when the value is below a threshold (e.g. < 10).
 */
export async function fetchContent(
  path: string,
  options: { ref?: string; ttlMs?: number } = {},
): Promise<ContentResult | null> {
  const { ref, ttlMs = DEFAULT_TTL_MS } = options;
  evictStale();

  const key = cacheKey(path, ref, "content");
  const hit = _cache.get(key);
  const now = Date.now();

  // Within TTL — serve hot from cache, no network call.
  // ttlMs > 0 guard: zero means "always revalidate", avoiding a same-millisecond race.
  if (hit && ttlMs > 0 && now - hit.fetchedAt < ttlMs) {
    return {
      content: hit.body,
      sha: hit.sha,
      etag: hit.etag,
      cached: true,
      rateLimitRemaining: null,
    };
  }

  const url =
    `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "");

  const headers: Record<string, string> = { ...authHeaders() };
  if (hit) headers["If-None-Match"] = hit.etag;

  const res = await fetch(url, { headers });
  const rl = rateLimitRemaining(res);

  if (res.status === 304 && hit) {
    // Refresh the TTL clock so the next call within ttlMs is served hot.
    _cache.set(key, { ...hit, fetchedAt: now });
    return { content: hit.body, sha: hit.sha, etag: hit.etag, cached: true, rateLimitRemaining: rl };
  }

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`GitHub Contents API ${res.status}: ${res.statusText} — ${url}`);
  }

  const raw = (await res.json()) as { content: string; sha: string; encoding: string };
  const content = Buffer.from(raw.content.replace(/\n/g, ""), "base64").toString("utf8");
  const etag = res.headers.get("etag") ?? "";

  _cache.set(key, { etag, body: content, sha: raw.sha, fetchedAt: now });
  return { content, sha: raw.sha, etag, cached: false, rateLimitRemaining: rl };
}

// ── listDirectory ─────────────────────────────────────────────────────────────

/**
 * List a directory from the GitHub Contents API.
 *
 * Same ETag / TTL semantics as `fetchContent`.
 * Returns `null` on 404.
 */
export async function listDirectory(
  path: string,
  options: { ref?: string; ttlMs?: number } = {},
): Promise<DirectoryResult | null> {
  const { ref, ttlMs = DEFAULT_TTL_MS } = options;
  evictStale();

  const key = cacheKey(path, ref, "dir");
  const hit = _cache.get(key);
  const now = Date.now();

  if (hit && ttlMs > 0 && now - hit.fetchedAt < ttlMs) {
    return {
      entries: JSON.parse(hit.body) as DirectoryEntry[],
      etag: hit.etag,
      cached: true,
      rateLimitRemaining: null,
    };
  }

  const url =
    `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "");

  const headers: Record<string, string> = { ...authHeaders() };
  if (hit) headers["If-None-Match"] = hit.etag;

  const res = await fetch(url, { headers });
  const rl = rateLimitRemaining(res);

  if (res.status === 304 && hit) {
    _cache.set(key, { ...hit, fetchedAt: now });
    return {
      entries: JSON.parse(hit.body) as DirectoryEntry[],
      etag: hit.etag,
      cached: true,
      rateLimitRemaining: rl,
    };
  }

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`GitHub Contents API ${res.status}: ${res.statusText} — ${url}`);
  }

  const raw = (await res.json()) as Array<{
    name: string;
    path: string;
    sha: string;
    size: number;
    type: string;
  }>;

  const entries: DirectoryEntry[] = raw.map(({ name, path: p, sha, size, type }) => ({
    name,
    path: p,
    sha,
    size,
    type,
  }));

  const etag = res.headers.get("etag") ?? "";
  _cache.set(key, { etag, body: JSON.stringify(entries), sha: "", fetchedAt: now });
  return { entries, etag, cached: false, rateLimitRemaining: rl };
}

// ── streamRawContent ──────────────────────────────────────────────────────────

/**
 * Fetch a file as a raw stream from raw.githubusercontent.com.
 *
 * Intended for larger files (e.g., committed digests).  When `ref` is a
 * commit SHA the URL is immutable and cacheable forever by the CDN.  For
 * branch-name refs, prefer `fetchContent` first to resolve the SHA, then call
 * `streamRawContent` with that SHA for immutable-URL caching.
 *
 * Throws on 404 or other non-OK responses.
 */
export async function streamRawContent(
  path: string,
  options: { ref?: string } = {},
): Promise<{ body: ReadableStream<Uint8Array>; url: string }> {
  const ref = options.ref ?? "main";
  const url = `${RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${ref}/${path}`;

  const token = process.env["GITHUB_TOKEN"];
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  if (res.status === 404) {
    throw new Error(`File not found: ${path} at ref ${ref}`);
  }
  if (!res.ok) {
    throw new Error(`raw.githubusercontent.com ${res.status}: ${res.statusText} — ${url}`);
  }
  if (!res.body) {
    throw new Error(`Response body is null for ${url}`);
  }

  return { body: res.body, url };
}
