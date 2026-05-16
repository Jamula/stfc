# Phase 1 Data Model — Discord Community Monitor

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13

TypeScript-flavored shapes. Authoritative zod schemas live in
`contracts/state-files.contract.md` and (at implementation time) in
`src/discord/schemas.ts` (mirroring the `src/api/schemas.ts` convention).

PII rule (applies to every entity below): **No author Discord IDs, no email
addresses, no phone numbers, no real names. Author display names are recorded
verbatim only inside `IngestedMessage.authorDisplay` and only because they are
already publicly visible in the source channel; they are NEVER surfaced into
the digest beyond the source jump-link.** Hashes used for dedup are SHA-256
(truncated to first 16 hex chars where space matters).

---

## 1. `IngestedMessage`

In-memory only — the snapshot of a single Discord message used during one
ingestion pass. Not persisted (only its derived `tipsSeen` hash, candidate
extractions, and cursor advancement are persisted).

```ts
interface IngestedMessage {
  channelId: string;            // Discord snowflake
  channelLabel: string;         // operator-friendly label from allow-list
  messageId: string;            // Discord snowflake
  timestamp: string;            // ISO 8601 UTC
  editedTimestamp: string | null;
  authorDisplay: string;        // public display name; never written to digest
  contentRaw: string;           // verbatim, pre-normalization
  contentNormalized: string;    // post-strip-markdown, post-zero-width-collapse
  jumpLink: string;             // https://discord.com/channels/{guild}/{ch}/{msg}
}
```

**Storage:** none (transient). **Format:** N/A.

---

## 2. `CandidateCode`

A code-shaped string extracted from one or more messages. Persisted to
`data/discord/candidates.jsonl` (append-only).

```ts
type CandidateStatus =
  | "pending"          // newly extracted, not yet attempted
  | "redeemed"         // upstream returned success
  | "already-known"    // present in promo-codes.txt at extraction time
  | "code-already-used"// upstream returned CODE_ALREADY_USED
  | "invalid-or-expired" // upstream returned CODE_INVALID_OR_EXPIRED
  | "transient-failure"  // upstream TransientError; will retry next run
  | "duplicate"        // matches a prior CandidateCode.value seen this monitor
  | "deferred-cap"     // exceeded per-run auto-commit cap (R5)
  | "suppressed-cooldown"; // re-seen during FR-009 cool-down

interface CandidateCode {
  value: string;                  // normalized, uppercased
  firstSeen: string;              // ISO UTC
  lastAttempted: string | null;   // ISO UTC
  suppressedUntil: string | null; // ISO UTC; FR-009
  extractionConfidence: number;   // 0..1
  status: CandidateStatus;
  source: {
    messageId: string;
    channelId: string;
    channelLabel: string;
    timestamp: string;
    jumpLink: string;
  };
  perAccountOutcome: Array<{      // FR-013; populated after redeem run
    accountName: string;
    runId: string;
    outcome: string;              // exact key from src/lib/outcomes.ts
    attemptedAt: string;
  }>;
}
```

**Storage:** `data/discord/candidates.jsonl` — one JSON object per line,
append-only. Status updates are written as new lines with the same `value`;
the latest line per value wins. (Tombstone-style; idempotent.)
**Schema:** see `contracts/state-files.contract.md` § candidates.

---

## 3. `RedemptionResult`

Not a separate persisted entity — flows through the existing
`src/lib/outcomes.ts` taxonomy and is folded into
`CandidateCode.perAccountOutcome[]`. Defined here for clarity of the
seam crossing into the existing redeemer:

```ts
interface RedemptionResult {
  code: string;
  accountName: string;
  runId: string;
  attemptedAt: string;            // ISO UTC
  outcome:                        // exhaustive, mirrors src/lib/outcomes.ts
    | "REDEEMED"
    | "CODE_ALREADY_USED"
    | "CODE_INVALID_OR_EXPIRED"
    | "TOKEN_EXPIRED"
    | "TRANSIENT"
    | "UNKNOWN_RESULT";
  // Raw upstream body MUST NOT be carried here (FR-025 / Principle VII).
  responseSummary: string;        // pre-redacted via src/lib/redact.ts
}
```

**Storage:** consumed by the digest writer; persisted only as folded entries
in `CandidateCode.perAccountOutcome` (entity 2).

---

## 4. `Tip`

A non-code message classified as useful guidance. Surfaces directly into the
day's digest; the dedup hash is also persisted to `tips-seen.jsonl`.

```ts
type TipCategory =
  | "tip" | "trick" | "hack"
  | "event-info" | "patch-note"
  | "chatter" | "unclassified";   // chatter/unclassified are NEVER surfaced

interface Tip {
  category: TipCategory;
  confidence: number;             // 0..1; floor 0.55 (R2)
  excerpt: string;                // verbatim, FR-019; max 600 chars + "…" if longer
  source: {
    messageId: string;
    channelId: string;
    channelLabel: string;
    timestamp: string;            // ISO UTC
    jumpLink: string;
  }[];                            // multiple if FR-018 dedup collapsed
  contentHash: string;            // sha256(normalizedContent).slice(0, 16)
  classifierMethod: "heuristic" | "zero-shot-deberta-xsmall";
}
```

Excluded from `Tip` entirely (per FR-020): messages flagged as personal
attack / drama / NSFW by the heuristic moderation layer. Such messages are
silently dropped and counted only in `RunHealth.dropped.moderation`.

