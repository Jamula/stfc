// T020 [US1] — precision-first STFC promo-code extractor.
//
// The extractor optimizes for precision over recall (FR-006): a missed real
// code is acceptable; a falsely-attempted random string risks burning the
// upstream rate budget on the redeem endpoint. To that end:
//
//   1. Triple-backtick fenced blocks are removed entirely BEFORE tokenization
//      (spec § Edge Cases: "the code format is `XXXXX-YYYYY`" inside docs
//      MUST NOT extract).
//   2. Spoiler tags `||…||`, Markdown bold/italic `**…**` / `*…*` /
//      `__…__` / `_…_`, and zero-width characters (U+200B/C/D, U+FEFF)
//      are stripped from the message body (FR-007).
//   3. Hyphenated tokens (`XXXXX-YYYYY`) split on the hyphen during
//      tokenization — neither half passes (both halves are on the stoplist).
//   4. Each surviving token is upper-cased and tested against
//      `^[A-Z][A-Z0-9]{3,19}$` (the core regex from the contracts).
//   5. Stoplist members are dropped (T019).
//   6. Base confidence is the floor (0.6). Channels whose label contains
//      "code" or "promo" earn a +0.2 context bonus (capped at 1.0).
//   7. Duplicate values within a single message are collapsed.

import { isOnStoplist } from "./stoplist.ts";

export const CORE_CODE_REGEX = /^[A-Z][A-Z0-9]{3,19}$/;

const CONFIDENCE_FLOOR = 0.6;
const CONTEXT_BONUS = 0.2;

const FENCED_BLOCK_RE = /```[\s\S]*?```/g;
const SPOILER_RE = /\|\|([^|]+?)\|\|/g;
const BOLD_RE = /\*\*([^*]+?)\*\*/g;
const ITAL_STAR_RE = /\*([^*]+?)\*/g;
const BOLD_UNDER_RE = /__([^_]+?)__/g;
const ITAL_UNDER_RE = /_([^_]+?)_/g;
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;
// Token boundary: anything that's not [A-Za-z0-9].
const TOKEN_SPLIT_RE = /[^A-Za-z0-9]+/;

export interface ExtractorContext {
  channelLabel: string;
  /** Override the default confidence floor (0.6) for tests. */
  confidenceFloor?: number;
}

export interface ExtractedCandidate {
  /** Normalized (uppercased) candidate value, matches CORE_CODE_REGEX. */
  value: string;
  /** Score >= confidenceFloor; bumped if channelLabel matches code/promo. */
  extractionConfidence: number;
  /** The raw token (pre-uppercase) that produced this candidate. */
  matchedText: string;
}

export function extractCodesFromMessage(
  text: string,
  ctx: ExtractorContext,
): ExtractedCandidate[] {
  const floor = ctx.confidenceFloor ?? CONFIDENCE_FLOOR;

  // (1) Strip fenced blocks first so their internals never reach the tokenizer.
  let body = text.replace(FENCED_BLOCK_RE, " ");

  // (2) Strip Markdown decoration and spoiler tags by replacing wrappers
  //     with the captured content (so the inner text survives).
  body = body
    .replace(SPOILER_RE, "$1")
    .replace(BOLD_RE, "$1")
    .replace(BOLD_UNDER_RE, "$1")
    .replace(ITAL_STAR_RE, "$1")
    .replace(ITAL_UNDER_RE, "$1");

  // (2 cont.) Strip zero-width chars anywhere they appear.
  body = body.replace(ZERO_WIDTH_RE, "");

  // (3+4) Tokenize on non-alphanumeric punctuation/whitespace, then regex test.
  const tokens = body.split(TOKEN_SPLIT_RE).filter((t) => t.length > 0);

  const contextBonus = hasCodeContext(ctx.channelLabel) ? CONTEXT_BONUS : 0;
  const score = Math.min(1, floor + contextBonus);

  const seen = new Set<string>();
  const out: ExtractedCandidate[] = [];
  for (const raw of tokens) {
    const upper = raw.toUpperCase();
    if (!CORE_CODE_REGEX.test(upper)) continue;
    if (isOnStoplist(upper)) continue;
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push({ value: upper, extractionConfidence: score, matchedText: raw });
  }
  return out;
}

function hasCodeContext(channelLabel: string): boolean {
  const l = channelLabel.toLowerCase();
  return l.includes("code") || l.includes("promo");
}
