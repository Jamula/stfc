import { CORE_CODE_REGEX, extractCodesFromMessage } from "./extractor.ts";
import { isExcludedByModeration } from "./moderation.ts";

export interface RedditPostItem {
  id: string;
  title: string;
  body: string;
  permalink: string;
  publishedAt: string;
  author?: string;
}

export interface RedditCodeCandidate {
  code: string;
  matchedText: string;
  extractionConfidence: number;
  postId: string;
  postTitle: string;
  permalink: string;
  publishedAt: string;
  author?: string;
}

export interface RedditDiscoveryResult {
  postsScanned: number;
  droppedModeration: number;
  candidates: RedditCodeCandidate[];
}

const TRUSTED_REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com"]);
const CONTROL_OR_SPACE_RE = /[\u0000-\u0020\u007F]/;
const ENTRY_RE = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
const LINK_HREF_RE = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i;

function isValidCodePoint(cp: number): boolean {
  return Number.isInteger(cp) && cp >= 1 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return isValidCodePoint(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      return isValidCodePoint(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&amp;/g, "&");
}

function stripHtmlTags(html: string): string {
  const withoutTags = html
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, " ```fenced``` ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags)
    .replace(/[ \t]+/g, " ")
    .trim();
}

function readRawXmlTag(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = re.exec(block);
  if (!match?.[1]) return "";
  return match[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}

function readXmlTag(block: string, tagName: string): string {
  const raw = readRawXmlTag(block, tagName);
  return raw ? decodeHtmlEntities(raw).trim() : "";
}

function normalizeRedditPermalink(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed || CONTROL_OR_SPACE_RE.test(trimmed) || trimmed.startsWith("//")) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = trimmed.startsWith("/")
      ? new URL(trimmed, "https://www.reddit.com")
      : new URL(trimmed);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    !TRUSTED_REDDIT_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    return undefined;
  }
  return parsed.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function normalizeTimestamp(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return new Date(raw * 1000).toISOString();
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return undefined;
}

/**
 * Parse a Reddit Atom/RSS XML feed (e.g. `/r/startrekfleetcommand/new/.rss`)
 * into normalized post records with verified reddit.com permalinks.
 */
export function parseRedditAtomFeed(xml: string): RedditPostItem[] {
  const posts: RedditPostItem[] = [];
  for (const match of xml.matchAll(ENTRY_RE)) {
    const block = match[1] ?? "";
    const id = readXmlTag(block, "id");
    const title = readXmlTag(block, "title");
    const contentRaw = readXmlTag(block, "content") || readXmlTag(block, "summary");
    const body = stripHtmlTags(contentRaw);
    const updatedRaw = readXmlTag(block, "updated") || readXmlTag(block, "published");
    const publishedAt = normalizeTimestamp(updatedRaw);
    const linkMatch = LINK_HREF_RE.exec(block);
    const permalink = normalizeRedditPermalink(decodeHtmlEntities(linkMatch?.[1] ?? ""));
    const authorRawBlock = readRawXmlTag(block, "author");
    const authorName = readXmlTag(authorRawBlock, "name") || undefined;

    if (!id || !title || !permalink || !publishedAt) continue;
    posts.push({
      id,
      title,
      body,
      permalink,
      publishedAt,
      ...(authorName ? { author: authorName } : {}),
    });
  }
  return posts;
}

/**
 * Parse an authenticated Reddit OAuth Data API listing JSON payload
 * (`https://oauth.reddit.com/r/<subreddit>/new.json`).
 */
export function parseRedditListingJson(payload: unknown): RedditPostItem[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Reddit listing payload must be a JSON object.");
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") {
    throw new Error("Reddit listing payload is missing `data`.");
  }
  const children = (data as { children?: unknown }).children;
  if (!Array.isArray(children)) {
    throw new Error("Reddit listing `data.children` must be an array.");
  }

  const posts: RedditPostItem[] = [];
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const item = (child as { data?: Record<string, unknown> }).data;
    if (!item || typeof item !== "object") continue;

    const id = typeof item.name === "string" && item.name ? item.name : typeof item.id === "string" ? item.id : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const body = typeof item.selftext === "string" ? item.selftext.trim() : "";
    const permalink =
      (typeof item.permalink === "string"
        ? normalizeRedditPermalink(item.permalink)
        : undefined) ??
      (typeof item.url === "string" ? normalizeRedditPermalink(item.url) : undefined);
    const publishedAt = normalizeTimestamp(item.created_utc);
    const author = typeof item.author === "string" && item.author !== "[deleted]" ? item.author : undefined;

    if (!id || !title || !permalink || !publishedAt) continue;
    posts.push({
      id,
      title,
      body,
      permalink,
      publishedAt,
      ...(author ? { author } : {}),
    });
  }
  return posts;
}

const PROMO_POST_HINT_RE = /\b(code|codes|promo|redeem|gift|webstore|web\s+store|free)\b/i;

const REDDIT_HEADER_STOPLIST = new Set<string>([
  "CODES",
  "PROMO",
  "REDEEM",
  "WEBSTORE",
  "STORE",
  "GIFT",
  "GIFTS",
  "FREE",
  "CLAIM",
  "PSA",
  "EDIT",
  "UPDATE",
  "OPS",
]);

/**
 * Extract reviewable promo-code candidates from normalized Reddit posts.
 *
 * Precision guardrails:
 *  - Applies the shared moderation filter before extraction.
 *  - Only extracts from posts whose title or body explicitly references promo
 *    codes / webstore redemption so routine ship/officer acronyms in general
 *    gameplay threads are not surfaced as false-positive candidates.
 *  - Requires the original token in the Reddit post to appear in ALL-CAPS
 *    (`CORE_CODE_REGEX.test(matchedText)`) and not be a promo-announcement
 *    header word (`PSA`, `PROMO`, `WEBSTORE`, etc.), eliminating prose noise.
 *  - Collapses duplicate codes across posts while retaining the earliest post
 *    provenance (`permalink` + `publishedAt`). Does NOT trigger auto-redemption.
 */
export function extractRedditPromoCandidates(posts: readonly RedditPostItem[]): RedditDiscoveryResult {
  const ordered = [...posts].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const byCode = new Map<string, RedditCodeCandidate>();
  let droppedModeration = 0;

  for (const post of ordered) {
    const combined = `${post.title}\n${post.body}`.trim();
    if (isExcludedByModeration(combined, { channelLabel: "reddit-stfc" })) {
      droppedModeration += 1;
      continue;
    }
    if (!PROMO_POST_HINT_RE.test(combined)) {
      continue;
    }

    const extracted = extractCodesFromMessage(combined, {
      channelLabel: PROMO_POST_HINT_RE.test(post.title) ? "reddit-promo-codes" : "reddit-stfc",
    });

    for (const candidate of extracted) {
      if (!CORE_CODE_REGEX.test(candidate.matchedText)) continue;
      if (REDDIT_HEADER_STOPLIST.has(candidate.value)) continue;
      if (byCode.has(candidate.value)) continue;
      byCode.set(candidate.value, {
        code: candidate.value,
        matchedText: candidate.matchedText,
        extractionConfidence: candidate.extractionConfidence,
        postId: post.id,
        postTitle: post.title,
        permalink: post.permalink,
        publishedAt: post.publishedAt,
        ...(post.author ? { author: post.author } : {}),
      });
    }
  }

  return {
    postsScanned: posts.length,
    droppedModeration,
    candidates: [...byCode.values()],
  };
}
