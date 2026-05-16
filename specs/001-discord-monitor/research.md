# Phase 0 Research — Discord Community Monitor

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)

This document records the technology choices that resolve every NEEDS-CLARIFICATION
implied by the spec's Technical Context. Each entry follows: Decision → Rationale →
Alternatives Considered → Source.

---

## R1. Discord client library (Node/TypeScript)

**Decision:** `@discordjs/rest` (^2.5.0) + `discord-api-types` (^0.38.x).
No gateway / WebSocket client. REST-only `GET /channels/{channel.id}/messages`
calls via the bot token.

**Rationale:**
- This feature runs as a 4-hour cron; a persistent gateway connection is the
  wrong shape (it would need a long-lived process and would still need to fetch
  history on resume). REST polling is naturally idempotent and survives missed
  runs via the cursor file (R3).
- `@discordjs/rest` ships rate-limit handling (`Retry-After`, bucket queueing)
  out of the box, satisfying FR-005 with no glue code.
- Install footprint is small: `@discordjs/rest` + `discord-api-types` is
  approximately 7.2 MB on disk including transitive dependencies
  (`@discordjs/rest` 795 KB + `discord-api-types` 3.5 MB + transitive deps ~3 MB)
  vs ~30 MB for the full `discord.js` umbrella package.
  CI install time impact is ≤ 2 s on `npm ci`.
- Apache-2.0 licensed → Principle V / Security & Compliance "license-compatible"
  rule satisfied.

**Alternatives considered:**
- `discord.js` v14 — full client (Gateway + REST + caches). Rejected: 10× the
  install size and brings a Voice/Sharding surface this feature will never use.
- `@discordjs/core` v2 — the higher-level wrapper over `@discordjs/rest`.
  Rejected: thin convenience layer that adds no value for the 1–2 endpoints we
  hit; choosing the lower layer keeps the dependency surface smaller.
- Hand-rolled `fetch` against `https://discord.com/api/v10/...`. Rejected:
  re-implementing 429 bucket handling for one feature is the wrong trade.

