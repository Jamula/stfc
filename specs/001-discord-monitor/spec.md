# Feature Specification: Discord Community Monitor for Codes & Tips

**Feature Branch**: `001-discord-monitor`
**Created**: 2026-05-12
**Status**: Draft
**Input**: User description: "I would like you to connect to the stfc discord server(s) to see if anyone is posting redeem codes, tips, trick, hacks. collect the useful information; try to redeem the codes save a daily summary of the useful tips, trick and hacks"

## Problem Statement & User Value *(mandatory)*

cyrusj currently maintains `promo-codes.txt` by hand. Useful STFC promo codes — and the
tips, tricks, and hacks that veteran players share — circulate primarily in real-time
Discord conversation. By the time cyrusj sees a code it is often expired; by the time
he sees a tip it is often buried.

This feature gives cyrusj an unattended assistant that watches the STFC Discord
community on the same cron cadence the redeemer already runs, harvests *new* candidate
promo codes, feeds them through the existing redemption pipeline, and produces a single
daily digest of player guidance worth reading. The user value is:

- **More codes redeemed, faster** — codes are attempted within hours of being posted,
  while still valid.
- **No more manual `promo-codes.txt` curation** — the system proposes additions and
  records the upstream API's verdict.
- **One curated read per day** — instead of scrolling Discord, cyrusj gets a digest of
  classified tips/tricks/hacks with provenance back to the original message.

## In-Scope vs Out-of-Scope *(mandatory)*

**In scope (v1):**

- Read-only ingestion of public messages from a defined set of STFC-related Discord
  channels.
- Extraction of candidate promo codes from message text.
- De-duplication against `promo-codes.txt` and against codes seen on prior runs of this
  monitor.
- Submission of new candidate codes through the existing redeem orchestrator
  (`run-all` / `redeem-codes` skill) on the next scheduled run.
- Recording the upstream API's per-code outcome (`CODE_ALREADY_USED`,
  `CODE_INVALID_OR_EXPIRED`, success, transient, etc.) in the daily digest.
- Classification of non-code messages into "useful tip / trick / hack" vs "chatter".
- Production of one daily digest artifact summarizing: codes attempted + outcomes,
  classified tips/tricks/hacks, and ingestion health (channels read, messages scanned,
  errors).
- Headless operation on the existing GitHub Actions cron cadence (every 4 hours for
  ingestion + redemption; once per day for the digest roll-up).

**Out of scope (v1):**

- Posting any message back into Discord (no bot replies, no DMs, no reactions, no
  webhook write-back to community channels).
- Direct messages, private channels, or any non-public conversation.
- Voice channels, stage channels, threads in private/forum-restricted channels.
- Image/OCR extraction (codes embedded in screenshots are ignored in v1).
- Auto-editing `promo-codes.txt` (the monitor proposes; whether to permanently add a
  successful code is a follow-up question — see FR-014).
- Running the redeemer at a faster cadence than today's schedule.
- LLM-generated *summarization* of tip content beyond classification + verbatim
  excerpting (see FR-019).
- Translating non-English tips.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auto-Harvest & Redeem New Promo Codes (Priority: P1)

cyrusj wakes up to find that a code posted in the STFC Discord at 02:00 UTC was
already attempted by his account at the 04:00 UTC scheduled run — and the result
(success / already-used / expired) is recorded in the daily digest with a link back
to the original Discord message.

**Why this priority**: This is the dominant value driver. Codes expire in hours to
days; the existing manual workflow misses a meaningful fraction of them. Everything
else in this spec (tips digest, classification) is value-additive but the redeem
shortening loop is the core ROI.

**Independent Test**: Drop a known-good test code into a monitored channel (or
replay a captured Discord message fixture); confirm that on the next scheduled run
(a) the code is extracted, (b) it is submitted via the existing redeemer, (c) the
outcome appears in that day's digest with provenance (channel + message timestamp,
no author PII beyond what is already public in the source message).

**Acceptance Scenarios**:

