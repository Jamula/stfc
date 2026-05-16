// T031 [US2] — Moderation pre-filter (FR-020).
//
// `isExcludedByModeration` runs BEFORE the classifier and drops messages that
// are mass-mention raids, harassment, doxxing, or NSFW. Excluded messages are
// counted in `RunHealth.dropped.moderation` and NEVER reach the classifier
// (so they cannot leak into tips-seen.jsonl or the daily digest).
//
// Operators extend the curated lists below via PR (the patterns are
// intentionally conservative — false negatives are tolerated, false
// positives on legitimate STFC chatter must be vanishingly rare).
//
// Design constraints:
//   - Zero outbound network. Pure regex / string matching.
//   - Inputs are already `contentNormalized` (markdown stripped, zero-width
//     collapsed) — see src/discord/schemas.ts § IngestedMessage.

const RAID_MENTION_RE = /(^|\s)@(everyone|here)\b/i;

const STREET_ADDRESS_RE =
  /\b\d{1,5}\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Sq|Square|Ter|Terrace|Hwy|Highway)\b/i;

// US-style phone formats: 555-867-5309, 555.867.5309, 555 867 5309, (555) 867-5309.
const PHONE_NUMBER_RE =
  /(?:^|[^\d])\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/;

const SELF_HARM_RE = /\b(kys|kill\s+yourself|kill\s+yrself)\b/i;

/**
 * Synthetic placeholder tokens the moderation module recognizes as banned.
 * Tests assert against these so the test file itself contains no real slurs.
 * Operators extend the real curated keyword list in `CURATED_HARASSMENT_RE`
 * via PR.
 */
export const HARASSMENT_KEYWORD_PLACEHOLDERS: readonly string[] = [
  "BANNED_TEST_TOKEN_001",
];

// Operators extend via PR — add curated harassment patterns here. We keep the
// shipped list minimal (placeholder + self-harm); real-world expansion is
// reviewed in a security PR and never lives in the test fixtures.
const CURATED_HARASSMENT_RE = new RegExp(
  HARASSMENT_KEYWORD_PLACEHOLDERS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

export interface ModerationOptions {
  /** Operator-friendly channel label, e.g., "memes-nsfw". Used to honour the
   *  NSFW channel-name convention without inspecting message content. */
  channelLabel?: string;
}

/**
 * Returns true if the message should be excluded from classification and
 * never persisted to tips-seen.jsonl or the digest (FR-020). Counted by the
 * caller in `RunHealth.dropped.moderation`.
 */
export function isExcludedByModeration(
  contentNormalized: string,
  opts: ModerationOptions = {},
): boolean {
  // Channel-level NSFW convention.
  if (opts.channelLabel && /-nsfw$/i.test(opts.channelLabel)) return true;

  // Raid-ping mass mentions.
  if (RAID_MENTION_RE.test(contentNormalized)) return true;

  // Self-harm encouragement.
  if (SELF_HARM_RE.test(contentNormalized)) return true;

  // Curated harassment keyword list.
  if (CURATED_HARASSMENT_RE.test(contentNormalized)) return true;

  // Doxxing — street addresses and phone numbers.
  if (STREET_ADDRESS_RE.test(contentNormalized)) return true;
  if (PHONE_NUMBER_RE.test(contentNormalized)) return true;

  return false;
}