**Endpoints used (full set):**
- `GET /api/v10/channels/{channel.id}/messages?after={lastId}&limit=100`
- `GET /api/v10/users/@me` (one-shot, on first run, to confirm token is valid
  and surface the bot's identity into the digest health section)

**Source:** discord.js docs (v14.x), Discord developer docs `messages` resource,
package.json size measured via `npm view @discordjs/rest dist.unpackedSize`.

---

## R2. Local classifier model

**Decision:** Two-tier classifier:

1. **Tier 1 — heuristic pre-filter** (TypeScript, in-repo, no model files).
   Keyword + regex scoring against a curated lexicon of STFC vocabulary
   (`tip`, `trick`, `hack`, `event`, `armada`, `hostile`, `ops`, `crew`,
   ship names from `.squad/knowledge/stfc/database.md`, etc.). Most chatter
   (greetings, raid pings, single-emoji reactions, < 20 char messages) is
   discarded here without ever invoking a model. This alone is expected to
   drop ≥ 70 % of channel volume.
2. **Tier 2 — zero-shot text classification** via `@xenova/transformers`
   (Transformers.js, Apache-2.0, ^2.17.x) running the
   `Xenova/nli-deberta-v3-xsmall` ONNX model (~71 MB on disk, ~140 MB peak
   RAM, ~150 ms / inference on a GitHub-hosted runner CPU). Labels:
   `["tip", "trick", "hack", "event-info", "patch-note", "chatter"]`.
   Confidence floor 0.55; below that → `unclassified`.

**No message text leaves the runner.** Transformers.js executes ONNX locally
via `onnxruntime-node`. There are no remote API calls. (FR-016, FR-017.)

**Vendoring strategy:** **NOT committed to the repo** (71 MB exceeds reasonable
git checkout cost). The model is downloaded on first run via Transformers.js's
built-in HuggingFace cache, then cached in the GitHub Actions cache keyed by
`hash(model-id + revision-sha)`:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/huggingface
    key: hf-Xenova-nli-deberta-v3-xsmall-${{ hashFiles('config/classifier-model.json') }}
```

A small `config/classifier-model.json` file pins the model id, the HuggingFace
revision SHA, and a SHA-256 of the ONNX weight file. The runtime loader MUST
verify the SHA-256 of the downloaded `.onnx` file against the pinned value
before invoking the model; mismatch is a fatal error and fails the workflow.

**Cold-start cost:** ~25 s download on cache miss (one-time per cache key);
~2 s warm load from cache. Acceptable on a 4-hour cron.

**Alternatives considered:**
- Pure heuristic (no model): rejected — spec Q2 explicitly resolved to "local
  small model on the runner", and operator wants tip-quality > pattern-bound.
- Heuristic + tiny logistic head on `Xenova/all-MiniLM-L6-v2` embeddings
  (~22 MB): rejected for v1 because it requires a labeled training set we
  don't have; revisit in v2 if zero-shot quality is poor (SC-003).
- Distilled BERT sentiment (`Xenova/distilbert-base-uncased-finetuned-sst-2`):
  rejected — wrong task (sentiment polarity, not topic).
- LLM API (OpenAI / Anthropic / Cohere): rejected by spec Q2 — "no message
  text leaves the runner".

**Source:** Transformers.js README, HuggingFace model card for
`Xenova/nli-deberta-v3-xsmall`, measured RAM via local Node REPL (recorded in
`.squad/scratch/` during plan; not committed).

---

## R3. Discord ingestion strategy on a 4-hour cron

**Decision:** Per-channel cursor file at `data/discord/cursors.json` committed
to the repo, structured as `Record<channelId, { lastMessageId, lastTimestamp,
lastRunId, channelLabel }>`. On each run, the ingester fetches messages with
`?after=<lastMessageId>` until the response page is empty or the per-channel
hard cap is hit, then persists the new high-water mark.

**Why a committed file (not Actions cache or external KV):**
- Survives runner replacement and cache eviction (Actions cache keys evict
  after 7 days of disuse — would silently re-ingest history on every cold
  start).
- Diffs are reviewable; cursor regressions are a Principle V audit signal.
- Aligns with existing repo-as-source-of-truth pattern (`promo-codes.txt`,
  `data/digests/`).
- Not a secret; safe to commit. File contains only Discord snowflake IDs and
  ISO timestamps — no message content, no author names.

**Cold start (no cursor for a channel):** Read the most recent 100 messages
only (one page). Do NOT walk the full channel history — operator can replay
manually if needed via `--backfill <channelId> --since <iso>` flag on the
skill (out of scope for v1 cron path).

**Missed run handling:** If `now - lastTimestamp > 24 h`, the ingester logs a
"long ingestion gap" warning into the run-health record and caps fetched
messages at 500 per channel per run (5 paginated calls) to bound runtime;
remaining messages are picked up on the next 4-hour run. A note is added to
the day's digest health section.

**Per-channel hard cap:** 500 messages per run (5 × 100 pages). Defends
against a runaway bot in a monitored channel.

**Source:** Discord developer docs, "Get Channel Messages" pagination
contract; existing repo concurrency contract in `.github/workflows/redeem.yml`.

---

## R4. Code extraction patterns

**Decision:** Conservative regex pipeline with three stages:

1. **Strip Markdown decoration**: spoiler tags (`||...||`), code fences
   (` ``` `, single backticks), bold/italic, zero-width chars
   (`\u200b\u200c\u200d\ufeff`).
2. **Tokenize on whitespace and common separator runs** (`,`, `;`, `|`).
3. **Match tokens against the STFC code shape regex**:

```
^[A-Z][A-Z0-9]{3,19}$
```

   - Uppercase A–Z + digits.
   - Length 4–20 inclusive (matches every entry in `promo-codes.txt`:
     `GQ5` is 3 → not matched, `MACHINATIONS` is 12, `CADET` is 5, etc.
     We deliberately reject 3-char tokens because they collide with chat
     abbreviations like "GG"/"WP" too often; operator may add 3-char codes
     to `promo-codes.txt` manually).
   - Must start with a letter to filter out 4-digit raid timers, room
     numbers, etc.