1. **Given** a monitored channel contains a new message with a syntactically valid
   STFC code that is not in `promo-codes.txt` and was not seen on a prior monitor
   run, **When** the scheduled monitor run executes, **Then** the code is queued for
   redemption and submitted via the existing redeem orchestrator on the same or next
   run, and the per-account outcome is recorded for the digest.
2. **Given** a monitored channel contains a code that is already in `promo-codes.txt`,
   **When** the monitor runs, **Then** the code is *not* re-queued and is recorded as
   "already known" rather than as a new candidate.
3. **Given** the monitor extracted a candidate string that turns out not to be a real
   code (upstream returns `CODE_INVALID_OR_EXPIRED` on first attempt), **When** later
   runs see the same string re-posted, **Then** it is suppressed from re-submission
   for a configurable cool-down window (see FR-009).

---

### User Story 2 - Daily Tips/Tricks/Hacks Digest (Priority: P2)

cyrusj opens one digest per day and sees a curated list of player guidance posted in
the last 24 hours — categorized (tip / trick / hack / event-info / patch-note), with
a verbatim excerpt and a link back to the source message — without having to scroll
Discord.

**Why this priority**: High value but lower urgency than P1. Tips do not expire on an
hourly clock the way codes do. A daily roll-up is sufficient and avoids classification
noise from in-flight conversation.

**Independent Test**: Replay a fixture set of ~50 mixed Discord messages
(codes, tips, chatter, memes, raid-coordination); confirm the digest contains the
intended tips with correct categories, excludes chatter, and that each digest entry
links back to the original message.

**Acceptance Scenarios**:

1. **Given** a 24-hour window of monitored channel activity, **When** the daily
   digest job runs, **Then** a digest is produced containing every classified
   tip/trick/hack with category label, verbatim excerpt, source channel, and
   timestamp.
2. **Given** the digest is produced, **When** cyrusj reads it, **Then** he can reach
   the original Discord message in one click (jump link) for context and attribution.
3. **Given** a duplicate tip is reposted across multiple channels in the same window,
   **When** the digest is produced, **Then** the tip appears once with all source
   locations listed (de-duplication by content similarity — exact rule in FR-018).

---

### User Story 3 - Operator Visibility & Health (Priority: P3)

cyrusj can tell at a glance whether the monitor is healthy: how many channels were
read, how many messages were scanned, how many codes were attempted, and whether any
ingestion errors occurred (auth expired, channel access lost, rate-limited).

**Why this priority**: Necessary for trust in an unattended job, but only matters once
P1+P2 are delivering value.

**Independent Test**: Force an auth failure or a rate-limit response from the Discord
side; confirm the next run's digest includes a clearly flagged "ingestion health"
section noting the failure, and that the redemption pipeline is *not* blocked from
running on already-extracted codes.

**Acceptance Scenarios**:

1. **Given** a monitor run completes, **When** the digest is produced, **Then** it
   includes counts of channels read, messages scanned, codes proposed, codes
   attempted, and per-error-class counts.
2. **Given** the Discord auth surface fails (token expired, permission revoked),
   **When** the next run executes, **Then** the failure is recorded as a flagged
   ingestion error in the digest *and* the redeem orchestrator still runs against
   `promo-codes.txt` and any previously-queued candidates (the failure does not
   silently break the existing redeemer).

---

### Edge Cases

- A message contains a code-like string inside a code block / quoted text that is
  actually documentation, not a live code (e.g., "the code format is `XXXXX-YYYYY`").
- A user posts a code with surrounding decoration (emoji, zero-width characters,
  spoiler tags `||CODE||`, Markdown formatting).
- A code is edited into a message *after* the monitor has already scanned it, or
  edited *out* of a message after extraction.
- A message is deleted between extraction and the next digest run.
- The same code is posted in multiple monitored channels within minutes.
- A non-English message contains an embedded Latin-character code.
- Discord rate-limits the read endpoint mid-scan; the run partially completes.
- The Discord auth credential is revoked or expires (see Constitution Principle V on
  secret custody — failure mode must not exfiltrate the credential to logs).
- A "tip" is actually a piece of community drama / personal attack / off-topic
  content; classifier must not surface it (see FR-020 on content moderation).
