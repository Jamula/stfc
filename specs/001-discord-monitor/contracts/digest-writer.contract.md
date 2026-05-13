# Contract: Daily Digest Writer

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13

## Function interface

```ts
// src/discord/digest.ts (target location)

export interface DigestInput {
  date: string;                    // YYYY-MM-DD UTC
  runId: string;
  codes: DailyDigest["codes"];
  tips: Tip[];
  health: RunHealth;
}

export interface DigestWriteResult {
  filePath: string;                // data/digests/YYYY-MM-DD.md
  bytesWritten: number;
  mode: "created" | "merged-idempotent";
}

export function writeDigest(input: DigestInput): Promise<DigestWriteResult>;
```

## Output file path

- **Path:** `data/digests/${YYYY-MM-DD}.md` where the date is the **UTC
  date at run start** (FR-022). A run that starts at 23:55 UTC writes to
  that day's file even if it finishes at 00:01 UTC the next day —
  prevents a single ingestion pass from being split across two files.
- **Encoding:** UTF-8, LF line endings, no BOM.
- **Permissions:** committed to git on `main`.

## Idempotency rules (FR-022)

The writer is **strictly idempotent on (date, deduped-content-set)**. On
a same-day re-run:

1. Read the existing `data/digests/YYYY-MM-DD.md` if present.
2. Parse the prior `## Codes` and `## Tips` sections back into structured
   form via the embedded JSON state block (see § State block below).
3. Union the prior state with this run's `DigestInput`:
   - Codes are deduped by `code` value; the most recent outcome wins.
   - Tips are deduped by `contentHash` (cross-run dedup).
   - `health.runIds[]` is the union; per-counter values are summed.
   - `generatedAt` is updated to the current ISO UTC timestamp.
4. Re-render the entire file from the unioned state. The file is fully
   rewritten, not appended-to. This guarantees byte-stability when
   nothing new arrives (a no-op run produces an identical file → empty
   git diff → no commit needed).
5. Compare the rendered bytes to the file on disk; only write if different.

## File format

```markdown
# STFC Discord Monitor Digest — 2026-05-13 (UTC)

_Last updated: 2026-05-13T18:04:00Z · Runs: 6 · Source: discord-monitor skill_

## Codes redeemed (3)

| Code | Accounts | Source |
|------|----------|--------|
| EXAMPLE1 | acct-a, acct-b | #stfc-codes · 2026-05-13T02:14Z · [jump](https://discord.com/channels/.../...) |

## Codes attempted but not redeemed (1)

| Code | Outcome | Source |
|------|---------|--------|
| BADCODE | CODE_INVALID_OR_EXPIRED | #stfc-chat · 2026-05-13T03:00Z · [jump](...) |

## Tips & tricks (5)

### tip
> Verbatim excerpt of the message, ≤ 600 chars …

— #stfc-strategy · 2026-05-13T05:30Z · [jump](...)

### trick
…

## Ingestion health

- Channels read: 7 / 8 (1 errored: 403 Forbidden)
- Messages scanned: 1,243
- Candidates extracted: 4
- Candidates submitted to redeemer: 3 (1 suppressed by cool-down)
- Tips classified: tip=3, trick=1, hack=1
- Dropped: moderation=2, low-confidence=11, chatter=1,205
- Errors by class: DiscordRateLimit=0, ClassifierTimeout=0
- Model: Xenova/nli-deberta-v3-xsmall (sha256 verified · loaded in 1.8s)

<!--
DIGEST_STATE_V1 (do not edit by hand; re-rendered by the digest writer)
{ "date": "...", "codes": {...}, "tips": [...], "health": {...} }
-->
```

## State block

The HTML-comment-fenced JSON at the bottom is the round-trip source of
truth for idempotency. It MUST:

- Be a single-line minified JSON object beginning with the literal token
  `DIGEST_STATE_V1` on its own comment line.
- Be regenerated on every write.
- Be the only place author Discord IDs and message IDs appear (still
  no usernames beyond display name; still no PII per § data-model.md).
- Be SHA-256-stable for an identical input set so re-runs produce
  identical bytes.

## Forbidden contents (FR-025, Principle VII)

- No JWT-shaped strings.
- No `STFC_ACCOUNTS`, no `DISCORD_BOT_TOKEN`, no GitHub PAT, no
  Scopely password.
- No raw upstream STFC API response bodies; only the outcome key from
  `src/lib/outcomes.ts` and a redacted `responseSummary`.
- No author Discord IDs in human-rendered sections (the state block may
  include channel/message IDs because they form the jump-link URL anyway,
  which is already public).

The CI artifact-hygiene scanner (`scripts/check-artifact-hygiene.mjs`)
already covers `specs/`, `plans/`, `.specify/`, `docs/`, and `.github/`.
**Plan amendment:** extend the scanner's path list to also include
`data/digests/**/*.md` so the daily digest is scanned on every PR that
touches it (auto-commit PRs from the workflow trigger the same gate).
This is captured as a task in `/speckit.tasks`.

## Failure modes

| Condition                                  | Behavior                                              |
|--------------------------------------------|-------------------------------------------------------|
| Existing file missing the state block      | Treat as `mode: "created"`; previous file is overwritten with a re-render from current input only; warning logged. |
| State block JSON unparseable               | Same as above; warning escalated to the run-health report. |
| Render bytes identical to disk             | Skip write entirely; return `bytesWritten: 0`, `mode: "merged-idempotent"`. |
| File write throws                          | Bubble error; workflow exits non-zero (run-health is lost for this run). |