4. **Reject token if it appears in a stop-list**: common English words and
   STFC chat abbreviations (`HELLO`, `THANKS`, `TODAY`, `HOSTILE`, `ARMADA`,
   `STFC`, `KIRK` is intentionally NOT in the stop list — it's a known code
   even though it's a name). Stop-list lives at
   `src/discord/stoplist.ts` and is unit-tested.
5. **Context bonus / penalty** (precision boost):
   - +confidence if surrounded by phrases like "code", "promo", "redeem",
     "claim", "use this", "type", "free".
   - −confidence (suppress) if inside a quoted block that contains the word
     "format" or "example" or "like" within ±40 chars (FR-006: "the code
     format is `XXXXX-YYYYY`" must NOT extract).
6. Emit `CandidateCode` only when normalized confidence ≥ 0.6.

**Sample tokens from `promo-codes.txt` validated against the regex:**
27 of 30 non-comment entries match (`MACHINATIONS`, `SFACPT1`, `FCP2`,
`CNTCT`, `FRACTURE`, `WARPSPEED`, `KIRK`, `SPOCK`, `CADET`, `COMMANDER`,
`FRONTIER`, `WOKPT1`, `SECTION31`, `RENEGADE`, `ROGUE`, `ALTEREGO`,
`REFLECTION`, …). The `TNG`, `GQ5`, and `GQ7` 3-char outliers (3-char gap:
TNG, GQ5, GQ7) are flagged as known recall gaps accepted in v1 (precision >
recall per FR-006).

**Source:** `promo-codes.txt` (30 non-comment entries; 27 matched, 3 short-code gap: TNG, GQ5, GQ7); STFC code conventions
inferred from public seed lists cited in `promo-codes.txt` header comments.

---

## R5. Auto-commit safety

**Decision:**
- **Per-run cap: 10 newly-redeemed codes auto-appended to `promo-codes.txt`.**
  If a run produces > 10 successful new candidates, the first 10 are committed
  and the remainder are deferred to `data/discord/candidates.jsonl` with
  status `deferred-cap` for the next run.
- **Commit attribution:** `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`.
  Commit message format: `chore(promo-codes): auto-append N codes from Discord monitor (run <run-id>)`.
- **Signed commits:** out of scope for v1 (would require a bot GPG key in
  Actions secrets — additional secret surface). Documented as v1.1 follow-up.
- **Concurrency lock:** the new workflow MUST share `concurrency.group:
  stfc-gift-redeemer` with `redeem.yml` and `refresh-token.yml` so two writers
  never race on `promo-codes.txt` or trigger interleaved `git push` rejections.
  This honors the documented Known Tension #3 (Redeem/refresh concurrency
  lock) in the constitution.
- **Branch protection:** the workflow uses the default `GITHUB_TOKEN` with
  `contents: write` — no PAT escalation. If branch protection ever requires
  PR review for `main`, this auto-commit path will fail loudly and the
  operator decides whether to relax protection or move to a PR-gated path.
  Documented as a known operational dependency.
- **Rollback:** git history is the rollback. A bad code can be removed by
  reverting the auto-commit; the suppression list (R6) prevents re-extraction.

**Why 10:** `promo-codes.txt` has accumulated 30 codes over ~12 months;
average organic add-rate is ~3.5/month. A 10/run cap is 4× a generous spike
estimate. With a 4-hour cadence (6 runs/day), a runaway monitored channel
could still inject 60 codes/day — but the suppression / dedup / per-account
outcome filters will collapse most repeats to no-ops, and the per-run cap
gives the operator a finite blast radius before they notice.

**Source:** `promo-codes.txt` git log analysis (manual inspection during
plan); `actions/checkout@v4` permissions docs.

---

## R6. State / config files introduced

| Path                                     | Purpose                                       | Class    | Writer                  | Lifetime    | Committed? |
|------------------------------------------|-----------------------------------------------|----------|-------------------------|-------------|------------|
| `config/discord-allowlist.json`          | Server/channel allow-list (FR-001)            | config   | human (PR)              | permanent   | yes        |
| `config/classifier-model.json`           | Pinned model id + revision SHA + weight SHA-256 | config | human (PR)              | permanent   | yes        |
| `data/discord/cursors.json`              | Per-channel last-seen message ID (R3)         | runtime  | `discord-monitor` skill | permanent   | yes        |
| `data/discord/candidates.jsonl`          | Append-only candidate-code log + statuses     | runtime  | `discord-monitor` skill | permanent   | yes        |
| `data/discord/tips-seen.jsonl`           | Content-hash dedup log for tips (FR-018)      | runtime  | `discord-monitor` skill | permanent   | yes        |
| `data/discord/suppression.json`          | Operator allow/deny rules for code patterns   | config   | human (PR)              | permanent   | yes        |
| `data/discord/cooldowns.json`            | Failed-code cool-down map (FR-009)            | runtime  | `discord-monitor` skill | permanent   | yes        |
| `data/digests/YYYY-MM-DD.md`             | Daily digest (FR-022)                         | artifact | `discord-monitor` skill | permanent   | yes        |
| `~/.cache/huggingface/**`                | Classifier model weights                      | cache    | Transformers.js         | per-cache-key | no (Actions cache only) |
| `DISCORD_BOT_TOKEN` (env / GH secret)    | Bot REST auth (FR-002)                        | secret   | human (gh secret set)   | until rotated | no       |

No new credential file. The Discord token follows the existing sanctioned
secret surfaces: `.env` locally, `secrets.DISCORD_BOT_TOKEN` in CI.

**Note on suppression/cooldowns split:** Constitution Principle V reserves
`data/discord/suppression.json` as an operator-curated file. FR-009's 30-day
cool-down telemetry is auto-written by feature code and therefore belongs in
a separate `data/discord/cooldowns.json` file to preserve the bright-line
separation between policy (operator) and telemetry (skill).

---

## R7. Token Capture Custody analysis (Principle V impact)

**Question:** Does `DISCORD_BOT_TOKEN` and the new committed state files
require an amendment to the constitution (v1.3.0)?

**Analysis:**

1. **Definition of "secret":** Constitution v1.2.0 § V defines a secret as
   *"a Scopely password, an STFC store JWT, or the GitHub PAT used to write
   secrets."* `DISCORD_BOT_TOKEN` is none of those. By the literal reading,
   the secret-custody clause does not bind it.
2. **Sanctioned writers of `STFC_ACCOUNTS`:** Unchanged. The Discord token
   is a separate secret name and MUST NOT be merged into `STFC_ACCOUNTS`,
   so the "any new sanctioned writer requires an amendment" rule does not
   trigger by its narrow reading.
3. **Durable inputs list:** Constitution v1.2.0 § V enumerates
   `STFC_ACCOUNTS`, `promo-codes.txt`, plus the refresh-pipeline secrets,
   and says these *"are the only additional durable inputs the project
   recognizes."* This feature introduces seven new durable inputs (R6 table:
   the four `data/discord/*` files, `data/digests/*`, and the two
   `config/*.json` files). That is a material expansion of what counts as
   "durable input to a redeem run".