- A bot / webhook in the monitored channel posts hundreds of automated messages per
  hour (e.g., raid timers); ingestion volume scales unexpectedly.

## Clarifications

### Q1: Discord auth model
- **Asked:** 2026-05-12
- **Answer:** Dedicated Discord bot application (READ-only scopes: READ_MESSAGE_HISTORY, VIEW_CHANNEL). Single secret: DISCORD_BOT_TOKEN, custodied per Principle V. Server admins invite the bot.
- **Affects:** FR-002
- **Rationale:** User-token self-bots violate Discord ToS; bot model is sanctioned, scoped, and revocable.

### Q2: Tip/trick/hack classifier
- **Asked:** 2026-05-12
- **Answer:** Local small model on the runner. No message text leaves the runner. Trades CI image size and runtime for privacy.
- **Affects:** FR-016, FR-017
- **Rationale:** Discord message content is third-party user content; sending it to a remote LLM is a privacy/ToS surface we choose to avoid.

### Q3: Server/channel allow-list
- **Asked:** 2026-05-12
- **Answer:** TBD — no initial allow-list. Implementation must support an empty allow-list at launch and an operator path to add servers/channels via configuration. No hard-coded IDs.
- **Affects:** FR-001
- **Rationale:** Server access depends on admin cooperation that hasn't been arranged yet; system must be useful before the bot has any servers.

### Q4: promo-codes.txt mutation policy
- **Asked:** 2026-05-12
- **Answer:** Auto-commit successful new codes directly to `promo-codes.txt` on main. No PR gate. Trade-off accepted: speed over review.
- **Affects:** FR-014
- **Rationale:** Operator (cyrusj) prioritized turnaround over a review gate. Mitigation (per-run cap, attributed commit) decided in /plan.

### Q5: Daily digest location & retention
- **Asked:** 2026-05-12
- **Answer:** Committed Markdown file at `data/digests/YYYY-MM-DD.md`, versioned in git, retained indefinitely.
- **Affects:** FR-022, FR-023
- **Rationale:** Free, durable, greppable; aligns with the repo-as-source-of-truth pattern already used for promo-codes.txt.

### Q-deferred: Re-suppression cool-down window
- **Status:** Deferred to /speckit.plan with default: 30 days
- **Affects:** FR-009
- **Rationale:** Low-impact; sensible default exists; can be revisited during planning if needed.

## Requirements *(mandatory)*

### Functional Requirements

**Discord ingestion**

- **FR-001**: System MUST read messages only from a pre-declared allow-list of public
  Discord channels. Server/channel allow-list is configuration-driven and starts EMPTY. Operators add server IDs and channel IDs via configuration at deployment time. The implementation MUST NOT hard-code server or channel identifiers. The feature MUST handle an empty allow-list gracefully (no Discord ingestion runs; system continues to operate on `promo-codes.txt` only). Channels not on the
  allow-list MUST NOT be read even if the auth principal can technically see them.
- **FR-002**: System MUST establish its Discord connection using a **dedicated Discord bot application** with the minimum scopes `READ_MESSAGE_HISTORY` and `VIEW_CHANNEL`. The bot must be invited to each target server by that server's admin. The bot token is stored as a single secret named `DISCORD_BOT_TOKEN` and is custodied per Principle V (Token Capture Custody). User account tokens (self-bots) are explicitly forbidden.
- **FR-003**: System MUST scan ingestion-eligible message types (plain text + message
  edits within the lookback window). Reactions, voice events, and attachments are
  out of scope for v1.
- **FR-004**: System MUST run ingestion on a schedule compatible with the existing
  GitHub Actions cron cadence and MUST be safe to re-run; no message MUST be
  processed twice for the purpose of code submission or tip classification.
- **FR-005**: System MUST honor Discord-side rate limits (`Retry-After`, 429s) and
  MUST NOT issue requests outside the documented Discord API surface.

**Code extraction**

- **FR-006**: System MUST extract candidate promo codes from message text using a
  conservative pattern matcher whose precision is prioritized over recall (a missed
  real code is acceptable; a falsely-attempted random string risks burning the
  upstream rate budget on the redeem endpoint).
