# Contract: State Files

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13

Authoritative shapes for every committed state file the feature introduces.
Each shape is expressed as a TypeScript type (the runtime validator will be
a `zod` schema in `src/discord/schemas.ts`, mirroring the
`src/api/schemas.ts` convention).

All files are UTF-8, LF, no BOM. JSON files are pretty-printed with 2-space
indent, trailing newline, keys sorted alphabetically at every level (for
deterministic diffs). JSONL files have one JSON object per line, no trailing
comma, append-only.

---

## § allowlist — `config/discord-allowlist.json`

```ts
{
  version: 1;
  entries: Array<{
    serverId: string;          // ^\d{17,20}$  (Discord snowflake)
    serverLabel: string;       // 1..80 chars, human-readable
    channelId: string;         // ^\d{17,20}$
    channelLabel: string;      // 1..80 chars
    addedAt: string;           // ISO 8601 UTC, "Z" suffix
    addedBy: string;           // GitHub handle, no leading "@"
    enabled: boolean;
  }>;
}
```

**Initial committed value (launch):**

```json
{ "version": 1, "entries": [] }
```

Empty `entries` is a valid runtime state — the skill no-ops the Discord
half and still emits a digest with health metrics noting "0 channels
configured" (FR-001).

---

## § cursors — `data/discord/cursors.json`

```ts
Record<string /* channelId */, {
  channelLabel: string;
  lastMessageId: string;       // Discord snowflake
  lastTimestamp: string;       // ISO 8601 UTC
  lastRunId: string;
  lastRunAt: string;           // ISO 8601 UTC
}>
```

**Empty initial value:** `{}` (file may not exist; skill creates on first
successful run).

**Invariants:**
- Keys MUST be present in the current allow-list. Cursor entries for
  removed channels are pruned at end of run.
- `lastTimestamp` MUST monotonically increase per channel across runs.
  A regression is logged as a critical health event and the cursor is
  NOT moved backward.

---

## § candidates — `data/discord/candidates.jsonl`

Append-only log. Each line:

```ts
{
  value: string;               // ^[A-Z][A-Z0-9]{3,19}$
  firstSeen: string;           // ISO UTC
  lastAttempted: string | null;
  suppressedUntil: string | null;
  extractionConfidence: number;  // 0..1
  status: "pending" | "redeemed" | "already-known"
        | "code-already-used" | "invalid-or-expired"
        | "transient-failure" | "duplicate"
        | "deferred-cap" | "suppressed-cooldown";
  source: {
    messageId: string;
    channelId: string;
    channelLabel: string;
    timestamp: string;         // ISO UTC
    jumpLink: string;
  };
  perAccountOutcome: Array<{
    accountName: string;
    runId: string;
    outcome: string;
    attemptedAt: string;       // ISO UTC
  }>;
}
```

**Compaction:** out of scope for v1. File grows monotonically. Revisit at
~10 MB (estimated 18+ months).

---

## § tips-seen — `data/discord/tips-seen.jsonl`

Append-only dedup log for tips (FR-018). Each line:

```ts
{
  contentHash: string;         // ^[a-f0-9]{16}$  (sha256 truncated)
  firstSeenAt: string;         // ISO UTC
  category: "tip" | "trick" | "hack" | "event-info" | "patch-note";
  // No content body, no jump-link, no channel id — hash only.
}
```

The truncated hash is sufficient for cross-day dedup at this scale and
intentionally carries no message metadata, satisfying the PII rule in
data-model.md.

---

## § suppression — `data/discord/suppression.json`

```ts
Record<string /* normalized code value */, {
  firstFailedAt: string;       // ISO UTC
  lastFailedAt: string;
  suppressedUntil: string;     // ISO UTC; default firstFailedAt + 30d
  failureOutcomes: string[];   // most-recent-last, capped at 5
}>
```

**Cool-down value:** 30 days from `firstFailedAt` (FR-009 confirmed in plan).

**Eviction:** entries whose `suppressedUntil < now - 7d` are pruned at end
of run to bound file size.

---

## § classifier-model — `config/classifier-model.json`

```ts
{
  id: string;                  // e.g. "Xenova/nli-deberta-v3-xsmall"
  revision: string;            // HuggingFace revision SHA (40 hex chars)
  weightSha256: string;        // SHA-256 of the .onnx weight file
  task: "zero-shot-classification";
  labels: string[];            // exact set the classifier emits
  confidenceFloor: number;     // 0..1
}
```

This file is read on every run. A change to `id`, `revision`, or
`weightSha256` triggers a model re-download on the next run (cache miss).

---

## Cross-file invariants

1. Every code that appears in `candidates.jsonl` with `status: "redeemed"`
   AND was the source of an auto-commit MUST appear in `promo-codes.txt`
   on `main` after the run. (Auditable: `git grep` the value in both files.)
2. Every channelId referenced in `cursors.json` MUST be present in
   `discord-allowlist.json` with `enabled: true`. (Auditable.)
3. Every `value` in `suppression.json` MUST also appear at least once in
   `candidates.jsonl` with a non-success outcome. (Auditable.)
4. No state file MUST contain any token, password, JWT, PAT, or author
   Discord ID (PII rule, Principle VII).