4. **Outbound network scope:** Constitution v1.2.0 § Security & Compliance
   says *"The redemption orchestrator (`src/`) MUST only call the STFC
   store API base."* This feature adds `https://discord.com/api/v10/...`
   and (transitively, on first run) `https://huggingface.co/...` for the
   model download. That is also a material expansion.
5. **Helper-script symmetry:** The Discord token is consumed only inside
   `src/discord/`, not in `scripts/`. No new helper-script secret surface.

**Recommendation: YES — propose constitution amendment v1.3.0.**

The amendment SHOULD:

a. **Broaden the "secret" definition** in § V to *"a Scopely password, an
   STFC store JWT, the GitHub PAT used to write secrets, or any other
   third-party API credential the orchestrator carries (e.g.,
   `DISCORD_BOT_TOKEN`)."*
b. **Add to the durable-inputs list** in § V: the new `data/discord/*`
   state files and `data/digests/*` artifact tree, marked as
   workflow-committed (writer: the `discord-monitor` skill, executed only
   inside `.github/workflows/discord-monitor.yml`).
c. **Extend the outbound-network rule** in § Security & Compliance to
   permit `https://discord.com/api/...` for the new skill and
   `https://huggingface.co/...` for the model fetch (cache-miss path
   only).
d. **Carry forward without change** the rule that any new sanctioned
   writer of `STFC_ACCOUNTS` requires an amendment — this feature does
   not add such a writer, by design.

The amendment is **MINOR** (1.2.0 → 1.3.0): it adds new bounded surfaces
without removing or contradicting existing principles.

This decision is also captured in `plan.md` § Constitution Impact and is
listed under the Reviewer Gate plan (Picard/Borg-Queen review the
amendment PR).

**Source:** `.specify/memory/constitution.md` v1.2.0 §§ V and "Security &
Compliance Constraints"; this feature's R6 table.

---

## Open items (none blocking plan completion)

All 6 items resolved by `/speckit.clarify` are honored. No new ambiguities
surfaced in research. See plan.md § "Risks / Out of scope" for residual
trade-offs.