- **FR-007**: System MUST normalize candidates (trim whitespace, strip Markdown
  decoration, collapse zero-width characters, uppercase if upstream is
  case-insensitive) before deduplication and submission.
- **FR-008**: System MUST de-duplicate candidates against (a) the current contents of
  `promo-codes.txt` and (b) the set of candidate codes the monitor itself has seen on
  any prior run.
- **FR-009**: Candidate strings that previously failed redemption MUST be re-suppressed for a configurable cool-down window. **Default: 30 days** (deferred from clarify; revisit in /speckit.plan if needed).

**Redemption integration**

- **FR-010**: New candidate codes MUST flow through the *existing* redeem
  orchestrator and `redeem-codes` skill (see Constitution Principle II). The monitor
  MUST NOT call the STFC API directly and MUST NOT bypass `src/api/client.ts`.
- **FR-011**: Per-code outcomes MUST be classified using the existing outcome taxonomy
  in `src/lib/outcomes.ts` (`CODE_ALREADY_USED`, `CODE_INVALID_OR_EXPIRED`,
  `TRANSIENT`, `UNKNOWN_RESULT`, success). New outcome categories MUST NOT be
  introduced as part of this feature.
- **FR-012**: A monitor-side ingestion failure (Discord auth expired, channel
  unreachable, rate-limited) MUST NOT cause the redeem orchestrator to fail. The
  redeem orchestrator MUST continue to run against `promo-codes.txt` and any
  previously-queued candidates.
- **FR-013**: The monitor MUST record, per code: source channel, source message
  timestamp, outcome per account, and the run ID that performed the redemption.
- **FR-014**: When a Discord-sourced code redeems successfully, the runner MUST auto-commit the new code directly to `promo-codes.txt` on the default branch. No PR/review gate. Trade-off explicitly accepted: speed over review; risk of file pollution from a compromised source channel. Mitigation: cap the number of auto-appended codes per run (suggest ≤ N, decide N in /plan), and ensure the commit is signed/attributed to the workflow.

**Classification of tips / tricks / hacks**

- **FR-015**: System MUST classify each non-code message into one of:
  `tip | trick | hack | event-info | patch-note | chatter | unclassified`.
- **FR-016**: Tip/trick/hack classification runs **a local small model on the runner** (no remote API calls; no message text leaves the runner). The classifier model and weights are vendored or fetched from a trusted source at workflow setup. This trades larger CI image size and longer runtime for privacy: Discord message content is NEVER sent to a third-party API.
- **FR-017**: The system MUST NOT send Discord message content to any third-party
  classification service unless that service is explicitly listed in the resolved
  answer to FR-016 *and* added to the security-compliance review for this feature.
- **FR-018**: Tips appearing across multiple channels MUST be de-duplicated by
  content similarity. Exact-text matches MUST collapse; near-duplicates (same
  guidance, different wording) MAY be collapsed via a similarity threshold defined
  during planning. Each retained tip MUST list every source location.
- **FR-019**: Each digest entry MUST contain a *verbatim* excerpt of the source
  message (no paraphrasing/summarization in v1) plus a category label, to keep
  attribution faithful and to avoid generative-model risk.
- **FR-020**: Messages classified as personal attacks, drama, doxxing, or
  off-topic-NSFW content MUST be excluded from the digest regardless of category
  guesses. The exclusion rule and audit trail are owned by the planning phase.

**Daily summary**

- **FR-021**: System MUST produce one digest covering each rolling 24-hour window.
- **FR-022**: The daily summary is written as a **committed Markdown file** at `data/digests/YYYY-MM-DD.md` (UTC date) on the default branch. Files are versioned in git and retained indefinitely (no automated deletion). The runner MUST be idempotent: re-running on the same UTC day either updates the existing file in place or appends, never duplicates.
- **FR-023**: Digest retention policy is resolved via FR-022: committed Markdown files at `data/digests/YYYY-MM-DD.md` are versioned in git and retained indefinitely (no automated deletion).
- **FR-024**: Digest format MUST include: date window, codes-attempted table with
  outcomes, classified tips/tricks/hacks with category + excerpt + source link, and
  ingestion health counts (FR-027).