**Storage:** transient (folded into the day's digest). Only the
`contentHash` is persisted to `data/discord/tips-seen.jsonl` for cross-day
dedup.
**Schema:** see `contracts/state-files.contract.md` § tips-seen.

---

## 5. `DailyDigest`

The 24-hour roll-up artifact (FR-022).

```ts
interface DailyDigest {
  date: string;                   // YYYY-MM-DD UTC
  generatedAt: string;            // ISO UTC; updated on every same-day re-run
  windowStart: string;            // ISO UTC = date + 00:00:00Z
  windowEnd: string;              // ISO UTC = date + 24:00:00Z (exclusive)
  runIds: string[];               // every monitor runId that contributed today
  codes: {
    redeemed: Array<{ code: string; accounts: string[]; source: SourceRef }>;
    failed: Array<{ code: string; outcome: string; source: SourceRef }>;
    alreadyKnown: Array<{ code: string; source: SourceRef }>;
    deferredCap: Array<{ code: string; source: SourceRef }>;
  };
  tips: Array<Tip>;               // grouped by category in render
  health: RunHealth;
}

interface SourceRef {
  channelLabel: string;
  timestamp: string;
  jumpLink: string;
}
```

**Storage:** `data/digests/YYYY-MM-DD.md` (rendered Markdown, not JSON).
The Markdown file is the source of truth; on idempotent re-run the writer
re-renders the entire file from the union of (a) prior file's parsed state
section + (b) this run's contributions. See `contracts/digest-writer.contract.md`.

---

## 6. `IngestionCursor`

Per-channel high-water mark.

```ts
interface IngestionCursorMap {
  [channelId: string]: {
    channelLabel: string;
    lastMessageId: string;        // Discord snowflake
    lastTimestamp: string;        // ISO UTC
    lastRunId: string;
    lastRunAt: string;            // ISO UTC
  };
}
```

**Storage:** `data/discord/cursors.json` (single JSON object, pretty-printed
with 2-space indent for readable diffs).
**Schema:** see `contracts/state-files.contract.md` § cursors.

---

## 7. `AllowlistEntry`

```ts
interface DiscordAllowlist {
  version: 1;
  entries: Array<{
    serverId: string;             // Discord guild snowflake
    serverLabel: string;
    channelId: string;
    channelLabel: string;
    addedAt: string;              // ISO UTC
    addedBy: string;              // GitHub handle from the PR that added it
    enabled: boolean;             // false → skip ingestion without removing
  }>;
}
```

**Storage:** `config/discord-allowlist.json`. Initial state at launch:
`{ "version": 1, "entries": [] }`. Empty allow-list is a valid state
(FR-001) — the skill no-ops the Discord half and emits a health note.
**Schema:** see `contracts/state-files.contract.md` § allowlist.

---

## 8. `OperatorSuppressionRule`

Operator-curated allow/deny rules for known code patterns.

```ts
interface OperatorSuppressionMap {
  [normalizedCodeValue: string]: {
    action: "deny" | "allow";       // deny = suppress; allow = override a cooldown
    reason: string;                 // operator-provided explanation
    addedAt: string;                // ISO UTC
    addedBy: string;                // operator identifier (e.g., GitHub handle)
  };
}
```

**Storage:** `data/discord/suppression.json`.
**Writer:** human operator (manual edit, reviewed PR). Feature code MUST NOT
write to this file.
**Schema:** see `contracts/state-files.contract.md` § suppression.

---

## 9. `CandidateCooldown`

Tracks codes in cool-down after redemption failure (FR-009).

```ts
interface CooldownMap {
  [normalizedCodeValue: string]: {
    firstFailedAt: string;        // ISO UTC
    lastFailedAt: string;
    suppressedUntil: string;      // ISO UTC; default firstFailedAt + 30d
    failureOutcomes: string[];    // appended over time, capped at last 5
  };
}
```

**Storage:** `data/discord/cooldowns.json`.
**Writer:** feature code at `src/discord/` (the candidate-redemption pipeline).
**Schema:** see `contracts/state-files.contract.md` § cooldowns.
**Cool-down value:** 30 days (FR-009 default confirmed in plan).

---

## 10. `RunHealth`

Per-run counters surfaced in the digest health section AND the GitHub Job
Summary (FR-027).

```ts
interface RunHealth {
  runId: string;
  startedAt: string;
  finishedAt: string;
  channelsConfigured: number;
  channelsRead: number;
  channelsErrored: Array<{ channelId: string; errorClass: string }>;
  messagesScanned: number;
  candidatesExtracted: number;
  candidatesSubmitted: number;    // passed to redeemer
  candidatesSuppressedDedup: number;
  candidatesSuppressedCooldown: number;
  candidatesDeferredCap: number;
  tipsClassified: { tip: number; trick: number; hack: number;
                    "event-info": number; "patch-note": number };
  dropped: { moderation: number; lowConfidence: number; chatter: number };
  errorsByClass: Record<string, number>;  // e.g. "DiscordRateLimit": 2
  modelLoaded: { name: string; sha256Verified: boolean; loadMs: number };
}
```

**Storage:** folded into `DailyDigest.health` (in the rendered Markdown
under a `## Ingestion Health` section). Not separately persisted.

---

## Cross-entity invariants

1. `CandidateCode.value` and `IngestionCursor[*].lastMessageId` are the only
   identifiers carried across runs. No author IDs persisted, ever.
2. `Tip.excerpt` ≤ 600 chars; longer messages are truncated with `…` and the
   full body is reachable only via `source[].jumpLink` (Principle VII).
3. Every persisted entity that contains a string derived from upstream
   message content MUST have passed the moderation filter (FR-020).
4. Every error string written to any of the above MUST have transited
   `src/lib/redact.ts` (FR-029, Principle I).