- **FR-025**: Digest content MUST NOT include any STFC store JWT, Scopely password,
  GitHub PAT, Discord token, real account names beyond what `run-all` already
  surfaces, or raw upstream API response bodies. (See Constitution Principle VII.)

**Non-functional / operational**

- **FR-026**: Monitor MUST run headless under GitHub Actions on the existing cron
  cadence; no interactive prompts, no human-in-the-loop steps inside the scheduled
  run.
- **FR-027**: Monitor MUST emit structured run metrics (channels read, messages
  scanned, candidates extracted, candidates submitted, candidates suppressed by
  dedup, tips classified, errors by class) to both the digest and the GitHub Job
  Summary.
- **FR-028**: Discord credential(s) MUST live only in the sanctioned secret surfaces
  defined by Constitution Principle V (GitHub Actions encrypted secrets and the
  user's local `.env`). Adding a new secret name (e.g., `STFC_DISCORD_BOT_TOKEN`)
  to the durable-input list requires a constitutional amendment per Principle V's
  "any new sanctioned writer" rule and SHOULD be flagged in the plan.
- **FR-029**: Discord credential(s) MUST pass through `src/lib/redact.ts`
  (`redactString` / `redactForLog`) on any error path that may surface them in
  logs, the same way `src/api/client.ts` already wraps STFC-API error messages.
- **FR-030**: The monitor MUST be resilient to upstream Discord schema drift in the
  same spirit as Principle III: typed errors, schema validation of responses,
  bounded request timeouts, no auto-retry on unsafe (write) methods (which is moot
  in v1 since v1 is read-only).

### Key Entities *(include if feature involves data)*

- **Monitored Channel**: A Discord channel the system is permitted to read.
  Attributes: server/guild, channel ID, last-scanned message marker, enabled flag.
- **Discord Message Snapshot**: An immutable record of a message at scan time used
  for dedup and provenance. Attributes: message ID, channel, author display name
  (no PII beyond what the message already exposes publicly), text content,
  timestamp, edited-at, jump link.
- **Candidate Code**: A code-shaped string extracted from a message. Attributes:
  normalized value, source message reference, first-seen timestamp, dedup state
  (new / already-in-promo-codes / previously-seen / cooldown-suppressed),
  per-account outcome history.
- **Classified Tip**: A non-code message classified as useful guidance. Attributes:
  category (tip/trick/hack/event-info/patch-note), verbatim excerpt, source message
  reference(s), classification confidence/method, dedup cluster ID.
- **Daily Digest**: The roll-up artifact for a 24-hour window. Attributes: window
  start/end, code outcomes table, tips list, ingestion health metrics, run IDs.
- **Run Health Record**: Per-run counters and error-class breakdown surfaced in the
  digest and Job Summary.

### API Contract *(mandatory for changes touching external integrations)*

This feature touches a *new* external integration (the Discord API) and continues to
touch the *existing* STFC store API via the existing redeem orchestrator. The STFC API
contract is unchanged by this feature and is already covered in `src/api/client.ts`,
`src/api/endpoints.ts`, and `src/api/schemas.ts`.

For the new Discord integration, the concrete endpoints, request shapes, and error
responses MUST be captured during /speckit.plan once the auth model (FR-002) is
resolved, because the available endpoints differ materially between the bot, user-token,
and webhook approaches. Fields that the spec can commit to in advance:

**Endpoints touched** (method + path + auth requirement) — *to be filled in /plan*:

- `GET <discord-read-endpoint-tbd>` — `<auth-model-tbd>` `<REDACTED>`

**Request shape** (sanitized example):

```json
{ "channel_id": "<placeholder>", "after": "<message-id-placeholder>" }
```

**Success response shape** (sanitized example, with HTTP status):

```text
200 OK
```

```json
{ "messages": [ { "id": "<placeholder>", "content": "<placeholder>",
  "author": { "username": "<placeholder>" }, "timestamp": "<placeholder>",
  "edited_timestamp": null } ] }
```

**Error responses** (status code + shape + when emitted):

- `401 Unauthorized` — Discord credential expired/revoked; flag ingestion error,
  do not retry inside the run, do not block the redeem orchestrator.
- `403 Forbidden` — bot/user lost access to the channel; mark channel disabled in
  the next-run state, surface in digest.
- `429 Too Many Requests` — honor `Retry-After`; partial-completion is acceptable
  and MUST be recorded as a health metric.
- `5xx` — transient; bounded retry per Principle III on safe (`GET`) methods only.

**Known edge cases**:

- Message edits arriving after first scan (re-scan window).
- Channels the bot was kicked from between runs.
- Discord API schema drift (new fields in `messages`).

**Source of contract** (cite at least one per Principle VIII):

- [ ] Captured HTTP request/response pair (file path or location, sanitized) — to be
      collected during /plan once auth model is selected.
- [x] Upstream documentation / changelog: Discord developer docs (URL to be cited
      in /plan).
- [ ] Measured test against a real account (test file) — to be added in /tasks.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 80% of valid promo codes posted in monitored channels are
  attempted by the redeemer within 6 hours of the original Discord message timestamp,
  measured over a rolling 30-day window.
- **SC-002**: False-positive code submissions (candidates that the upstream classifies
  as `CODE_INVALID_OR_EXPIRED` on first attempt) are fewer than 5% of total
  submissions over a rolling 30-day window.
- **SC-003**: cyrusj reads the daily digest in under 2 minutes and reports that at
  least 70% of entries surfaced are subjectively useful (operator survey, monthly).
- **SC-004**: Zero secret leaks: no Discord token, STFC JWT, Scopely password, or
  GitHub PAT ever appears in a digest, a committed file, a workflow log line that is
  not `::add-mask::`-protected, or the GitHub Job Summary, across all runs.
- **SC-005**: Monitor ingestion failures (auth, rate-limit, network) NEVER prevent
  the existing redeem orchestrator from running against `promo-codes.txt` —
  measurable as 100% redeem-orchestrator run completion regardless of monitor
  health, over the rolling window.
- **SC-006**: Manual maintenance of `promo-codes.txt` drops by at least 75%
  (measured by commit count touching that file by cyrusj per month, before vs after).

## Assumptions

- cyrusj is a member in good standing of the Discord server(s) he wants monitored
  and can either invite a bot to them or arrange equivalent read access.
- The existing GitHub Actions cron cadence (every 4 hours) is the right cadence for
  monitor ingestion; the daily digest is a separate once-per-day job.
- Codes posted in monitored channels are intended for public redemption (no NDA /
  alliance-private code sharing).
- The existing `src/api/client.ts` and `src/skills/redeem-codes` are the right
  integration surface for new candidate codes and require no contract change.
- All secrets introduced for Discord access can be expressed as GitHub Actions
  encrypted secrets and (optionally) a local `.env` entry, consistent with
  Constitution Principle V's sanctioned surfaces.
- Verbatim excerpting (no paraphrase) is acceptable to the source authors; this is
  consistent with Discord's standard citation/quote norms but should be revisited if
  any monitored server's rules say otherwise.
- The digest reader is cyrusj only; no multi-tenant or shared-team digest
  distribution is required in v1.

## Constitution Alignment Notes *(mandatory)*

This feature has been drafted with explicit attention to the constitution v1.2.0.

- **Principle I (User Safety & Trust First, NON-NEGOTIABLE)**: Monitor is read-only
  in v1 (FR-001, in-scope list). No action is taken on the user's STFC account
  except via the existing redeem orchestrator, which already operates only as a
  logged-in player can. Discord credential error surfaces are explicitly required
  to flow through `src/lib/redact.ts` (FR-029).
- **Principle II (Skill-Isolated CLI Architecture)**: The monitor SHOULD be exposed
  as a new skill (e.g., `discord-monitor`) registered in `src/cli.ts` and a
  matching `npm run skill:*` script, returning a structured `{ result, exitCode }`
  rather than calling `process.exit` itself. New code MUST live in
  `src/skills/` + `src/lib/`. (Architectural decision deferred to /plan.)
- **Principle III (Resilient Upstream-API Automation)**: All STFC-API calls
  continue to go through `src/api/client.ts` (FR-010). The new Discord client
  SHOULD apply the same resilience posture: typed errors, schema-validated
  responses, bounded timeouts, retry only on safe methods (FR-030).
- **Principle V (Stateless Operation & Secret Custody)**: Reruns are safe — codes
  are deduped and `CODE_ALREADY_USED` is treated as expected (FR-011). **Tension
  flagged for /plan**: introducing a Discord credential adds a new entry to the
  durable-input list in Principle V. Per Principle V's "any new sanctioned writer
  of `STFC_ACCOUNTS` MUST be added by constitutional amendment" rule and the
  spirit of the "list of durable inputs" provision, /plan MUST decide whether
  adding (e.g.) `STFC_DISCORD_BOT_TOKEN` requires a constitution amendment to
  v1.3.0, or whether it is a permitted addition under existing rules. Either way,
  the new secret name MUST be enumerated in the plan and MUST live only in
  Actions encrypted secrets and the local `.env`.
- **Principle V — Token Capture Custody**: This feature does NOT introduce a new
  writer of `STFC_ACCOUNTS`. The Discord credential is a separate secret; it
  MUST NOT be merged into `STFC_ACCOUNTS` or handled by `scripts/capture-token.mjs`.
- **Principle VII (Artifact Hygiene)**: Daily digests are project artifacts. FR-025
  forbids any token / password / PAT / raw upstream body content in them. Author
  display names will be limited to what the message already publicly exposes; no
  player-account data beyond what `run-all` already records.
- **Principle VIII (Wire-First Discovery)**: Discord API contract details are
  intentionally deferred to /plan, where captured request/response evidence will be
  recorded under `tests/fixtures/` before client code is written.
- **Principle IX (Test-First Discipline)**: Code-extraction patterns, classifier
  rules, dedup logic, and digest rendering are all unit-testable without live
  Discord access; /tasks MUST schedule tests before implementation.
- **Speckit Reviewer Gates**: This spec triggers the gate (new feature, multi-file,
  new external integration, new secret, new CI surface). /speckit.clarify is
  recommended before /speckit.plan.

## Risks

- **Discord ToS** — using a *user token* to scrape the user's own account violates
  Discord's Terms of Service and risks account termination; the bot path is the only
  ToS-compliant option for most scenarios. Resolution depends on FR-002.
- **Secret exposure** — adding a Discord token expands the secret-handling surface;
  must be enumerated under Principle V and protected by `redact.ts`. Failure mode:
  a token leaks into a digest or a workflow log.
- **False-positive code redemption** — overly-permissive extraction patterns waste
  upstream rate budget and may surface as "noise" in the digest. SC-002 caps this.
- **Rate limits (both sides)** — Discord 429s on the read side, STFC 429s on the
  redeem side. Both must be honored; partial-completion must be safe.
- **Content moderation** — surfacing community drama or harassment as "tips" would
  embarrass the project; FR-020 + FR-019 (verbatim, no LLM rewriting) are the
  primary guards.
- **Channel access loss** — bot kicked, permission revoked; ingestion silently
  degrading is the failure mode. SC-005 + FR-012 require this to be visible in the
  digest, not silent.
- **Schema drift** — Discord changes its message shape; Principle III posture
  (typed errors, schema validation) is the mitigation.
- **Operator burnout / noisy digest** — too many low-value entries causes cyrusj to
  stop reading. SC-003 + FR-019 + FR-020 are the guards; if SC-003 is not met,
  classifier rules must be tightened in a follow-up.

## Open Questions / Clarifications Summary

The following [NEEDS CLARIFICATION] markers must be resolved before /speckit.plan can
finalize the architecture. They are listed here for cyrusj's convenience:

1. **FR-001** — Which Discord servers and channel IDs are in scope?
2. **FR-002** — Auth model: dedicated bot, user token (ToS risk), or per-channel
   webhooks/mirrors?
3. **FR-016** — Classifier approach: rule-based, local model, or remote LLM?
4. **FR-022 / FR-023** — Where does the daily digest live and how long is it
   retained? (Repo file / GH issue / Job Summary / email / private Discord channel.)
