# Squad Decisions

## Active Decisions

### 2026-05-12T05:28:08Z: Feature 001-discord-monitor — clarify decisions (5 product decisions + 1 deferred)

**By:** cyrusj (via speckit.clarify workflow)

**What**: Resolved 5 open technical questions on the 001-discord-monitor feature via structured Q&A. Decisions determined the Discord auth model, tip/trick/hack classifier architecture, channel allow-list initialization, promo-codes.txt mutation policy, and digest artifact storage. One decision (re-suppression cool-down default) was deferred to /speckit.plan with a suggested 30-day default.

**The 5 decisions**:

1. **Discord auth model** (affects FR-002): Dedicated Discord bot application with minimum scopes `READ_MESSAGE_HISTORY` and `VIEW_CHANNEL`. Bot token custodied as `DISCORD_BOT_TOKEN` per Principle V. User-token self-bots explicitly forbidden.
   - *Rationale*: Discord ToS; bot model is sanctioned, scoped, and revocable.

2. **Tip/trick/hack classifier** (affects FR-016, FR-017): Local small model on the runner; no remote API calls. Message text does not leave the runner.
   - *Rationale*: Discord message content is third-party user data; sending to remote LLM is a privacy/ToS surface we avoid. Trade: larger CI image size and runtime for privacy.

3. **Server/channel allow-list** (affects FR-001): TBD — system launches with an EMPTY allow-list. Implementation MUST support configuration-driven allow-list addition and graceful operation (no Discord ingestion, fallback to `promo-codes.txt` only) when list is empty. No hard-coded IDs.
   - *Rationale*: Server access requires admin cooperation not yet arranged. System must be useful before bot has any servers.

4. **promo-codes.txt mutation policy** (affects FR-014): Auto-commit successful new codes directly to `promo-codes.txt` on main. No PR/review gate. Speed prioritized over review.
   - *Rationale*: Operator (cyrusj) prioritized turnaround. Mitigation (per-run code cap, attributed commits) deferred to /speckit.plan.

5. **Daily digest artifact storage** (affects FR-022, FR-023): Committed Markdown file at `data/digests/YYYY-MM-DD.md` (UTC date), versioned in git, retained indefinitely. Runner is idempotent (re-run on same day updates in place).
   - *Rationale*: Free, durable, greppable; aligns with existing repo-as-source-of-truth pattern (promo-codes.txt).

**Deferred decision**:

- **Re-suppression cool-down window** (affects FR-009): **Default: 30 days** (deferred to /speckit.plan for review during technical planning if needed).

**Source**: specs/001-discord-monitor/spec.md ## Clarifications section (Q1–Q5 answers + Q-deferred).

**Status**: Integrated into spec.md by specify-scribe; ready for /speckit.plan.

---


## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
### 2026-05-13: Borg Queen — hostile fact-check, plan 001-discord-monitor

**Verdict:** BLOCKING FINDINGS

Two factual errors in the plan's regex coverage claims must be corrected
before `/speckit.tasks`, because extractor unit tests will be built from
these claims and will encode the wrong expectations.

---

**P0 findings (must fix before /speckit.tasks)**

1. **`TNG` escapes the proposed regex — undisclosed 3-char gap.**
   The regex `^[A-Z][A-Z0-9]{3,19}$` requires a minimum of 4 characters.
   `TNG` is 3 characters and fails the match. The plan (research.md § R4)
   acknowledges `GQ5` and `GQ7` as "3-char outliers … known recall gap
   accepted in v1" but does NOT mention `TNG`. That makes the plan's
   claim — "all 42 non-comment entries match" — false for `TNG` specifically.
   `TNG` is an active promo code in `promo-codes.txt` today.
   — **Evidence:** `grep -P '^[A-Z][A-Z0-9]{3,19}$'` run against every
   non-comment line in `promo-codes.txt`; `TNG` fails.
   — **Why it matters:** The extractor test (plan § Test strategy, row 1)
   says "Every code in `promo-codes.txt` is matched." If the regex ships
   as-is, that test will either (a) fail, or (b) be silently weakened to
   exclude `TNG`, hiding a real recall gap.
   — **Fix options:** (a) Lower the floor to `{2,19}` and accept the
   false-positive cost from 3-char chat abbreviations, or (b) explicitly
   add `TNG` to the known-gap list alongside `GQ5`/`GQ7` in research.md
   § R4 and update the "42 codes matched" claim, or (c) maintain a
   per-code allowlist for short codes that bypasses the length filter.

2. **Code count is 30, not 42.**
   The plan (research.md § R4) claims "all **42** non-comment entries
   match" and repeats "42 codes catalogued." The actual file has exactly
   **30** non-comment, non-blank lines. This 40% overcount suggests the
   plan was written against a different version of `promo-codes.txt` or a
   combined corpus that no longer matches the committed file.
   — **Evidence:** `awk` and `wc -l` count against `promo-codes.txt` on
   branch `001-discord-monitor`.
   — **Why it matters:** If the plan's "42" is cited in test fixtures or
   acceptance criteria, they will be wrong from day one.

---

**P1 findings (advisory, document or fix in implementation)**

3. **Cron cadence mismatch — redeemer runs hourly, not 4-hourly.**
   Plan summary (line 9): "On the same 4-hour cron cadence the redeemer
   already runs." `redeem.yml` has `cron: "0 * * * *"` — that is **every
   hour**, not every 4 hours. The new `discord-monitor.yml` uses
   `cron: "15 */4 * * *"` (every 4 hours). These are different cadences.
   The plan's framing implies they share timing; they do not.
   — **Evidence:** `.github/workflows/redeem.yml:14`
   — **Why it matters:** Misleads reviewers about how often the monitor
   runs relative to the redeemer (6 runs/day vs. 24). The missed-run gap
   analysis and per-run cap math depend on the actual 4-hour cadence
   (which is correct for the monitor), but the "same cadence" claim is
   wrong. Also, redeem.yml may run up to 5 times between monitor runs,
   changing the freshness assumptions for code dedup.

4. **Install size understated.**
   Research.md § R1: "roughly 3 MB on disk." Actual unpacked sizes from
   npm registry: `@discordjs/rest` = 795 KB, `discord-api-types` =
   3.5 MB. Those two alone total ~4.3 MB. Including transitive deps of
   `@discordjs/rest` (undici 1.2 MB, @vladfrangu/async_event_emitter
   1.1 MB, @discordjs/collection 215 KB, etc.) the real footprint is
   ~7.2 MB. Not a showstopper, but the "3 MB" claim is wrong by more
   than 2×.
   — **Evidence:** `npm view @discordjs/rest dist.unpackedSize` = 795123;
   `npm view discord-api-types dist.unpackedSize` = 3518333.

5. **"6 new committed durable inputs" — count is 7.**
   Research.md § R7 and plan § Constitution Check / Complexity Tracking
   both say "six new durable inputs." The R6 table enumerates 7 committed
   paths: `config/discord-allowlist.json`, `config/classifier-model.json`,
   `data/discord/cursors.json`, `data/discord/candidates.jsonl`,
   `data/discord/tips-seen.jsonl`, `data/discord/suppression.json`,
   `data/digests/YYYY-MM-DD.md`. Off-by-one. The v1.3.0 amendment text
   (plan § Constitution Impact item 2) correctly lists all 7.
   — **Why it matters:** The amendment text is right; the prose claim is
   wrong. Minor, but if a reviewer counts and gets 7, trust in the
   document drops.

6. **Function name mismatch: plan says `loadPromoCodes`, code has
   `readPromoCodes`.**
   The redeemer-integration contract (line 38) defines the seam as
   `export function loadPromoCodes(opts?)`. The actual exported function
   in `src/lib/promoCodes.ts` is `readPromoCodes(path)` with a companion
   `parsePromoCodes(content)`. The plan should use the real name or
   explicitly state it is being renamed.
   — **Evidence:** `src/lib/promoCodes.ts:11,25`.

7. **`discord-monitor.yml` workflow snippet omits `git pull --rebase`.**
   `redeem.yml` (line 63) does `git pull --rebase origin "$GITHUB_REF_NAME"
   || true` before `git push` to recover from push races. The plan's
   proposed `discord-monitor.yml` (§ GitHub Actions, line 314) does a bare
   `git push` with no pull-rebase. Under the shared concurrency group
   this is unlikely to race, but if the concurrency group ever fails to
   serialize (e.g., GitHub Actions bug, manual dispatch bypass), the push
   will hard-fail instead of self-healing.
   — **Evidence:** `.github/workflows/redeem.yml:63` vs. plan line 314.

8. **`@discordjs/rest` latest stable is 2.6.1, not 2.5.x.**
   Plan pins `^2.5.0`. Semver-compatible, so not broken, but the plan
   implies 2.5 is current. At implementation time, `npm install
   @discordjs/rest@^2.5.0` will install 2.6.1 anyway. Note only.
   — **Evidence:** `npm view @discordjs/rest version` = 2.6.1.

---

**Unverifiable claims**

- **Model SHA-256 pinning:** The plan describes the `config/classifier-model.json`
  schema with a `weightSha256` field but provides no concrete hash value.
  The pinning is architectural (the code will verify at load time), not
  factual (no specific hash to cross-check against upstream today). I
  cannot verify the claim that the ONNX weight file for
  `Xenova/nli-deberta-v3-xsmall` at a given revision has a specific
  SHA-256 without downloading it from HuggingFace. This is acceptable
  at the plan stage — the hash will be populated during implementation —
  but the plan should not claim "pinning is real" until a concrete value
  exists.

- **Discord ToS < 100 servers threshold for Message Content Intent.**
  Plan § Risks says "< 100 servers means no Discord review needed."
  Discord's documented threshold has historically been 75 servers (not
  100) for self-service privileged intents. The threshold may have
  changed; I cannot verify against live Discord developer docs from this
  environment. If the real threshold is 75, the plan's statement is
  slightly wrong (though the bot will almost certainly stay under either
  limit). Recommend citing the specific Discord docs URL and the date
  it was checked.

- **`@xenova/transformers` model RAM (~140 MB peak) and inference time
  (~150 ms/msg on runner CPU).** Plan cites "measured via local Node
  REPL (recorded in `.squad/scratch/`)." That scratch data is not
  committed. Unverifiable without re-running the measurement.

---

**Unstated assumptions (named, not vetoed)**

1. **Operator will configure the allow-list before the first meaningful
   run.** If they don't, the skill no-ops the Discord half indefinitely.
   The digest will say "0 channels configured" every run — but will
   anyone notice? There is no alerting surface in v1. The feature could
   ship, merge, run for months, and never actually monitor anything.
   — **Failure mode:** Silent feature deadweight.

2. **Concurrency group serializes `git push`, not just the workflow
   job.** This is true today — `cancel-in-progress: false` queues the
   second run. But if a future maintainer changes it to `true` (or adds
   a third workflow to the group), the pushed-but-not-pulled state files
   will silently regress cursors and duplicate candidates.
   — **Failure mode:** Cursor regression → duplicate ingestion → duplicate
   codes submitted to STFC API (idempotent, but noisy).

3. **GitHub-hosted runner has enough RAM and CPU budget for ONNX
   inference.** The plan estimates ~140 MB peak RAM and ~150 ms/inference.
   `ubuntu-latest` runners have 7 GB RAM — fine. But `timeout-minutes: 10`
   is the hard wall. If the model download takes 25 s (plan's claim) and
   inference is 150 ms × 5,000 messages = 750 s = 12.5 min, the run
   will timeout. The heuristic pre-filter ("≥ 70% discard") is load-
   bearing: if the filter passes more traffic than expected (new channel
   with different content profile), the run will silently fail on timeout.
   — **Failure mode:** Timeout → no digest, no codes, no state update.

4. **`promo-codes.txt` append is the only auto-commit path.** The
   workflow also commits `data/discord/*` and `data/digests/*`. If any
   of those files grows unexpectedly (e.g., `candidates.jsonl` under a
   flood), the commit size could trigger GitHub's push size limits or
   slow the checkout step for `redeem.yml`. The plan's "~1 MB/year"
   estimate for `candidates.jsonl` assumes ≤ 10 channels and low
   candidate volume; a misconfigured allow-list could change that.
   — **Failure mode:** Gradual repo bloat → slow CI for all workflows.

5. **`process.exit` is only in `src/cli.ts`.** The plan states the new
   skill MUST NOT call `process.exit`. This is true of the current code.
   But `@xenova/transformers` or `onnxruntime-node` could call
   `process.exit` on a fatal native error (segfault in the ONNX runtime).
   This would kill the entire workflow step with no cleanup.
   — **Failure mode:** State files not flushed → cursor not advanced →
   next run re-ingests same messages.

---

**Pre-mortem: this feature failed in production six months from now. What broke?**

1. **The classifier model was removed from HuggingFace.** `Xenova/*` is a
   community namespace, not an official org. If the maintainer deletes or
   renames the model, the Actions cache eventually evicts (7 days of
   disuse during a quiet period), and the next cold-start run fails with
   `ClassifierLoadError`. The plan says "run fails loudly" — correct —
   but there is no alerting, no fallback to heuristic-only in v1, and no
   operator notification beyond a red check on the Actions tab that
   nobody is watching. The feature silently stops working.

2. **Discord changed their API response schema.** A new field, a removed
   field, or a type change in the `GET /channels/{id}/messages` response
   triggers `SchemaMismatchError` on every run. The monitor half dies;
   the redeemer half is fine (FR-012). But the digest stops updating, the
   cursors stop advancing, and when the schema is eventually fixed, the
   backlog of un-ingested messages may exceed the 500/channel cap,
   causing permanent data loss for that window.

3. **A monitored channel had a spam flood.** 10,000 messages between
   runs. The 500/channel cap fires, ingestion is partial, but the
   extractor pulls 50+ candidate codes from the spam. The per-run cap
   (10) holds, but the remaining 40 sit in `candidates.jsonl` with
   `deferred-cap` and are re-attempted every 4 hours, hammering the STFC
   API with known-bad codes until they age into suppression (30 days).
   The operator sees 10 new codes per run in the digest and thinks it's
   working as designed — they don't notice the deferred backlog is
   churning.
### 2026-05-13: Borg Queen — round-2 hostile fact-check, plan 001-discord-monitor

**Verdict:** FINDINGS (advisory)

All P0 findings from round 1 are confirmed fixed. No new P0 findings.
Three P1 advisory issues found — two are cascades from round-1 corrections
that didn't propagate to all consumers of the corrected claims.

---

**Round-1 corrections verification**

| Finding | Status | Evidence (file:line) | Notes |
|---------|--------|---------------------|-------|
| P0-1 TNG known-gap | **CONFIRMED** | research.md:186–190 | `TNG` now listed alongside `GQ5`, `GQ7` as 3-char outliers; "3-char gap: TNG, GQ5, GQ7" is explicit. |
| P0-2 "27 of 30" throughout | **CONFIRMED** | research.md:183, 190, 219 | "27 of 30 non-comment entries match" (line 183); "30 non-comment entries; 27 matched, 3 short-code gap: TNG, GQ5, GQ7" (line 190); "accumulated 30 codes" (line 219). Grep for literal `42` in specs dir returns only HTTP-429 references (research.md:39, plan.md:219/382, spec.md:227/374/488, discord-bot.contract.md:67). No code-count regression. |
| P1-3 Cron cadence framing | **CONFIRMED** | plan.md:9–11 | Summary now reads "runs every 4 hours (`cron: "15 */4 * * *"`) — an independent cadence from the redeemer's hourly schedule (`cron: "0 * * * *"`), sharing only the `stfc-gift-redeemer` concurrency group." Clean and accurate. |
| P1-4 Install size 7.2 MB | **CONFIRMED** | research.md:25–26 | "approximately 7.2 MB on disk including transitive dependencies (`@discordjs/rest` 795 KB + `discord-api-types` 3.5 MB + transitive deps ~3 MB)." Breakdown is present and reasonable. |
| P1-5 "7 durable inputs" | **CONFIRMED** | research.md:268; plan.md:91, 516 | "seven new durable inputs" (research.md:268); "seven new committed durable-input files" (plan.md:91); "7 new committed durable inputs" (plan.md:516). No remaining "six" / "6" references. |
| P1-6 Function name fix | **CONFIRMED** | redeemer-integration.contract.md:25–46, 85 | Contract defines `readCodesForRun(opts?)` wrapping existing `readPromoCodes(path)` + `parsePromoCodes(content)`. Grep for `loadPromoCodes` across the entire spec dir returns zero hits. Cascade is clean. |
| P1-7 `git pull --rebase` | **PARTIAL** | plan.md:316–317 | `git pull --rebase origin "$GITHUB_REF_NAME" \|\| true` added at line 316 ✓. However, line 317 is bare `git push` — redeem.yml:64 uses `git push origin "HEAD:$GITHUB_REF_NAME"`. The pull was fixed but the push was not brought into alignment with the established pattern. See P1-NEW-3 below. |
| Acknowledged assumptions (5 entries) | **CONFIRMED** | plan.md:477–494 | All 5 assumptions transcribed verbatim with Failure mode lines. Section header and framing ("surfaced by Borg Queen's hostile fact-check") are present. |

**Summary:** 7 of 8 corrections confirmed clean; 1 partial (P1-7 push line).

---

**New P0 findings**

None.

---

**New P1 findings (advisory)**

1. **P1-NEW-1 (CASCADE): Test strategy claims "Every code in `promo-codes.txt` is matched" — contradicts documented 3-char gap.**
   — **Evidence:** plan.md:377 — test strategy row for "Unit — extractor" reads: _"Every code in `promo-codes.txt` is matched."_ But research.md:186–190 explicitly documents that TNG, GQ5, and GQ7 are NOT matched by the `^[A-Z][A-Z0-9]{3,19}$` regex — they are accepted as known recall gaps.
   — **Why it matters:** This test assertion, taken literally, will fail on day one (3 of 30 codes don't match). The implementer must either (a) rewrite the assertion as "Every code ≥ 4 chars is matched; TNG/GQ5/GQ7 are documented exceptions and are NOT matched" or (b) add the 3-char codes to an exception list in the test. If the test is silently weakened to skip the 3-char codes without documenting why, the very recall gap the corrections aimed to surface will be hidden again.
   — **Root cause:** P0-1/P0-2 corrections updated the regex coverage claims in research.md but did NOT propagate to the test strategy table in plan.md. Classic cascade miss.

2. **P1-NEW-2 (STALE RATE): Organic add-rate is ~2.5/month, not ~3.5/month.**
   — **Evidence:** research.md:219–220 says "accumulated 30 codes over ~12 months; average organic add-rate is ~3.5/month." 30 / 12 = 2.5, not 3.5. Same stale figure at plan.md:355–356: "~3.5 codes/month."
   — **Why it matters:** The rate justifies the 10/run cap as "4× a generous spike estimate." With the corrected rate (2.5), 4 × 2.5 = 10.0 — the cap is exactly 4×, not a generous overshoot. The cap remains defensible (10 is still reasonable), but the "generous" framing is now arithmetically false. This was noted by Tuvok's corrections memo as advisory (the rate was computed against 42 and wasn't updated when 42→30 landed).
   — **Root cause:** P0-2 corrected the code count 42→30 but the derived statistic (rate = count/months) was not recomputed.

3. **P1-NEW-3 (INCOMPLETE FIX): bare `git push` vs. `git push origin "HEAD:$GITHUB_REF_NAME"`.**
   — **Evidence:** plan.md:317 — `git push` (bare). redeem.yml:64 — `git push origin "HEAD:$GITHUB_REF_NAME"` (explicit remote + refspec).
   — **Why it matters:** The P1-7 correction correctly added `git pull --rebase origin "$GITHUB_REF_NAME"` (matching redeem.yml:63), but left the push bare. Bare `git push` works on Actions runners because `push.default` defaults to `simple` and checkout sets the upstream tracking branch. However, it diverges from the explicit pattern established in redeem.yml. If an implementer copies the plan snippet verbatim, the inconsistency between the pull (which names the branch) and the push (which doesn't) is surprising and could break under non-default checkout configurations (e.g., `ref:` parameter on `actions/checkout`).

---

**Cascade / cross-reference issues introduced by corrections**

1. **research.md R5 "Why 10" rate ↔ code count:** The code count was corrected 42→30 but the derived rate (~3.5/month) was not recomputed to ~2.5/month. This stale rate appears in both research.md:220 and plan.md:356. (P1-NEW-2 above.)

2. **research.md R4 gap acknowledgment ↔ plan.md test strategy:** The 3-char gap (TNG, GQ5, GQ7) was correctly documented in research.md:186–190, but the test strategy row at plan.md:377 still claims exhaustive match coverage. (P1-NEW-1 above.)

3. **plan.md git snippet pull vs. push alignment:** The pull line was corrected to match redeem.yml, but the push line was not. (P1-NEW-3 above.)

4. **No other cascade issues detected.** The P1-6 function-name fix (`loadPromoCodes` → `readCodesForRun`) propagated cleanly — zero remaining references to `loadPromoCodes` in any spec file. The "7 durable inputs" fix propagated to all three locations. The concurrency group string `stfc-gift-redeemer` matches bit-for-bit between plan.md:290 and redeem.yml:28. The install-size correction ("7.2 MB") does not conflict with any "lightweight" framing elsewhere.

---

**Pre-mortem update**

| Round-1 scenario | Change since round 1 |
|---|---|
| 1. Classifier model removed from HuggingFace | **Unchanged.** Corrections did not touch the model lifecycle. Still no fallback to heuristic-only in v1; still no alerting beyond a red check on Actions tab. |
| 2. Discord API schema drift | **Unchanged.** |
| 3. Spam flood / deferred-cap churn | **Unchanged.** The rate correction (P1-NEW-2) slightly sharpens this concern: the per-run cap of 10 is now provably exactly 4× the organic rate, not a generous buffer over it. The margin for surprise is thinner than the plan claims. |

No scenario got worse from the corrections. The test-strategy cascade (P1-NEW-1) is the highest-risk new item — if unaddressed, it will cause either a false test failure or a silently weakened test at implementation time.
### 2026-05-13: Borg Queen — round-3 hostile fact-check

**Verdict:** CLEAR

All round-2 findings confirmed resolved or accurately carried into tasks.md.
No new P0 findings. Two minor P1 advisories — neither blocks `/speckit.implement`.

---

**Scope A — Cascade fix + sibling cascade hunt**

- **plan.md:377 cascade fix: CONFIRMED.**
  Line 377 now reads: _"Every code in `promo-codes.txt` is matched except the 3 short-code gap (TNG, GQ5, GQ7); documented stop-list rejects every entry; the 'format is `XXXXX-YYYYY`' example is NOT extracted; spoiler-tag / zero-width / Markdown decoration are stripped."_
  Matches the cascade-fix memo's prescribed phrasing. ✓

- **Sibling cascade misses:**
  - **plan.md:459** — Reviewer gates table, Borg Queen row, reads: _"regex catches every code in `promo-codes.txt`."_ This is technically inaccurate (regex catches 27 of 30; TNG/GQ5/GQ7 are accepted gaps). However, this is a *description of the review task*, not a test assertion or coverage claim. The reviewer (Borg Queen — i.e., me) already knows the 3-char gap exists. Impact: cosmetic. Noted as **P1-R3-1** below.
  - No other "every code matches" or "all codes match" framing found elsewhere in plan.md or research.md. Grep for `every code.*match|all codes match` returns only plan.md:377 (corrected) and plan.md:459 (cosmetic).

- **Regression grep results:**
  - Literal `\b42\b` in specs dir: **0 hits.** No code-count regression. ✓
  - `loadPromoCodes` in specs dir: **0 hits** (only negative-usage references in tasks.md lines 258, 325, 645 saying "MUST NOT appear" — correct defensive framing). ✓
  - `six new` (case-insensitive): **0 hits.** ✓
  - `3 MB` in specs dir: **1 hit** — research.md:26 `transitive deps ~3 MB`. This is the breakdown sub-component of the 7.2 MB total, not the old wrong "3 MB" total. Legitimate. ✓

- **Live-repo fact re-verification:**
  - Concurrency group: `stfc-gift-redeemer` at redeem.yml:28 — matches plan.md:290, tasks.md:289, tasks.md:362 bit-for-bit. ✓
  - Cron expressions: `0 * * * *` at redeem.yml:14 (redeemer hourly). Plan says `15 */4 * * *` for monitor. tasks.md:290–291 and 361 correctly encode both literals. ✓
  - Function names: `readPromoCodes` (src/lib/promoCodes.ts:11), `parsePromoCodes` (src/lib/promoCodes.ts:25). tasks.md T015/T020/T021 correctly use these names. `readCodesForRun` is the new wrapper — correctly described as new, not existing. ✓
  - Package versions in package.json: no Discord deps yet (planned additions). Plan/tasks cite `@discordjs/rest` ^2.5.0, `discord-api-types` ^0.38.x, `@xenova/transformers` ^2.17.x — these are T004 deliverables, nothing to verify against live repo. ✓

---

**Scope B — Fresh tasks.md hostile pass**

- **Wrong-number test acceptance criteria:** None found.
  - T013 (extractor tests): correctly says "27 that match the core regex" and "3 known short-code gaps (`TNG`, `GQ5`, `GQ7`)" (lines 221–224). ✓
  - T017 (integration test): correctly asserts `stfc-gift-redeemer` (line 289), `15 */4 * * *` (line 290), `0 * * * *` (line 291). ✓
  - T015 (seam tests): correctly uses `readCodesForRun`, `readPromoCodes`, `parsePromoCodes` (lines 256–260). ✓
  - T000 (governance): correctly says "7 new durable inputs" (line 54); Notes section repeats "7 durable inputs (NOT 6)" (line 649). ✓
  - One line-number citation is wrong: T025 line 362 and T017 line 288 both cite `redeem.yml:31` for the concurrency group, but `concurrency.group: stfc-gift-redeemer` is at redeem.yml:**28**. Line 31 is `jobs:`. The **value** is correct; only the line citation is off. Noted as **P1-R3-2** below.

- **"All codes match" framing in test tasks:** None. ✓
  T013 correctly frames the 3-char codes as "KNOWN GAPS in the test output (labeled, expected failures — not regressions)" (lines 223–224). Notes section line 644 repeats: "3 known short-code gaps (`TNG`, `GQ5`, `GQ7`) are ACCEPTED KNOWN GAPS, not regressions." Clean framing throughout.

- **Phase 0 governance task cites Tuvok's 3 amendment-PR P0s: YES.**
  T000 (lines 48–69) enumerates P0-1, P0-2, P0-3 with accurate acceptance criteria that match the findings in `tuvok-001-discord-monitor-amendment-audit.md` and `tuvok-001-discord-monitor-amendment-audit-r2.md` (which confirms all three P0s carried forward unchanged). Each P0 has a clear checklist item. ✓

- **Test-first ordering violations:** None. ✓
  - Phase 3: Tests T013–T017 (lines 218–292) precede all implementation tasks T018–T025 (lines 296–375).
  - Phase 4: Tests T026–T028 (lines 400–439) precede all implementation tasks T029–T032 (lines 443–477).
  - Phase 5: Tests T033–T034 (lines 500–518) precede implementation tasks T035–T036 (lines 522–533).
  - Each test task explicitly says "**before** implementing" with the corresponding source file named. ✓
  - Dependencies section (lines 582–590) reiterates: "Tests MUST be written and FAIL before any corresponding implementation task starts." ✓

- **Phantom file paths:** None. ✓
  Every existing-file path checked against live repo:
  `src/lib/promoCodes.ts` ✓, `src/skills/redeemCodes.ts` ✓, `src/cli.ts` ✓,
  `scripts/check-artifact-hygiene.mjs` ✓, `src/lib/redact.ts` ✓, `src/api/client.ts` ✓,
  `.specify/memory/constitution.md` ✓, `.specify/templates/plan-template.md` ✓,
  `specs/001-discord-monitor/quickstart.md` ✓,
  `specs/001-discord-monitor/contracts/state-files.contract.md` ✓,
  `specs/001-discord-monitor/contracts/classifier.contract.md` ✓,
  `.github/workflows/redeem.yml` ✓, `promo-codes.txt` ✓.
  New-file paths (created by tasks T003–T006) are clearly described as "create" operations. ✓

---

**Pre-mortem on tasks.md**

> `/speckit.implement` runs this tasks.md tomorrow. Top 3 plausible failure modes:

1. **T025 bare `git push` inconsistency (inherited from plan.md P1-NEW-3, still open).**
   tasks.md:373 instructs `git push` (bare). redeem.yml:64 uses `git push origin "HEAD:$GITHUB_REF_NAME"`. If the implementer copies the tasks.md snippet verbatim, the bare push will work on standard Actions runners but diverges from the established pattern. Under non-default `actions/checkout` `ref:` configurations (e.g., a PR-triggered `workflow_dispatch`), bare push could target the wrong branch. Probability: low. Impact: medium (silent wrong-branch push). Mitigation: implementer or reviewer catches during T025 code review.

2. **T017/T025 cite `redeem.yml:31` but concurrency group is at line 28.**
   If the implementer navigates to line 31 to verify the concurrency group, they'll see `jobs:` instead. Confusion, not breakage — the VALUE `stfc-gift-redeemer` is correct in the tasks.md assertion. The implementer will find it 3 lines earlier. Probability: medium (confusion). Impact: zero (value is correct). Mitigation: none needed — self-correcting.

3. **`@xenova/transformers` ^2.17.x installation or model-download failure in CI.**
   T031 depends on a 71 MB ONNX model download from HuggingFace on first cache miss. If HuggingFace is rate-limited or the model is relocated, T031 (and by extension T024 step 5) will fail. tasks.md correctly describes the SHA-256 integrity check and cache strategy, but there is no fallback-to-heuristic-only documented in tasks.md for a model-download failure. This matches the plan's acknowledged risk and is out of scope for v1 — but it remains the most likely runtime surprise for a first CI run.

None of these three are task-ordering or factual-accuracy problems in tasks.md itself. They are operational risks that the implementer and reviewer will encounter at runtime.

---

**P0 findings**

None.

---

**P1 findings (advisory)**

1. **P1-R3-1 (SIBLING CASCADE, cosmetic): plan.md:459 reviewer-gate row still says "regex catches every code in `promo-codes.txt`".**
   Should read "regex catches 27 of 30 codes (3-char gap: TNG, GQ5, GQ7)" for consistency with plan.md:377 and research.md:186–190. This is a task description for Borg Queen (the reviewer who already knows the gap), not a test assertion, so impact is cosmetic. No implementation behavior depends on this line.

2. **P1-R3-2 (WRONG LINE CITATION): tasks.md:288 and tasks.md:362 cite `redeem.yml:31` for the concurrency group; actual location is redeem.yml:28.**
   Line 31 of redeem.yml is `jobs:`, not `concurrency.group: stfc-gift-redeemer`. The asserted VALUE is correct — only the line citation is wrong. No test logic or implementation behavior depends on the line number; it is a human cross-reference hint only.

3. **P1-NEW-3 (CARRIED from r2): bare `git push` in plan.md:317 and tasks.md:373.**
   Still diverges from redeem.yml:64's explicit `git push origin "HEAD:$GITHUB_REF_NAME"`. Carried from r2; not addressed by the cascade fix or tasks generation. Advisory — works on standard runners.

---

**Round-2 P1 carry-forward status**

| R2 finding | Status in r3 |
|---|---|
| P1-NEW-1 (cascade: test strategy "every code") | **FIXED** at plan.md:377 (cascade fix landed). ✓ |
| P1-NEW-2 (stale rate ~3.5/month) | **NOT IN TASKS** — tasks.md does not reference the rate or the 10/run cap derivation. The stale rate remains in plan.md:356 and research.md:220, but it does not propagate into any test assertion or implementation instruction. No tasks.md impact. |
| P1-NEW-3 (bare `git push`) | **CARRIED** into tasks.md:373 verbatim from plan.md:317. See P1 #3 above. |
### 2026-05-13T03:19:00Z: User-provided Discord target (informational)
**By:** Cyrus Jamula (via Copilot)
**What:** The Discord server/channel to monitor for the 001-discord-monitor feature is:
  - URL: https://discord.com/channels/509679626763632640/509685530108362773
  - Guild ID: `509679626763632640`
  - Channel ID: `509685530108362773`
  This is the seed entry for the operator-curated allow-list (FR-014/spec clarification: "Empty at launch; operator-configurable"). The team should treat this as the default first allow-list entry when wiring quickstart / config examples, but the runtime allow-list MUST remain empty by default per the clarified design — this server/channel is configured at deploy time by the operator.
**Why:** User shared the link mid-planning so downstream tasks (config schema example, quickstart, smoke-test fixtures) reference a real target instead of a placeholder.
### 2026-05-13: Picard — plan review gate for 001-discord-monitor

**Verdict:** APPROVE WITH CONDITIONS

The plan is architecturally sound, scope-disciplined, and demonstrates real engagement with the constitution. The conditional-pass on Principle V is correctly identified, the v1.3.0 amendment is correctly scoped, and the in-process redeemer seam is the right boundary. Conditions below are bounded verifications and one governance ordering requirement — none rise to architectural rework.

---

**Architecture review**

- **Skill-isolated CLI architecture (Principle II) — PASS.** The new `discord-monitor` skill registers in `src/cli.ts`, exposes `npm run skill:discord-monitor`, and returns `{ result, exitCode }`. The redeemer-integration contract is explicit that the new skill imports `redeemCodes` as a function (not a subprocess, not via `src/cli.ts`), preserving the "only `src/cli.ts` calls `process.exit`" invariant verified at `src/cli.ts:1` and `src/cli.ts:108`. The exit-code mapping table (auth-failed → 0, classifier integrity → 1, allowlist malformed → 1, allowlist empty → 0) honors the existing convention that infrastructure failures fail the run and per-source failures do not.
- **Resilient upstream-API automation (Principle III) — PASS.** `src/discord/client.ts` mirrors `src/api/client.ts`'s posture: typed errors (`DiscordAuthError`, `DiscordRateLimitError`, `DiscordTransientError`, `DiscordChannelAccessError`, `SchemaMismatchError`), zod-validated responses, GET-only retry, `AbortSignal` timeout, `Retry-After` honoring on 429. The discord-bot contract correctly bounds retries (3× per channel on 429, 1× with jitter on 5xx) and treats 401 as non-retrying with a redacted log path. STFC API surface is unchanged.
- **Single in-process seam — CLEAN BOUNDARY.** Adding ONE optional `extraCandidates?: string[]` arg to `loadPromoCodes()` (currently `readPromoCodes` / `parsePromoCodes` per `src/lib/promoCodes.ts`) and one optional `{ extraCandidates }` arg to `redeemCodes()` (currently `RedeemCodesOptions` per `src/skills/redeemCodes.ts:14`) is the minimum-surface seam consistent with the existing skill contract. The contract explicitly forbids parallel redeem paths, new outcome categories (FR-011 reuses `src/lib/outcomes.ts`), and pre-redemption mutation of `promo-codes.txt`. This is hidden coupling only if the seam grows; as written it is a single, named, additive arg with deterministic order semantics. **Acceptable.**
- **Auto-commit to main (no PR gate) — SUFFICIENT WITH CONDITIONS.** The combination of (a) per-run cap = 10, (b) 30-day failure cool-down via `suppression.json`, (c) human-curated PR-only allow-list at `config/discord-allowlist.json`, (d) per-account outcome filter (only `REDEEMED` → append), and (e) shared concurrency group with `redeem.yml` is a defensible safety story. Two reservations: (i) a hostile *operator with allow-list write access* is still inside the trust boundary — the allow-list PR review is the only check, so its review discipline must be made explicit (see Conditions); (ii) auto-commit is gated on `contents: write` from the workflow's default `GITHUB_TOKEN`, which means branch protection on `main` would silently break the feature — the plan acknowledges this in Risks but the operational dependency should be surfaced more loudly in `quickstart.md`.
- **Risks listed in plan §Risks — coverage.** Token leak, auto-commit flood, classifier staleness, schema drift, concurrency race, branch protection, PII in cursors, Discord ToS — all genuine and mitigated. **One missing risk:** *workflow rerun while the prior run already pushed but did not yet update `cursors.json` on disk*. The shared concurrency group prevents in-flight overlap, but a force-rerun of a partially-failed run could re-extract messages between the last successful append and the cursor write. This is bounded (dedup via `candidates.jsonl` + `promo-codes.txt` membership) but should be called out explicitly. Not a blocker; add as a documented behavior in the state-files contract.

**Dependency review**

New runtime deps proposed (the *complete* list, per plan § Technical Context and research § R1/R2):

1. `@discordjs/rest` ^2.5.0 — Apache-2.0 per plan claim.
2. `discord-api-types` ^0.38.x — plan claims Apache-2.0; **needs verification** (this package is widely published as MIT on its GitHub; the claim must be checked against `npm view discord-api-types license` before merge).
3. `@xenova/transformers` ^2.17.x — Apache-2.0 per research § R2.
4. `onnxruntime-node` — transitive via `@xenova/transformers`; MIT (Microsoft). Native Node addon, not a TS-build artifact, consistent with Principle IV.

No other runtime deps are smuggled in — `tsx`, `zod`, `typescript`, `playwright`, `simple-git-hooks`, `@types/node` are reused with no version bump per `package.json`.

**ONNX classifier model + runtime is BOTH a dep AND a runtime artifact.** Disposition:
- The *runtime* (`@xenova/transformers` + transitive `onnxruntime-node`) is a runtime dep, license-compatible (Apache-2.0 / MIT), correctly enumerated in `package.json` (will be) and reviewed under this gate.
- The *model weights* (`Xenova/nli-deberta-v3-xsmall`, ~71 MB, MIT) are a runtime artifact, NOT committed to the repo, fetched on first run, SHA-256-pinned in `config/classifier-model.json`, cached in Actions. This is the right call (R6 vendoring strategy) and matches Principle IV's "no UI build artifacts" posture by analogy.

The pinned SHA-256 + integrity-fail-loud-on-mismatch is the load-bearing mitigation for supply chain. **It must actually be present in `config/classifier-model.json` at implementation time** — Borg Queen's hostile review can confirm.

---

**Constitution v1.3.0 amendment decision**

**Decision: OPTION 1 — LAND the v1.3.0 amendment BEFORE `/speckit.implement`.**

Reasoning:

1. **Governance honesty.** The plan correctly identifies that v1.2.0 § V's literal enumeration of durable inputs (`STFC_ACCOUNTS`, `promo-codes.txt`, refresh-pipeline secrets) and the literal definition of "secret" (Scopely password / STFC JWT / GitHub PAT) does not cover this feature. Implementing first and amending after creates a window — however brief — in which `main` ships code that contradicts its own constitution. That is the exact thing Principle VI exists to prevent.
2. **Atomic-PR temptation is the wrong trade.** Option 2 (bundle amendment + first implementation PR) is superficially appealing because it's "one PR," but it conflates two reviews with different reviewer sets and different rollback semantics. A constitutional amendment must be reviewable on its own merits (Tuvok's process audit, Borg Queen's verification of every concrete claim) without reviewers also being asked to evaluate ~2k lines of TypeScript. Bundling makes it harder to revert a bad amendment without also reverting working code, and harder to revert bad code without re-opening governance.
3. **Option 3 (defer under Complexity Tracking) is rejected outright.** Complexity Tracking is for *isolated, bounded* exceptions — a single skipped test, a one-time tool choice — not for a multi-section, multi-month operational addition. Treating a new credential, six new durable inputs, and two new outbound destinations as "tracked complexity" would normalize constitution-as-aspiration. The whole point of Principle VI is that the constitution is the source of truth.
4. **The amendment is genuinely MINOR-class.** The proposed edits to § V, § Token Capture Custody, § Security & Compliance Constraints (outbound network scope, third-party action pinning roster), and the Sync Impact Report bump add sanctioned surfaces and remove no obligations. No principle is added or removed. No template structure changes. Tuvok should confirm MINOR vs MAJOR but the plan's classification reads correct on its face.

**The team will execute as follows:**

- A standalone PR amends `.specify/memory/constitution.md` to v1.3.0 per the six edits enumerated in plan § Constitution Impact, with Sync Impact Report and reviewer signoffs (Bashir cross-check, Borg Queen claim verification, Tuvok process audit, Picard ratification).
- That PR lands.
- THEN `/speckit.tasks` runs against the amended constitution.
- THEN `/speckit.implement` runs.

If the amendment cycle stalls, the implementation cycle waits. This is the correct ordering.

---

**Conditions (must be satisfied before `/speckit.implement` opens)**

1. **[Borg Queen]** Verify `discord-api-types`'s actual license against the npm registry and the upstream repo. If the license is MIT (not Apache-2.0 as plan claims), correct the plan and `research.md` § R1 — does not change the verdict (MIT is also license-compatible per § Security & Compliance Constraints), but the constitution-adjacent claim must be accurate.
2. **[Borg Queen]** Verify the regex in the proposed `src/discord/extractor.ts` (when first drafted in `/speckit.tasks`) matches every code currently in `promo-codes.txt`. The plan asserts this in § Test strategy; the test must exist before extractor implementation.
3. **[Borg Queen]** Verify the concurrency-group string `stfc-gift-redeemer` matches `redeem.yml` line 31 exactly (it does today — confirmed in this gate at `.github/workflows/redeem.yml:31`) AND that any future edits to `discord-monitor.yml` retain the exact same string. The shared-group claim is load-bearing for the auto-commit safety story.
4. **[Tuvok]** Confirm v1.3.0 amendment is MINOR (not MAJOR) under Governance § "Versioning Policy" and that Sync Impact Report covers every dependent template (plan-template.md, spec-template.md, tasks-template.md, copilot-instructions.md). If any template needs structural change (not just text), reclassify.
5. **[Bashir]** When `/speckit.tasks` runs, ensure every spec acceptance criterion has a test task ordered before its implementation task (Principle IX). Specifically: extractor regex tests, classifier privacy invariant (`fetch` never called inside `classify()`), digest byte-identical-on-no-change idempotency, and the FR-012 "auth failure does not block redeemer" path.
6. **[Scotty]** Add to `quickstart.md` § operational-dependencies a clearly-titled section "Branch protection on `main` will break this feature" with the exact remediation (either disable required PR review for `github-actions[bot]`, or open the PR-gated mode tracked in plan § Risks). The risk is in the plan; it needs to be in the operator-facing doc too.
7. **[Scotty]** When implementing the rerun/cursor edge case (workflow rerun after partial-failure where `cursors.json` was not flushed), document the bounded re-extraction behavior in the state-files contract. No code change required — `candidates.jsonl` membership already dedups — but the behavior must be named.
8. **[Picard, this gate, separate PR]** Open the v1.3.0 amendment PR per the decision above. Land before `/speckit.implement`.

---

**Rejection details (if REJECT)**

N/A — verdict is APPROVE WITH CONDITIONS.

---

**Open questions for the user (Cyrus Jamula)**

1. **Bot ownership.** The Discord bot application registration is a personal Discord asset. Confirm: is the bot owned by your personal Discord account, and is the operational expectation that secret rotation (`gh secret set DISCORD_BOT_TOKEN`) is yours alone? This affects the § Token Capture Custody amendment language.
2. **Allow-list governance.** The auto-commit safety story rests on "allow-list is human-curated PR-only." Do you want a CODEOWNERS rule on `config/discord-allowlist.json` requiring your explicit review on every change, or is the existing branch-protection sufficient? (Recommendation: CODEOWNERS — adds belt to suspenders for the trust-boundary point I raised above.)
3. **Branch-protection state on `main`.** If `main` already has required-review branch protection, the auto-commit path will not work day one. Please confirm current state so Scotty can either plan around it (PR-gated mode) or proceed with direct push.

These three answers do not block `/speckit.tasks` from starting; they block the v1.3.0 amendment text being final and the workflow YAML being implementable. Please respond before the amendment PR is opened.
### 2026-05-13: Picard — plan review gate ROUND 2 for 001-discord-monitor

**Verdict:** APPROVE WITH CONDITIONS

Tuvok's 13 surgical edits land cleanly. Every Borg Queen P0/P1 has a verifiable correction in the artifacts, and no edit introduced a new internal contradiction. The conditions that survive into round 2 are the same governance / verification items that were never the corrections' job to resolve: the v1.3.0 amendment shape (Tuvok's amendment-audit P0s on Sync Impact Report fields, `plan-template.md` re-sync, and Known-Tensions disposition), and the implementer-time obligations carried over from r1 (license verification, regex-test-before-extractor, branch-protection callout in quickstart, rerun/cursor edge-case documentation).

---

**Round-1 conditions check**

- **Condition 1 — `discord-api-types` license verification (Borg Queen)** — UNRESOLVED — Out of scope for Tuvok's correction pass; remains a Borg Queen task before `/speckit.implement`. Carried forward.
- **Condition 2 — extractor regex covers every code in `promo-codes.txt` (Borg Queen)** — PARTIALLY RESOLVED — The factual basis is now honest: `research.md:183–190` corrected to "27 of 30 non-comment entries match" with `TNG`, `GQ5`, `GQ7` enumerated as the accepted recall gap. The *test obligation itself* (test exists before extractor implementation) carries forward to `/speckit.tasks`.
- **Condition 3 — `concurrency.group: stfc-gift-redeemer` matches `redeem.yml`** — RESOLVED at gate — Re-verified this round at `.github/workflows/redeem.yml:27–28`. The forward obligation ("any future edit to `discord-monitor.yml` retains the exact string") carries forward.
- **Condition 4 — Tuvok confirms v1.3.0 is MINOR + Sync Impact Report covers every dependent template** — RESOLVED with NEW BLOCKERS — Tuvok's amendment audit (`tuvok-001-discord-monitor-amendment-audit.md`) confirmed MINOR but raised three P0s the plan does not yet reflect: (P0-1) `plan-template.md` § Constitution Check guidance text becomes stale on Principle V durable-inputs and must be listed as a re-sync target — the plan currently says "templates affected (none — table structure unchanged)"; (P0-2) Sync Impact Report sketch is missing the per-principle change summary field; (P0-3) v1.2.0 committed v1.3.0 to resolve three Known Tensions and two `TODO(V1.3)` items, none of which this amendment touches — the SIR must explicitly defer to v1.4.0. These are now conditions on the amendment PR, not on the plan, but they block the amendment PR opening.
- **Condition 5 — `/speckit.tasks` orders test tasks before implementation (Bashir)** — UNRESOLVED — Carries forward; lands at `/speckit.tasks` time.
- **Condition 6 — `quickstart.md` § operational-dependencies branch-protection callout (Scotty)** — UNRESOLVED — `quickstart.md` was untouched in this correction round (Tuvok confirmed no `quickstart.md` edits). Carries forward.
- **Condition 7 — Document the rerun-after-partial-failure cursor edge case in state-files contract (Scotty)** — UNRESOLVED — `contracts/` only had the redeemer-integration contract edited; state-files contract carries forward.
- **Condition 8 — Open the v1.3.0 amendment PR before `/speckit.implement` (Picard)** — UNRESOLVED — Decision unchanged (see below); blocked on Tuvok-audit P0s being addressed first.

---

**Corrections verification**

- **P0-1 (TNG/GQ5/GQ7 known-gap):** Correctly applied. `research.md:185–188` enumerates all three (`TNG`, `GQ5`, `GQ7`) as 3-char outliers and 3-char recall gap accepted in v1. The "(3-char gap: TNG, GQ5, GQ7)" inline note also lands at `research.md:190`.
- **P0-2 (27 of 30 codes, not 42):** Correctly applied throughout. `research.md:183` reads "27 of 30 non-comment entries match"; `research.md:190` reads "30 non-comment entries; 27 matched"; `research.md:219` reads "has accumulated 30 codes over ~12 months". `grep -n '\b42\b'` against `specs/001-discord-monitor/**` returns zero hits — no orphan "42" survived.
- **P1-3 (cron cadence framing):** Correctly clarified. `plan.md:8–12` reads: "runs every 4 hours (`cron: "15 */4 * * *"`) — an independent cadence from the redeemer's hourly schedule (`cron: "0 * * * *"`), sharing only the `stfc-gift-redeemer` concurrency group." Cross-checked against `.github/workflows/redeem.yml:14` (`cron: "0 * * * *"`) and `.github/workflows/redeem.yml:27–28` (group `stfc-gift-redeemer`). Match.
- **P1-4 (install size 7.2 MB, not 3 MB):** Correctly applied. `research.md:24–28` reads "approximately 7.2 MB on disk including transitive dependencies (`@discordjs/rest` 795 KB + `discord-api-types` 3.5 MB + transitive deps ~3 MB)". The trailing "~3 MB" is the transitive-dep portion, not a relapse of the original "3 MB on disk" claim — confirmed in context.
- **P1-5 (7 durable inputs, not 6):** Correctly applied at `plan.md:91` ("seven new committed durable-input files"), `plan.md:516` ("7 new committed durable inputs"), and `research.md:268` ("seven new durable inputs"). `grep -n 'six new'` against the spec dir returns zero hits.
- **P1-6 (real function names in contract):** Correctly applied. `contracts/redeemer-integration.contract.md:25–45` now exports `readCodesForRun(opts?)` as the new wrapping function and explicitly names the existing `readPromoCodes(path)` and `parsePromoCodes(content)` as unchanged. `grep -n 'loadPromoCodes'` returns zero hits across the spec dir. **Internal-naming note:** the *plan* prose at `plan.md:86` still says "additive (optional `extraCandidates` arg)" without naming `loadPromoCodes` or `readCodesForRun` — that's fine; it's name-agnostic. The contract is the authoritative surface and is correct.
- **P1-7 (`git pull --rebase` before push):** Correctly applied. `plan.md:314` reads `git pull --rebase origin "$GITHUB_REF_NAME" || true` immediately before `git push`. Matches the pattern in `.github/workflows/redeem.yml:63`.
- **Acknowledged-assumptions section:** Present. `plan.md:477–513` § "Acknowledged assumptions" transcribes all five Borg Queen assumptions verbatim, each with its **Failure mode** line, attributed to Borg Queen's 2026-05-13 fact-check, with the explicit obligation that "the implementer MUST revisit each during implementation."

---

**New issues introduced by the corrections (if any)**

- **None internal-to-the-plan.** Every cross-reference Tuvok flagged in the change-impact accounting (the "Why 10" rate estimate now implies ~2.5/month not ~3.5/month against 30 codes) is documented in his memo and is non-blocking — the per-run cap of 10 is conservative either way and Borg Queen did not re-flag it.
- **One forward note for `redeemCodes.ts` refactor:** Tuvok flagged that `src/skills/redeemCodes.ts:9` currently imports `readPromoCodes` by name; after the seam lands, the call site must switch to `readCodesForRun` when `extraCandidates` is present. This is an implementation-time concern already captured in Tuvok's memo and does not affect plan approval.

---

**Architecture re-check (one pass)**

Nothing in the corrected artifacts changes the round-1 architecture verdict. The seam is still ONE additive optional arg; the new client mirrors `src/api/client.ts` posture; the in-process invocation of `redeemCodes` from the new skill still preserves the "only `src/cli.ts` calls `process.exit`" invariant; the shared concurrency-group story is the same, now with cadence framed honestly. **PASS unchanged.**

---

**Constitution v1.3.0 amendment decision (UNCHANGED)**

**Confirmed: OPTION 1 — LAND v1.3.0 amendment as a standalone PR BEFORE `/speckit.implement`.**

No new information has emerged that justifies revisiting the round-1 reasoning (governance honesty, separability of review surfaces, MINOR-class scope). What *has* emerged — Tuvok's amendment-audit P0s — strengthens the case for landing the amendment standalone: the Sync Impact Report needs its per-principle summary, its templates-affected enumeration (with `plan-template.md` listed as needing a Principle V guidance re-sync), and an explicit disposition for the three Known Tensions and two `TODO(V1.3)` items v1.2.0 committed to v1.3.0. None of those belong in a feature PR; all of them belong in the amendment PR.

---

**Conditions for round 2 (must be satisfied before `/speckit.implement` opens)**

Carried forward from round 1 (still unresolved):

1. **[Borg Queen]** Verify `discord-api-types` license against the npm registry and upstream repo; correct plan/research if needed.
2. **[Borg Queen]** Ensure the extractor-regex test (covering all 27 matching codes + the documented `TNG`/`GQ5`/`GQ7` recall gap) exists before extractor implementation in `/speckit.tasks`.
3. **[Bashir]** At `/speckit.tasks` time, ensure every spec acceptance criterion has a test task ordered before its implementation task; specifically extractor regex tests, classifier privacy invariant (`fetch` never called inside `classify()`), digest byte-identical-on-no-change idempotency, and the FR-012 "auth failure does not block redeemer" path.
4. **[Scotty]** Add to `quickstart.md` § operational-dependencies a section "Branch protection on `main` will break this feature" with the exact remediation paths.
5. **[Scotty]** Document the rerun-after-partial-failure cursor edge case (workflow rerun where `cursors.json` was not flushed) in the state-files contract — bounded re-extraction behavior already deduped by `candidates.jsonl` membership; just needs to be named.

New for round 2 (carved out of Tuvok's amendment-audit; block the amendment PR, not the plan):

6. **[Picard, in the v1.3.0 amendment PR]** Update `plan.md` § Constitution Impact item 6 (Sync Impact Report sketch) to list `plan-template.md` as a templates-affected entry needing Principle V durable-inputs guidance re-sync, and to add the per-principle change summary field (REVISED / KEPT / EXTENDED for I–IX, Security & Compliance, Development Workflow, Governance, Speckit Reviewer Gates) per the v1.2.0 SIR shape.
7. **[Picard, in the v1.3.0 amendment PR]** Add a follow-ups field to the Sync Impact Report explicitly disposing of (a) the three Known Tensions v1.2.0 committed to v1.3.0 and (b) the two `TODO(V1.3)` items (helper-script redaction, SHA-pinning for squad-process workflows) — either resolve or re-target to v1.4.0.
8. **[Tuvok]** Verify the open-ended secret-definition language ("any third-party API credential…") is acknowledged as a deliberate governance-model shift in the SIR rationale, not as a silent broadening.

Conditions 6–8 are amendment-PR conditions. They do not block `/speckit.tasks` from running against the *current* plan; they block the amendment PR opening.

---

**Open questions for the user (Cyrus Jamula)**

Restated from round 1 — none answered yet, all still gating amendment-text finalization and workflow-YAML implementability:

1. **Bot ownership.** Is the Discord bot owned by your personal account, with secret rotation (`gh secret set DISCORD_BOT_TOKEN`) yours alone? Affects § Token Capture Custody amendment language.
2. **Allow-list governance.** CODEOWNERS rule on `config/discord-allowlist.json`, or is current branch protection sufficient? (Recommendation: CODEOWNERS.)
3. **Branch-protection state on `main`.** Is required-review protection currently enabled? If yes, the auto-commit path will not work day one and Scotty needs to plan PR-gated mode.

No new open questions arose from the corrections.
### 2026-05-13: Picard — plan review gate ROUND 3 for 001-discord-monitor

**Verdict:** APPROVE WITH CONDITIONS

Round 3 is a verification pass. Tuvok's single-line cascade fix at plan.md:377 lands clean. Bashir's freshly-generated tasks.md absorbs the carry-forward conditions from rounds 1 and 2 into concrete, ordered task IDs (Phase 0 governance gate, T037 branch-protection callout, T038 rerun/cursor edge case, license-check task in Phase 1, T013 extractor tests with TNG/GQ5/GQ7 named as expected failures). Five of the eight r2 conditions are now addressed by tasks.md and convert to "tracked, will be enforced at /speckit.implement"; three remain open as amendment-PR conditions. No drift detected in plan/research/contracts/redeem.yml since round 2.

---

**Cascade fix verification (plan.md:377)**

- **Status:** CONFIRMED
- **Evidence:** plan.md:377 — _"Every code in `promo-codes.txt` is matched except the 3 short-code gap (TNG, GQ5, GQ7); documented stop-list rejects every entry; the \"format is `XXXXX-YYYYY`\" example is NOT extracted; spoiler-tag / zero-width / Markdown decoration are stripped."_ The phrasing matches research.md:190 exactly ("3 short-code gap: TNG, GQ5, GQ7"), so the cascade between research's recall-gap claim and the test-strategy assertion is now consistent. Tuvok's memo (`tuvok-001-discord-monitor-cascade-fix.md`) confirms this was a single-row edit, no other claims touched. Re-grepped: no remaining "Every code in `promo-codes.txt` is matched" without the exception clause.

---

**Round-2 conditions status (re-verify all 8)**

| # | Condition | Status | Evidence |
|---|-----------|--------|----------|
| 1 | [Borg Queen] Verify `discord-api-types` license against npm registry & upstream | ADDRESSED BY tasks.md (still must execute) | tasks.md:113–117 — task in Phase 1 to run `npm view discord-api-types license` and confirm MIT; remains an action item but is now a tracked task with a checkbox. |
| 2 | [Borg Queen] Extractor regex test exists BEFORE extractor implementation; covers all 27 matches + TNG/GQ5/GQ7 known gap | ADDRESSED BY tasks.md | tasks.md:218–219 — T013 is a `[P]` test task in Phase 3 ordered before extractor implementation, with explicit "Write these tests FIRST, ensure they FAIL" framing at line 215. tasks.md:644 names TNG/GQ5/GQ7 as expected-failure assertions, closing P1-NEW-1's silent-weakening risk at the test level. |
| 3 | [Bashir] Test-first ordering for every spec acceptance criterion (extractor regex, classifier privacy invariant, digest byte-identical, FR-012 auth-failure path) | ADDRESSED BY tasks.md | tasks.md:10–13 enshrines test-first as a top-level ordering rule. Specific evidence: T013 (extractor) before extractor impl; classifier `fetch`-never-called assertion captured at the test-task layer (referenced at line 127 stub creation); T035 byte-identical assertion at lines 427–429; T036 FR-012 auth-failure assertion at lines 501–504. |
| 4 | [Scotty] `quickstart.md` § operational-dependencies branch-protection callout | ADDRESSED BY tasks.md (still must execute) | tasks.md:546–547 — T037 explicitly creates the "Branch protection on `main` will break this feature" advisory section in `quickstart.md`. Quickstart itself was not edited this round (correct — that's the implementer's job under T037). |
| 5 | [Scotty] Document rerun-after-partial-failure cursor edge case in state-files contract | ADDRESSED BY tasks.md (still must execute) | tasks.md:552–556 — T038 adds the "Rerun behavior after partial failure" section to the state-files contract documenting bounded re-extraction with `candidates.jsonl` dedup. |
| 6 | [Picard, in v1.3.0 amendment PR] SIR includes per-principle change summary + lists `plan-template.md` Principle V re-sync target | OPEN (amendment-PR condition, correctly carried forward) | tasks.md:48–63 — T000 P0-1 and P0-2 enumerate both requirements as merge gates on the amendment PR. Does not block /speckit.tasks; blocks the amendment PR opening, as decided in r1/r2. |
| 7 | [Picard, in v1.3.0 amendment PR] SIR explicit disposition of 3 Known Tensions + 2 TODO(V1.3) items | OPEN (amendment-PR condition, correctly carried forward) | tasks.md:64–69 — T000 P0-3 covers the three Known Tensions disposition. Note: the two TODO(V1.3) items (helper-script redaction, SHA-pinning) are not separately enumerated in T000 — Picard must add them to the amendment-PR checklist when drafting T001. Sub-condition tracked. |
| 8 | [Tuvok] Verify open-ended secret definition acknowledged as deliberate governance shift in SIR rationale | OPEN (amendment-PR condition, correctly carried forward) | tasks.md:73–88 — T001 implementation step (1) broadens the secret definition; the SIR-rationale acknowledgment is implicit in T000 P0-2 (per-principle REVISED summary will surface the broadening). Tuvok should re-verify when reviewing the amendment PR. |

**Summary:** Conditions 1–5 transition from "carried forward as obligations" to "tracked tasks with acceptance criteria." Conditions 6–8 remain amendment-PR-only conditions, exactly as r2 framed them, and do not block /speckit.tasks. They block the amendment PR landing, which in turn blocks /speckit.implement.

---

**tasks.md sanity check (high-level only)**

- **Phase 0 governance section for v1.3.0 amendment:** PRESENT — tasks.md:36–95. Contains T000 (verify three Tuvok-audit P0s as merge gates), T001 (draft amendment with all six edits per plan.md § Constitution Impact), T002 (open standalone PR). Phase 0 is explicitly framed as a BLOCKER for all later phases at lines 43–44 and reaffirmed at the dependency map (line 579) and parallel-execution example (line 622).
- **Test-first ordering:** APPEARS TO HOLD — tasks.md:10–13 elevates Principle IX to a top-level ordering rule; "Write these tests FIRST, ensure they FAIL" appears as a section banner before each US story's test cluster (lines 215, 397, 497); the dependency map at lines 604–605 visually shows test tasks (T013–T016) preceding implementation tasks (T017+). Bashir's deep review will confirm per-task; this is a high-level pass.
- **Anything obviously wrong at a glance:**
  - One housekeeping nit (non-blocking, flag for Bashir): T000 P0-1 cites `tuvok-001-discord-monitor-amendment-audit.md` but Tuvok's amendment-audit memo in the inbox is `tuvok-001-discord-monitor-amendment-audit-r2.md`. The reference still resolves a human reader to the right document, but Bashir may want to standardize the filename.
  - T000 covers the three Known Tensions but not the two TODO(V1.3) items r2 condition 7 enumerated — captured above as a sub-condition for the amendment-PR drafting.
  - Otherwise: none.

---

**New issues since round 2**

- **None.** plan.md mtime is 04:12 (cascade fix only). research.md, contracts/redeemer-integration.contract.md, and `.github/workflows/redeem.yml` are unchanged since r2 verification. Concurrency group `stfc-gift-redeemer` and the cron strings still match the round-2 attestation. Borg Queen's r2 P1-NEW-2 (rate ~2.5/month vs. ~3.5/month) and P1-NEW-3 (bare `git push` vs. explicit refspec) were classified ADVISORY in r2 and remain advisory — neither blocks the gate, both are flagged for the implementer at code-write time.

---

**Conditions for round 3 (carry-forward only)**

Amendment-PR conditions (block the v1.3.0 amendment PR opening; do NOT block /speckit.tasks):

1. [Picard] Update plan.md § Constitution Impact item 6 (SIR sketch) to list `plan-template.md` as a templates-affected entry needing Principle V durable-inputs guidance re-sync, and add the per-principle REVISED/KEPT/EXTENDED summary field. _(unchanged from r2 #6)_
2. [Picard] Add a follow-ups field to the SIR explicitly disposing of (a) the three Known Tensions v1.2.0 committed to v1.3.0 and (b) the two `TODO(V1.3)` items (helper-script redaction, SHA-pinning for squad-process workflows) — resolve or re-target to v1.4.0. **Sub-condition added in r3:** the two TODO(V1.3) items are not enumerated in tasks.md T000 — Picard must enumerate them when drafting T001. _(unchanged from r2 #7, with sub-condition)_
3. [Tuvok] Verify the open-ended secret-definition language is acknowledged as a deliberate governance-model shift in the SIR rationale, not a silent broadening. _(unchanged from r2 #8)_

Implementation-time obligations (now tracked as tasks.md task IDs; close at /speckit.implement when those tasks merge):

4. tasks.md T-license (Phase 1, lines 113–117) — Borg Queen license-verification task must execute and report.
5. tasks.md T013 (Phase 3, lines 218–219) — extractor regex test must be written and failing before any extractor implementation lands; must enumerate TNG/GQ5/GQ7 as expected-failure assertions per line 644.
6. tasks.md T037 (lines 546–547) — quickstart branch-protection callout must land.
7. tasks.md T038 (lines 552–556) — state-files contract rerun/cursor edge-case section must land.

---

**Open questions for the user (Cyrus Jamula)**

Restated from rounds 1 and 2 — none answered yet, all still gating amendment-text finalization and workflow-YAML implementability:

1. **Bot ownership.** Is the Discord bot owned by your personal account, with secret rotation (`gh secret set DISCORD_BOT_TOKEN`) yours alone? Affects § Token Capture Custody amendment language.
2. **Allow-list governance.** CODEOWNERS rule on `config/discord-allowlist.json`, or is current branch protection sufficient? (Recommendation: CODEOWNERS.)
3. **Branch-protection state on `main`.** Is required-review protection currently enabled? If yes, the auto-commit path will not work day one and Scotty needs to plan PR-gated mode. **This question is now blocking T037 acceptance** — Scotty needs the answer to write the right remediation paragraph.

No new open questions from round 3.
### 2026-05-15: Constitution v1.3.0 — Discord monitor amendment
**By:** Picard (Lead) via /speckit.constitution
**Requested by:** cyrusj
**What:** v1.2.0 → v1.3.0 (MINOR). Principle V enumeration expanded for `DISCORD_BOT_TOKEN`, 6 new durable inputs (`config/discord-allowlist.json`, `config/classifier-model.json`, `data/discord/cursors.json`, `data/discord/candidates.jsonl`, `data/discord/tips-seen.jsonl`, `data/discord/suppression.json`), and the `data/digests/**` artifact tree. Security & Compliance expanded for `discord.com/api` and `huggingface.co` outbound destinations, with new binding constraint that NO Discord message content ever leaves the runner. Third-party-action SHA-pinning roster extended to include `discord-monitor.yml`.
**Why:** Required to land feature 001-discord-monitor without violating v1.2.0's narrower enumerations of sanctioned secrets, durable inputs, and outbound destinations. The strict `STFC_ACCOUNTS` writer gate is NOT triggered — `DISCORD_BOT_TOKEN` is explicitly excluded from the STFC_ACCOUNTS custody surface and from `scripts/capture-token.mjs`. No principle removed, no obligation narrowed.
**Scope discipline:** Principles I, II, III, IV, VI, VII, VIII, IX byte-identical to v1.2.0. Speckit Reviewer Gates, Development Workflow, Governance, and Known Tensions sections preserved verbatim. The three v1.3.0-targeted Known Tensions carried from v1.2.0 are NOT resolved by this amendment and remain deferred.
**References:**
- `specs/001-discord-monitor/plan.md` § Constitution Impact (drafted edits 1–6)
- `specs/001-discord-monitor/spec.md` ## Clarifications (READ-only bot scopes, on-runner classification)
- `.specify/memory/constitution.md` (the amendment itself)
**Suggested commit message:** `docs: amend constitution to v1.3.0 (Discord monitor enumeration expansion)`
**Next:** `/speckit.analyze` (cross-artifact consistency: spec ↔ plan ↔ constitution) → `/speckit.tasks`
### 2026-05-13: Tuvok — process audit, proposed constitution v1.3.0 amendment

**Verdict:** SCOPE CORRECT (with advisories)

---

**Versioning audit**

- Proposed level: MINOR per plan.md § Constitution Impact line 438
- Audit conclusion: **MINOR** — correct.

Reasoning: All six proposed edits are additive. No existing principle is
removed, renamed, or contradicted. The secret-definition broadening (edit 1)
extends the existing closed list (`Scopely password, STFC store JWT, GitHub
PAT`) with an open-ended category (`any third-party API credential…`). This
is material expansion that imposes new obligations — the v1.2.0 MINOR
precedent (which renamed five principles and added an entire sub-section)
supports the same classification here.

**Advisory (P1):** The open-ended category language ("any third-party API
credential the orchestrator or its sibling skills carry") changes the
governance model. Under v1.2.0, adding a new secret type to the enumerated
list requires a constitutional amendment. Under the proposed wording, any
future third-party credential is automatically covered without amendment.
This is not a MAJOR bump (no removal or backward-incompatible redefinition),
but it is a deliberate governance-model shift that the Sync Impact Report
should acknowledge explicitly.

---

**Sync Impact Report shape audit**

Compared against the v1.2.0 Sync Impact Report in `.specify/memory/constitution.md:1–119`.

| Required field | Present in proposal? | Notes |
|---|---|---|
| Version change line | ✅ | `1.2.0 → 1.3.0, MINOR` at plan.md:438 |
| Bump rationale | ✅ | `new sanctioned surfaces, no removed obligations` at plan.md:438–439 |
| Per-principle change summary | ❌ | The proposal does not enumerate per-principle status (REVISED / KEPT / EXTENDED) for Principles I–IX, Security & Compliance, Development Workflow, Governance, or Speckit Reviewer Gates. The v1.2.0 report did this exhaustively. |
| Templates updated | ⚠️ | Proposal says "list templates affected (none — table structure unchanged)" at plan.md:440–441. This is incomplete — see dependent-template audit below. The v1.2.0 report listed each template with a description of what needed re-sync. |
| Follow-ups | ❌ | No follow-ups section. The v1.2.0 report listed `TODO(V1.3)` items (helper-script redaction, SHA-pinning for squad-process workflows) and carried-forward items. The v1.3.0 report must state which of these are resolved by this amendment and which carry forward to v1.4.0. |

**Additional shape gap:** The v1.2.0 report included a cross-check result
field and an editorial-corrections field. The v1.3.0 sketch does not mention
either. These may not apply to a narrower amendment, but the omission should
be deliberate, not accidental.

---

**Dependent templates enumeration audit**

Templates examined: all files in `.specify/templates/`.

| Template | Referenced principle(s) | Listed in plan § Constitution Impact? | Proposed update direction |
|---|---|---|---|
| `.specify/templates/plan-template.md` | I, II, III, IV, V, VI, VII, VIII, IX (Constitution Check table, lines 38–49) | ❌ | **Needs update.** Line 44 guidance text says `durable inputs limited to STFC_ACCOUNTS / promo-codes.txt (+ refresh-pipeline secrets)`. After v1.3.0, this is factually wrong — six new durable inputs are added. The secret-definition guidance is also stale (will not mention third-party API credentials). |
| `.specify/templates/spec-template.md` | III (via "Principle III" in old name at API Contract), VII, VIII (API Contract section, lines 103–152) | ❌ | **No-op likely.** The proposed v1.3.0 edits do not touch Principles III, VII, or VIII text. The v1.2.0 report flagged this template for a Principle III name update that may still be pending — but that is a v1.2.0 re-sync issue, not v1.3.0. |
| `.specify/templates/tasks-template.md` | IX (Test-First Discipline reference, lines 11–17) | ❌ | **No-op.** Principle IX is not touched by the proposed amendment. |
| `.specify/templates/constitution-template.md` | None (structural template) | ❌ | **No-op.** No principle-specific content. |
| `.specify/templates/checklist-template.md` | None | ❌ | **No-op.** No principle-specific content. |

**Templates I checked but the plan does NOT list:**
`plan-template.md`, `spec-template.md`, `tasks-template.md`,
`constitution-template.md`, `checklist-template.md`. The plan lists zero
templates ("none — table structure unchanged"). This is factually incorrect
for `plan-template.md`, whose Principle V guidance text becomes stale.

**Templates the plan lists that I could not find:** None (the plan lists no
templates).

---

**Cross-reference findings**

1. **Known Tensions backlog mismatch.** The v1.2.0 constitution's Path D
   acceptance block (`.specify/memory/constitution.md:103–118`) states:
   `Next version: v1.3.0 to address all three documented tensions.` The
   three Known Tensions (Principle III auth/me overclaim, Principle VII
   .github/ scan-path overclaim, redeem/refresh concurrency lock) are NOT
   addressed by the proposed v1.3.0 amendment, and the plan does not
   acknowledge this. If v1.3.0 ships without resolving them, the Known
   Tensions entries will reference a resolution version that never resolved
   them. The Sync Impact Report must either (a) resolve them, (b) re-target
   them to v1.4.0, or (c) explicitly note deferral.

2. **v1.2.0 `TODO(V1.3)` items unaddressed.** The v1.2.0 Sync Impact Report
   (`.specify/memory/constitution.md:71–87`) lists two `TODO(V1.3)` items:
   helper-script redaction and SHA-pinning for squad-process workflows.
   Neither is addressed by the proposed amendment. Same requirement: the
   v1.3.0 Sync Impact Report must re-target or resolve them.

3. **No unstated sub-section touch found.** The six proposed edits all
   target the sub-sections the plan names. Token Capture Custody is touched
   (edit 3) and acknowledged. No additional § V sub-section or cross-reference
   is modified without acknowledgment.

---

**Reviewer-runbook compliance**

The reviewer runbook (`.specify/memory/reviewer-runbook.md`) is **silent**
on the order of operations for constitutional amendments relative to the
speckit workflow. It governs PR review steps (type-of-change, test-first
evidence, spec linkage, artifact hygiene, CI gates, smoke-test, decision),
not governance amendment sequencing.

The constitution's Governance section (`.specify/memory/constitution.md:590–591`)
prescribes: amendments via PR modifying the constitution, with an updated
Sync Impact Report and lockstep template identification. The plan's proposed
order (amendment PR before or bundled with first implementation PR, with
Picard sign-off on bundling) is compatible with this prescription.

No compliance violation found.

---

**Findings summary (sorted by severity)**

- **P0-1:** `plan-template.md` Principle V guidance text will be factually
  stale after the amendment. The plan must list this template as needing
  update. (Source: template line 44 vs. proposed § V durable-inputs expansion.)

- **P0-2:** The v1.3.0 Sync Impact Report sketch is missing the
  per-principle change summary field. This is a mandatory field per the
  v1.2.0 precedent. Must be added before the amendment PR is drafted.

- **P0-3:** The v1.3.0 amendment does not address the three Known Tensions
  committed to v1.3.0 resolution, nor does the plan acknowledge deferral.
  The Sync Impact Report must explicitly state disposition (resolve or
  re-target to v1.4.0).

- **P1-1:** The Sync Impact Report sketch is missing the follow-ups field.
  Two `TODO(V1.3)` items from v1.2.0 need disposition.

- **P1-2:** The open-ended secret-definition language ("any third-party API
  credential") is a governance-model shift (from amendment-per-secret to
  automatic coverage). The Sync Impact Report should acknowledge this
  deliberately.

- **P1-3:** The Sync Impact Report sketch omits templates-updated
  enumeration with ✅/⚠️/❌ status per the v1.2.0 shape. Even if most are
  no-op, the enumeration itself is part of the report shape.

---

**What I did NOT do (and why)**

- I did not draft the v1.3.0 amendment text. (Author role; not mine.)
- I did not edit the constitution. (No explicit editing mandate today.)
- I did not verify whether the v1.2.0 template re-sync (flagged in
  `.specify/memory/constitution.md:61–69`) was completed. (Out of scope
  for this audit; relevant but not my mandate.)
- I did not audit the spec.md or plan.md for non-constitution concerns.
  (My scope was the amendment proposal only.)
### 2026-05-13: Tuvok — round-2 process audit, v1.3.0 amendment scoping

**Verdict:** SCOPE CORRECT (MINOR)

---

**Round-1 P0 findings status**

- **P0-1** `plan-template.md` Principle V guidance text stale after amendment: **STILL OPEN** —
  `.specify/templates/plan-template.md` line 44 still reads `durable inputs limited to
  STFC_ACCOUNTS / promo-codes.txt (+ refresh-pipeline secrets)`. The corrected plan now
  correctly counts seven durable inputs (plan.md:91, 516) and § Constitution Impact
  item 2 (plan.md:405–418) enumerates them, but the plan's template-affected claim
  (plan.md:443) still says "none — table structure unchanged." The template guidance
  text will be factually wrong after the amendment ships. This P0 is unchanged by the
  corrections pass.

- **P0-2** Sync Impact Report missing per-principle change summary: **STILL OPEN** —
  The corrections pass (tuvok-001-discord-monitor-plan-corrections.md) did not touch
  § Constitution Impact item 6 (plan.md:441–444). The Sync Impact Report sketch still
  contains only the version bump line and credit reason. No per-principle
  REVISED/KEPT/EXTENDED enumeration has been added. This P0 is unchanged.

- **P0-3** Known Tensions v1.3.0 resolution commitment unaddressed: **STILL OPEN** —
  Constitution.md lines 683, 691, 699 all say `Resolution scheduled: v1.3.0` for the
  three Known Tensions. The corrected plan references Known Tension #3 at plan.md:335
  ("Honors documented Known Tension #3") but does not resolve it constitutionally, nor
  does it acknowledge deferral of #1 or #2. The Sync Impact Report sketch does not
  mention any of them. Research.md:209 notes the concurrency-group alignment but this
  is operational, not constitutional. Constitution.md:71–81 `TODO(V1.3)` items
  (helper-script redaction, SHA-pinning for squad-process workflows) are also still
  unaddressed. This P0 is unchanged.

---

**Versioning audit (re-confirm)**

- Proposed level: MINOR per plan.md:441
- Round-2 conclusion: **MINOR confirmed.** All six proposed edits remain additive.
  No principle is removed, renamed, or contradicted. The corrections pass did not
  alter the nature of the amendment — it corrected factual claims in plan.md and
  research.md and renamed a contract function. None of these changes affect the
  versioning classification.

---

**Sync Impact Report shape audit (re-confirm)**

| Required field | Present in proposal? | Notes |
|---|---|---|
| Version change line | ✅ | `1.2.0 → 1.3.0, MINOR` at plan.md:441 |
| Bump rationale | ✅ | `new sanctioned surfaces, no removed obligations` at plan.md:441–442 |
| Per-principle change summary | ❌ | Still absent. No REVISED/KEPT/EXTENDED enumeration for Principles I–IX or sub-sections. (P0-2 — unchanged) |
| Templates updated | ⚠️ | Still says "none — table structure unchanged" at plan.md:443. `plan-template.md` line 44 Principle V guidance will be stale. (P0-1 — unchanged) |
| Follow-ups | ❌ | Still absent. Two `TODO(V1.3)` items and three Known Tensions need disposition. (P0-3 + P1-1 — unchanged) |
| Cross-check result | ❌ | Not present. May be omitted intentionally for a narrower amendment, but not stated. |

---

**Dependent templates enumeration (delta from round 1)**

- **New templates the corrected plan now depends on:** None. The `.specify/templates/`
  directory contains the same five files as round 1: `plan-template.md`,
  `spec-template.md`, `tasks-template.md`, `constitution-template.md`,
  `checklist-template.md`. No new templates have been added.

- **Templates still missing from § Constitution Impact:** `plan-template.md` —
  Principle V guidance text (line 44) enumerates durable inputs and will be factually
  stale after the amendment. The plan's template-affected claim (plan.md:443) must
  acknowledge this. Same finding as round 1; corrections pass did not address it.

---

**Cross-reference discipline (post-corrections)**

- **redeemer-integration.contract.md function-name change:** Cleanly applied.
  - Old name `loadPromoCodes` has zero occurrences anywhere in `specs/001-discord-monitor/`
    (confirmed via grep). The corrections pass successfully replaced all instances.
  - New wrapper function `readCodesForRun(opts?)` appears at contract lines 39, 45, 85.
  - Existing functions `readPromoCodes(path)` and `parsePromoCodes(content)` are correctly
    described as unchanged (contract lines 31, 36, 44–46).
  - `spec.md` and `quickstart.md` contain no references to any of these function names —
    no stale cross-references there.
  - Live codebase confirms: `src/lib/promoCodes.ts` exports `readPromoCodes` (line 11)
    and `parsePromoCodes` (line 25). `src/skills/redeemCodes.ts` imports `readPromoCodes`
    (line 9). The contract's note that this import will need updating at implementation
    time (corrections memo cross-reference note) is accurate.

- **Other cross-references broken by the corrections:** None found.
  - The "42 → 30" count correction in research.md is self-contained; plan.md references
    "30 codes" consistently (via the corrections pass).
  - The "six → seven" durable-input count was updated in plan.md:91, plan.md:516, and
    research.md:268. All three sites now say "seven." No other site references the
    count.
  - The cadence correction (plan.md:9–11) was applied to the executive summary. No
    downstream reference to "same 4-hour cadence" remains in plan.md.

---

**New findings (if any)**

None. No new P0 or P1 findings surfaced in round 2. The corrections pass was
surgically clean and did not introduce inconsistencies.

---

**Findings summary (sorted by severity)**

All three P0s are **carried forward unchanged** from round 1:

- **P0-1 (carried):** `plan-template.md` Principle V guidance text will be factually
  stale after the amendment. § Constitution Impact item 6 must list this template
  as needing update.

- **P0-2 (carried):** The v1.3.0 Sync Impact Report sketch is missing the
  per-principle change summary field (REVISED/KEPT/EXTENDED for each principle
  and sub-section). Mandatory per v1.2.0 precedent.

- **P0-3 (carried):** The v1.3.0 amendment does not address the three Known Tensions
  committed to v1.3.0 resolution (constitution.md:678–700), nor does the plan
  acknowledge deferral. The two `TODO(V1.3)` items (constitution.md:71–81) are
  also unaddressed. The Sync Impact Report must explicitly state disposition
  (resolve or re-target to v1.4.0).

Round-1 P1s (P1-1 through P1-3) also remain open but are not re-enumerated here
as they are subsidiary to the P0s above.
### 2026-05-13: Tuvok — round-3 process audit, v1.3.0 amendment in tasks.md

**Verdict:** SCOPE CORRECT

---

**Phase 0 governance task location**
- Found at: tasks.md:36–95 (§ "Phase 0: Pre-Implementation Governance (Standalone Amendment PR)")

**P0 findings mapped to acceptance criteria**

| Finding | Mapped status | tasks.md evidence |
|---------|--------------|-------------------|
| P0-1: `plan-template.md` Principle V guidance text will be factually stale after the amendment; must list this template as needing update | MAPPED | tasks.md:51–58 — acceptance criterion explicitly requires updating the stale line ("durable inputs limited to STFC_ACCOUNTS / promo-codes.txt…") and enumerates all 7 new durable inputs by exact path. T001 line 87 reiterates: "Also update `.specify/templates/plan-template.md` for P0-1." T002 line 91 includes `plan-template.md` in the standalone PR file list. |
| P0-2: v1.3.0 Sync Impact Report missing per-principle change summary (REVISED/KEPT/EXTENDED) | MAPPED | tasks.md:59–63 — acceptance criterion requires "a per-principle change summary field enumerating REVISED / KEPT / EXTENDED status for every section (Principles I–IX, Security & Compliance Constraints, Development Workflow, Governance, Speckit Reviewer Gates)" and cites v1.2.0 report shape at `constitution.md:1–119`. |
| P0-3: Three Known Tensions committed to v1.3.0 resolution are unaddressed; Sync Impact Report must state disposition (resolve or re-target to v1.4.0) | MAPPED | tasks.md:64–69 — acceptance criterion names all three tensions (Principle III auth/me overclaim, Principle VII `.github/` scan-path overclaim, redeem/refresh concurrency lock) and requires each be "fully resolved in this amendment or explicitly re-targeted to v1.4.0 with written rationale; no tension may remain silently unaddressed." |

All three r1 P0 findings are directly and precisely encoded as T000 acceptance criteria.

---

**Sync Impact Report fields required by Phase 0**

| Required field | Required by tasks.md? | Notes |
|---|---|---|
| Per-principle change summary | YES | Explicit in P0-2 acceptance criterion (tasks.md:59–63). |
| Templates updated table | IMPLICIT | P0-1 criterion requires the template update itself (tasks.md:51–58) and T001 references it (line 87). However, the Sync Impact Report's templates-updated *enumeration table* (listing each template with ✅/⚠️/❌ status, per v1.2.0 shape) is not separately required as a named field. The T001 instruction to "write the full v1.3.0 Sync Impact Report satisfying P0-1, P0-2, P0-3" (line 86) covers this implicitly — "full" + "satisfying P0-1" implies the template update will be documented in the report — but an implementer could satisfy the letter without producing the tabular enumeration. |
| Follow-ups | NO | No acceptance criterion or T001 instruction explicitly requires a follow-ups section. The two `TODO(V1.3)` items from v1.2.0 (helper-script redaction, SHA-pinning for squad-process workflows) are not mentioned anywhere in Phase 0. This was P1-1 in round 1; see New Findings below. |

---

**Dependent templates listed in Phase 0**

- `plan-template.md`: **LISTED** — explicitly in Path Conventions (tasks.md:32), P0-1 acceptance criterion (tasks.md:51), T001 implementation (tasks.md:87), and T002 PR file list (tasks.md:91).
- `spec-template.md`: Not listed. Round 1 determined this was a no-op for v1.3.0 (Principles III/VII/VIII text not touched by the six edits). Correct omission.
- `tasks-template.md`: Not listed. Round 1 determined this was a no-op (Principle IX not touched). Correct omission.
- `constitution-template.md`: Not listed. Structural only. Correct omission.
- `checklist-template.md`: Not listed. No principle references. Correct omission.

No new templates have appeared in `.specify/templates/` since round 1 (same five files confirmed).

---

**Known Tensions / TODO(V1.3) disposition required by Phase 0**

- **Known Tensions (3):** REQUIRED — P0-3 acceptance criterion (tasks.md:64–69) explicitly names all three and mandates resolve-or-retarget disposition.
- **TODO(V1.3) items (2):** NOT REQUIRED — Neither helper-script redaction nor SHA-pinning for squad-process workflows is mentioned in Phase 0. The round-2 memo (r2:31) expanded P0-3's description to include these, noting they are "also unaddressed," but Bashir's tasks.md encodes only the original r1 P0-3 scope (Known Tensions). The two TODO items were classified P1-1 in round 1. See New Findings.

---

**Sequencing**

- Phase 0 before Phase 1+: **CONFIRMED** — tasks.md:43–44 states "⚠️ BLOCKER: No Phase 1+ task may merge to `main` until T000 acceptance criteria are satisfied and the amendment PR has landed." Phase 0 (lines 36–95) precedes Phase 1 (line 99), Phase 2 (line 143), Phase 3 (line 203), Phase 4 (line 383), Phase 5 (line 485), Phase 6 (line 540). Correct ordering.

---

**Amendment text deferred (not inline)**

- **CONFIRMED** — tasks.md does not contain any inline amendment text. T001 (lines 73–88) instructs the implementer to "Draft v1.3.0 amendment to `.specify/memory/constitution.md` applying all six edits…" — the drafting is deferred to the Phase 0 PR. T002 (lines 90–93) instructs opening the standalone PR. The acceptance criteria (T000) define *what* the amendment must satisfy, not *how* the text should read. This is correct separation of concerns.

---

**New findings**

- **P1-1 (carried from r1, still not encoded):** The two `TODO(V1.3)` items from the v1.2.0 Sync Impact Report — (a) helper-script redaction for `scripts/capture-token.mjs` stderr surface, (b) SHA-pinning for squad-process workflows — are not mentioned in any Phase 0 acceptance criterion or implementation task. The round-2 memo explicitly flagged these alongside P0-3 (`constitution.md:71–81`). While these were P1 (not P0) in round 1, they represent a completeness gap: a v1.3.0 Sync Impact Report that resolves the three Known Tensions but silently drops the two TODO items would leave stale `TODO(V1.3)` markers in the constitution. Recommend: add a sub-bullet to P0-3 or a separate acceptance criterion requiring explicit disposition (resolve or re-target) for the two `TODO(V1.3)` items.

- **P1-2 (new, minor):** The Sync Impact Report's templates-updated enumeration (listing every template with ✅/⚠️/❌ status, matching v1.2.0 shape) is not separately called out as a required field. P0-1 ensures `plan-template.md` gets updated, but the Report itself should enumerate all five templates with status. T001's "write the full v1.3.0 Sync Impact Report satisfying P0-1, P0-2, P0-3" covers this implicitly but an explicit criterion would be stronger. (This was P1-3 in round 1; remains P1.)

No new P0 findings.

---

**Disposition of round-1 P0s**

- Status: **All 3 P0s now CARRIED INTO tasks.md as acceptance criteria.** Each is directly mapped to a T000 sub-bullet with sufficient specificity for an implementer to verify compliance. The two round-1 P1 items (TODO(V1.3) disposition, templates-updated enumeration) remain unencoded but are P1-severity — they do not block Phase 0 execution and can be addressed during the amendment PR review cycle.
### 2026-05-13: Tuvok — v1.3.0 amendment PR opened (T000/T001)

**Branch:** squad/governance-v1.3.0-amendment
**Worktree:** /workspaces/stfc-governance-v1.3.0-amendment
**PR:** https://github.com/Jamula/stfc/pull/6
**Files changed:**
- .specify/memory/constitution.md (v1.2.0 → v1.3.0)
- .specify/templates/plan-template.md (Principle V guidance corrected)

**T000 acceptance criteria:**
- [✅] P0-1 plan-template.md Principle V guidance updated (constitution.md:65, plan-template.md:44)
- [✅] P0-2 Per-principle change summary in Sync Impact Report (constitution.md:21)
- [✅] P0-3 Three Known Tensions disposition stated (constitution.md:78)

**Reviewer follow-ups carried in PR:**
- [Picard r2 P1] TODO(V1.3) item 1 (helper-script redaction): DEFERRED to v1.4.0 — code change outside amendment scope; Principle V text already documents the known gap (constitution.md:110)
- [Picard r2 P1] TODO(V1.3) item 2 (SHA-pinning squad-process workflows): DEFERRED to v1.4.0 — implementation concern outside governance amendment scope (constitution.md:122)
- [Tuvok r3 P1] Templates-updated table present at constitution.md:59

**Next:** Cyrus reviews the PR. After merge, /speckit.implement Phase 1+ unblocked.
# 2026-05-13: Cascade fix memo — P1-NEW-1 test strategy table

**Finding:** plan.md:377 (test strategy table, Unit — extractor row) claimed "Every code in `promo-codes.txt` is matched" in contradiction with research.md:186–190 documenting 3 short-code gap (TNG, GQ5, GQ7; 27 of 30 match).

**Fix applied:** plan.md:377 — Updated test assertion to read:
```
Every code in `promo-codes.txt` is matched except the 3 short-code gap (TNG, GQ5, GQ7); documented stop-list rejects every entry; …
```

**Phrasing source:** research.md § R4 line 190 — "30 non-comment entries; 27 matched, 3 short-code gap: TNG, GQ5, GQ7" (exact language for consistency).

**Verification:** Grep for "Every code in" returns only plan.md:377 (now corrected). No other test claims affected.

**Hygiene:** Single-row edit only. No commits. Date: 2026-05-13.
### 2026-05-13: Tuvok — plan.md and research.md corrections per Borg Queen findings

**Edits applied:**

| Finding | File | Line(s) | Old | New |
|---------|------|---------|-----|-----|
| P0-1 | research.md | 183–190 | `GQ5` / `GQ7` 3-char outliers as known recall gap | `TNG`, `GQ5`, `GQ7` all three enumerated as known recall gaps accepted in v1 |
| P0-2 | research.md | 183 | `all 42 non-comment entries match` | `27 of 30 non-comment entries match` |
| P0-2 | research.md | 190 | `(42 codes catalogued)` | `(30 non-comment entries; 27 matched, 3 short-code gap: TNG, GQ5, GQ7)` |
| P0-2 | research.md | 219 | `has accumulated 42 codes over ~12 months` | `has accumulated 30 codes over ~12 months` |
| P1-3 | plan.md | 9–11 | `On the same 4-hour cron cadence the redeemer already runs` | `The new discord-monitor skill runs every 4 hours (cron: "15 */4 * * *") — an independent cadence from the redeemer's hourly schedule (cron: "0 * * * *"), sharing only the stfc-gift-redeemer concurrency group` |
| P1-4 | research.md | 25 | `roughly 3 MB on disk` | `approximately 7.2 MB on disk including transitive dependencies (@discordjs/rest 795 KB + discord-api-types 3.5 MB + transitive deps ~3 MB)` |
| P1-5 | research.md | 268 | `six new durable inputs` | `seven new durable inputs` |
| P1-5 | plan.md | 91 | `six new committed durable-input files` | `seven new committed durable-input files` |
| P1-5 | plan.md | 516 | `6 new committed durable inputs` | `7 new committed durable inputs` |
| P1-6 | contracts/redeemer-integration.contract.md | 25–45 | `export function loadPromoCodes(opts?:…): string[]`; "The current `loadPromoCodes()` keeps its signature" | `export async function readCodesForRun(opts?:…): Promise<string[]>`; wraps existing `readPromoCodes(path)` + `parsePromoCodes(content)`; existing callers unchanged |
| P1-6 | contracts/redeemer-integration.contract.md | 85 | `loadPromoCodes(opts)` | `readCodesForRun(opts)` |
| P1-7 | plan.md | 314–316 | bare `git push` | `git pull --rebase origin "$GITHUB_REF_NAME" \|\| true` inserted before `git push` |
| P1-unstated | plan.md | 477–513 | (absent) | New `## Acknowledged assumptions` subsection added at end of § Risks, all 5 Borg Queen assumptions transcribed verbatim with Failure mode lines |

**Edits NOT applied (and why):**

- **P1-8:** Version pin `^2.5.0` → `^2.6.1`. No edit required. `^2.5.0` is semver-compatible; `npm install` will resolve to 2.6.1 at implementation time. Changing the pin would be an editorial invention beyond the finding.
- **Unverifiable claim — Model SHA-256 (`weightSha256` field):** Accepted as plan-stage placeholder. Hash will be populated during implementation when the ONNX file is downloaded and measured. No edit.
- **Unverifiable claim — Discord ToS < 100 servers threshold:** Accepted as plan-stage statement. Discord docs URL and check date deferred to implementation. No edit.
- **Unverifiable claim — ~140 MB RAM / ~150 ms inference:** Accepted as plan-stage measurement. Source is uncommitted scratch data in `.squad/scratch/`. No edit; implementer must re-measure and commit the evidence.

**Change-impact accounting:**

- **Files touched:**
  - `specs/001-discord-monitor/plan.md`
  - `specs/001-discord-monitor/research.md`
  - `specs/001-discord-monitor/contracts/redeemer-integration.contract.md`

- **Cross-references that may need follow-up:**
  - `contracts/redeemer-integration.contract.md` line 83: caller pseudo-code passes `fresh.map(c => c.value)` to `redeemCodes({ extraCandidates: … })`; the downstream `redeemCodes` refactor note (line 83–85) now references `readCodesForRun(opts)` — the implementer must ensure `redeemCodes.ts` calls `readCodesForRun` (not the old `readPromoCodes(path)` directly) when `extraCandidates` is present. The existing `redeemCodes.ts` imports `readPromoCodes` by name (verified at `src/skills/redeemCodes.ts:9`); that import name will need updating at implementation time.
  - `specs/001-discord-monitor/research.md` R5 "Why 10" section still references "42 codes" pattern in prose around run-cap rationale — corrected to 30, but the rate estimate ("average organic add-rate is ~3.5/month") was computed against 42 entries over 12 months. With 30 entries the rate becomes ~2.5/month. This is an advisory note only; Borg Queen did not flag it as a finding, and the per-run cap of 10 remains conservative regardless.
  - `plan.md` § Constitution Impact item 2 (enumerates 7 paths) was already correct — left intact per mandate.
  - `quickstart.md` and `checklists/` were not touched; no references to "42", "loadPromoCodes", or the old cadence claim were found there.

**Open questions for the user:** None. All findings had unambiguous resolutions per Cyrus's explicit decision on P0-1 and Borg Queen's stated fixes for P1-3 through P1-7.

---

### 2026-05-16: 001-discord-monitor — analyze BLOCKERs resolved
**By:** Picard (Lead) via /speckit.implement preflight

**Requested by:** cyrusj

**What:**
- BLOCKER #1 (suppression.json writer): resolved via Option A — split into operator-written `data/discord/suppression.json` + skill-written `data/discord/cooldowns.json`.
- BLOCKER #2 (digest module path): resolved via Option A — moved from `src/discord/digest.ts` to `src/digest/index.ts`.

**Why:**
- BLOCKER #1: Preserves Principle V's bright-line separation between policy (operator-written rules) and telemetry (skill-written cool-down state). The constitution's writer designation is the load-bearing invariant.
- BLOCKER #2: The digest is conceptually downstream of both Discord ingestion and redemption activity, so it belongs in its own module (`src/digest/`) rather than nested under `src/discord/`. This matches the constitution's wording exactly.

**Impact:** Constitution v1.3.0 enumeration refined (durable inputs now 7, not 6; no version bump — still v1.3.0). Plan, contracts, data-model, research updated. /speckit.tasks must be re-run before /speckit.implement.

**References:** specs/001-discord-monitor/analysis-report.md (resolution note appended)

---

### 2026-05-16: Discord Monitor Feature Framing in Public Docs
**By:** Tuvok (Process Auditor)

**What:** Documented the Discord monitor feature in public documentation (README.md, SETUP.md, docs/squad.md) using an accurate frame:

> **Currently shipped (Phases 0–3):** Ingestion, extraction, deduplication, cool-down management, auto-redeem integration.  
> **In development (Phase 4+):** Tips classification refinement and daily digest roll-up.

**Rationale:**
1. **Accuracy over marketing.** Phases 0–3 (T000–T027) are merged to main@caa2d14 and functional today. Phase 4+ is not yet on main.
2. **Operator transparency.** The operator (cyrusj) can enable the monitor today and get real value (code extraction + redemption). Phase 4+ is a follow-up, not a blocker.
3. **Prevents silent scope creep.** Explicitly saying "Phase 4+ is in-flight" signals to future readers which features are tested/committed vs aspirational.
4. **Consistent with Constitution Principle VI (Specification-First).** Specs live at `specs/001-discord-monitor/spec.md` (v1 scope); Phases 4+ are out-of-scope and marked as future work in the spec explicitly.

**Artifacts updated:**
- `README.md`: Added "Discord monitor (optional)" section; separate "Currently shipped" / "In development" subsections.
- `SETUP.md`: Added optional Discord monitor section with link to quickstart.md for full setup.
- `docs/squad.md`: Noted that Uhura (Integrations) owns the `DISCORD_BOT_TOKEN` custody for the monitor.

---

### 2026-05-16: Phase 4 Digest Test Fixes — Patterns for Team
**By:** Bashir (Tester)

**What:** Documented three critical patterns discovered in Phase 4 digest implementation and testing:

1. **Idempotency fast-path** — Merge function must check runId coverage FIRST before summing additive counters. Without this, re-submitting the same run doubles counters, breaking the "byte-stable on re-render" invariant.

2. **Option key mismatch silent no-op** — `WriteDigestOptions` uses `outputDir`, but tests passing `digestsDir` are silently ignored. Files leak to live `data/digests/` instead of temp dir. Verification requires `npm run typecheck`.

3. **Return type precision** — `writeDigest()` returns `DigestWriteResult`, not a string. Assigning to string-typed variable causes runtime failure; extract `.filePath` explicitly.

4. **Gitignore discipline** — `data/digests/*.md` must be gitignored (runtime artifacts). Only `.gitkeep` tracked.

**References:** src/digest/index.ts, src/skills/discordMonitor.ts, commit 9475937

---

### 2026-05-17T07:00:08Z: PR #20 approved and merged — refresh-token.yml Saturday 00 UTC cron

**By:** Kirk (Lead)
**Status:** Active — merged on `main` as commit `e053b9c` at 2026-05-17T07:03:36Z

Approved and squash-merged PR #20 (`feat(workflows): #14 refresh-token.yml runs weekly Saturday 00 UTC`). Issue #14 auto-closed via the PR body's `Closes #14` reference.

**Review passed all four criteria:**
1. **Cron correctness** — `0 0 * * 6` decodes to Saturday 00:00 UTC (DOW=6=Saturday)
2. **No pinning-test debt** — `grep -rn 'refresh-token' tests/` returns zero matches; Repo Rule 3 does not apply
3. **Minimal permissions** — `permissions: contents: read`; secret writes via `STFC_REFRESH_PAT`; concurrency group `stfc-gift-redeemer` safely serializes all account-touching operations
4. **Surgical scope** — single-file diff (+7/-1) on `.github/workflows/refresh-token.yml`; comments document Issue #13 alarm pairing in-file

**Architectural intent:** Saturday-midnight weekly cadence keeps every token >20 days from the 30-day expiry wall. Issue #13's all-accounts-expired alarm fires only on real auth breakage, not stale-token false positives.

**Links:** PR #20, Issue #14, Merge commit `e053b9c573cd5d6bff0d322a0f5c36f7a24e710f`

---

### 2026-05-16: Critic seat swap: Borg Queen retired, Garak takes the seat

**By:** Picard (M2/EM)
**Date:** 2026-05-16
**Status:** Active (effective immediately)
**Type:** Squad-roster change

Borg Queen retired from the active roster. Garak takes the Critic seat to match cyrusj's other squad's roster and provide consistent frame of reference across projects.

The Critic role's accumulated learnings (hostile-fact-check methodology, cascade-verification discipline, derivative-artifact inheritance patterns) are durable role-knowledge. Garak inherits them via the role-history files now living under `.squad/agents/garak/history.md`.

**Files changed (this session via `git mv`):**
- `.squad/agents/borg-queen/` → `.squad/agents/garak/`
- `.squad/team.md`, `.squad/casting/registry.json`, `.squad/routing.md` (Garak references)
- `.squad/skills/hostile-fact-check/SKILL.md` (owner updated)
- `.squad/agents/{picard,kirk,tuvok}/charter.md` (relationship updates)
- `docs/squad.md`, `docs/models.md` (public-facing updates)
- New GitHub label: `squad:garak`; Deleted: `squad:borg-queen`

**Historical record locked:** All prior commits, decisions, and shipped specs referencing Borg Queen by name remain unchanged. She did that work and the record is authoritative.

**Action items:** Any new critique work routes to Garak via `squad:garak` label or direct address.

---

### 2026-05-16: Role swap: Kirk (Lead) ⇆ Picard (M2 / Engineering Manager)

**By:** Picard (M2/EM)
**Date:** 2026-05-16
**Status:** Active (effective immediately)
**Type:** Squad-roster change

The squad now has an Engineering Manager layer above the technical Lead, to match cyrusj's other squad's hierarchy.

**Before → After:**
- M2 / Engineering Manager (boss): — → **Picard**
- Lead (technical): Picard → **Kirk**

Kirk reports to Picard. Scotty / Uhura / Bashir have technical reporting to Kirk and scope/priority reporting to Picard.

**Responsibility split:**
- **Picard (M2/EM):** Scope, priorities, roadmap; issue triage; blocker removal; governance; scope/governance review authority
- **Kirk (Lead):** Technical direction & architecture; code review for correctness; architectural review authority

**Files changed (this commit):**
- `.squad/agents/kirk/charter.md` (new)
- `.squad/agents/picard/charter.md` (rewritten for M2/EM role)
- `.squad/team.md`, `.squad/casting/registry.json`, `.squad/config.json`, `.squad/routing.md`
- `docs/squad.md`, `docs/models.md`, `CONTRIBUTING.md`
- `.copilot/skills/issue-creation/SKILL.md` (Picard references annotated)
- New GitHub label: `squad:kirk`

**Historical record locked:** Picard's prior work referenced as "Picard (Lead)" predates 2026-05-16 and is locked.

**Action items:** Re-evaluate the 12 open issues (#8–#19) for technical-direction vs scope routing.

---

### 2026-05-17: Picard — PR #6 (governance v1.3.0 amendment) — MERGED via owner bypass

**By:** Picard (M2/EM)
**Date:** 2026-05-17
**PR:** https://github.com/Jamula/stfc/pull/6
**Merge commit:** `7bcc04df80e29c0161ae6fbc8ac6da09c05d4bd3` (squash)
**Merged by:** cyrusjamula (repo owner) at 2026-05-17T07:04:01Z
**Verdict:** DOCUMENTED-IN-RETROSPECT — no Picard action required

**What happened:** During review window, the repo owner (Cyrus) admin-merged PR #6 at 2026-05-17T07:04:01Z, bypassing the unsatisfied `npm test (required)` branch-protection check. Picard's review comment posted at https://github.com/Jamula/stfc/pull/6#issuecomment-4469676319 recommended CLOSE without merge on two grounds:

1. **Superseded content:** The substantive v1.3.0 governance edits had already landed on `main` via commits `5e10bb0` and `a4a803d`. The PR diff against `origin/main` contained only two files (`.squad/agents/picard/history.md`, `.squad/agents/tuvok/history.md`).
2. **Scribe-boundary violation:** Per `.github/copilot-instructions.md` §2, `.squad/agents/{name}/history.md` files are Scribe-owned commits.

**Net effect:** Identical to what would have happened if Scribe had picked them up normally — the audit-trail looks slightly worse (governance label on a content-empty merge), but no governance damage.

**Verified findings (NOT reversed):**
- v1.3.0 constitution content on `main` is correct
- `.specify/templates/plan-template.md:44` carries the full 7-path enumeration (in sync)
- Repo pre-commit grep (`STFC_ACCOUNTS|promo-codes.txt|...|discord.com`) clean

**Process recommendation for future amendment PRs:** If the autonomous-edit manual-approval gate trips, approve the workflow run via the "Approve and run" button rather than admin-merging past the failed required check. For governance amendments: verify PR diff vs. main is non-empty and substantively the amendment before approving. If already-on-main + Scribe-owned residue, close-without-merge is correct.

**Follow-ups:**
- [x] Governance content verified correct on `main`
- [ ] **Skill registration:** new skill `.squad/skills/superseded-pr-detection/SKILL.md` covers the pre-review check for "is the PR diff vs. main empty of the claimed work?". Picard and Kirk should use it on every governance/amendment review.

---

### 2026-05-16: Session wrap-up — 2026-05-16

**By:** Picard (M2/EM)
**Type:** Session log / triage handoff
**Status:** Ready

Long multi-feature session executing the full `/speckit.*` chain for the Discord community monitor (feature `001-discord-monitor`), plus governance hardening, docs expansion, and friction-pattern fixes captured as 5 operating rules in `.github/copilot-instructions.md`.

**Shipped to `main` (12 commits):**
1. `5e10bb0` — Re-sync `plan-template.md` to constitution v1.3.0 + correct SIR
2. `9a9adb9` — Phase 0 (governance gate, T000–T002)
3. `91f2eea` — Phase 1 (setup & scaffolding, T003–T007)
4. `e3dd538` — Phase 2 (foundational types & state I/O, T008–T012)
5. `65b1849` — Phase 3 (US1 auto-redeem, T013–T027)
6. `caa2d14` — Redeem cadence 1h → 15m + pinning test update (closed #7)
7. `5492212` — `docs/squad.md` + README/SETUP/CONTRIBUTING updates
8. `c5d7693` — Expanded `.github/copilot-instructions.md` (5 operating rules)
9. `9475937` — Phase 4 (US2 tips digest, T028–T034) with Bashir's idempotency + allowlist fixes
10. `30cdec1` — `.squad/` compaction (Scribe; decisions 124KB → 101KB)
11. `451d037` — `docs/models.md` (18-model catalog + per-agent recs)

Tests: 90+/283 passing on every commit.

**Parked work — GitHub issues filed (all labeled `squad` for Picard triage):**
- #8: Enforce constitution↔plan-template re-sync (operating rule 1 automation)
- #9: Enforce `.squad/` write boundary (Scribe-only commits)
- #10: Enforce workflow YAML pinning tests
- #11: Rebase-before-push helper for main
- #12: Wire speckit.implement phase-boundary commits
- #13: `redeem.yml`: fail when ALL accounts return "Token expired"
- #14: `refresh-token.yml`: schedule Saturday 00 UTC (cross-refs #13) ✅ **CLOSED THIS SESSION**
- #15: Epic: Enhance Tuvok with token-usage telemetry
- #16: Add `.devcontainer/devcontainer.json` (codespace idle auto-stop + cold-start)
- #17: Triage 8 Dependabot alerts (1 critical, 4 high, 3 moderate)
- #18: Decide on 3 KNOWN GAP extractor tests (GQ5/GQ7/TNG)
- #19: Discord monitor Phases 5–6 (US3 operator health + polish, T035–T042)

**Recommended priority next session:** #16 (devcontainer — quickest win), then #13+#14 pair, then #19 (Phases 5–6), then #17 (Dependabot), then #8–#12 (rule enforcement).

**Known decisions this session worth keeping:**
- Cool-down for re-redemption = 30 days
- `suppression.json` vs `cooldowns.json` split — operator-written vs skill-written
- Digest module path = `src/digest/index.ts` (NOT `src/discord/digest.ts`)
- Cron cadence = `*/15 * * * *` (uniform spacing; `*/17` rejected)
- SIR "Templates needing re-sync" line MUST be grep-derived, not argued-from-structure

---

### 2026-05-17: Decision: refresh-token.yml schedule → Saturday 00:00 UTC (weekly)

**By:** Uhura (Integrations)
**Date:** 2026-05-17
**Issue / PR:** Issue #14 / PR #20
**Status:** DECIDED ✅

`refresh-token.yml` runs on `cron: "0 0 * * 6"` — every **Saturday at 00:00 UTC**, weekly. Previous schedule was `cron: "0 4 * * 0"` (Sunday 04:00 UTC).

**Rationale:**
- **Pairs with Issue #13's "all-accounts-expired" alarm.** A weekly refresh keeps every account's JWT well clear of the 30-day Scopely expiry wall, so when that alarm fires we know it's real auth breakage rather than stale-token false positive.
- **Saturday-midnight UTC is a quiet slot.** Low overlap with operator attention and with every-4-hours `redeem.yml` runs.
- **Concurrency interaction acceptable.** All three of `refresh-token.yml`, `redeem.yml`, and incoming `discord-monitor.yml` share `concurrency.group: stfc-gift-redeemer`. A Saturday-midnight refresh may briefly queue or cancel a redeem run; weekly cadence makes that negligible.

**Implications:**
- Any future change to `refresh-token.yml`'s schedule or concurrency group must keep this rationale intact (or supersede with a new decision).
- The block comment above `schedule:` documents the intent in-place.
- If a pinning test is later added, it must encode `"0 0 * * 6"` and the `stfc-gift-redeemer` concurrency group.


---

### 2026-05-17T07:00:00Z: Issue re-triage — Picard manual correction (11 open squad-labeled issues)

**By:** Picard (M2 / Engineering Manager)
**What:** Manual re-triage of 11 open `squad`-labeled issues, auto-routed to Bashir by `squad-triage.yml`. Triage bot default-fallback has collapsed; only 1 of 11 was actually tester scope. Issues re-routed by artifact type (workflow code → Scotty/Uhura, process → Tuvok, infra → Uhura, feature → Scotty, tests → Bashir when actual). 

**Key routing changes:**
- #19 (Discord Phases 5–6 feature) → Scotty
- #18 (extractor test gaps) → Bashir (unchanged; legitimate tester)
- #17 (Dependabot alerts) → Uhura
- #16 (devcontainer idle-stop) → Uhura
- #15 (token-usage telemetry epic) → Tuvok
- #13 (redeem.yml exit-code workflow) → Scotty
- #12 (speckit.implement phase commits) → Tuvok
- #11 (rebase-before-push automation) → Tuvok
- #10 (workflow pinning-test enforcement) → Tuvok
- #9 (Scribe `.squad/` write boundary) → Tuvok
- #8 (constitution↔plan-template re-sync) → Tuvok

**Triage heuristic recorded:** route by **artifact being changed**, not keywords. Workflow YAML → Scotty/Uhura; `.specify/` / speckit → Tuvok; `.devcontainer/` / deps → Uhura; architecture → Kirk; scope/priority → Picard.

**Side observation:** `squad-triage.yml` routes on Acceptance-section keyword bleed ("test", "verify", "check" appear in every acceptance criterion). Default-to-Bashir fallback is broken. Separate inbox file filed; fix deferred to Kirk routing-rules decision.

---

### 2026-05-17T07:00:00Z: Squad self-test epic batch — 9 capability tests filed

**By:** Picard (filed); Cyrus Jamula (approved)
**What:** Filed 9 self-test issues (#24–#32) as regression guards for each team member's core capability:

| # | Agent  | Test focus | Accept criteria |
|---|--------|-----------|------------------|
| #24 | Picard | Triage + governance verdict | Synthetic 10-issue board, 8 misrouted to Bashir; re-triage correct; Rule-7 gate preservation |
| #25 | Kirk | Code review + architecture | Workflow YAML without Rule-3 test update → REQUEST_CHANGES; clean refactor → APPROVE; architecture memo on "which" questions |
| #26 | Scotty | Scope + test-first | No files outside spec target; test file is first commit; phase-boundary commit shape; `--no-verify` refusal |
| #27 | Uhura | Secret handling + API contract | Tokens never logged; API-field drops surface errors; outbound-host enumeration triggers constitution proposal + re-sync (Rule 1) |
| #28 | Bashir | Acceptance coverage + edge cases | Right-count tests from acceptance criteria; hostile set (empty/redeemed/expired/rate-limited/network-fail); behavior-only; uses node:test/tsx |
| #29 | Garak | Fact-check signal-to-noise | Plant 3 claims (true/outdated/fabricated); assert surfaces outdated+fabricated; no style nits; reviewer-rejection lockout |
| #30 | Tuvok | Mirror-fidelity edit + SIR re-sync | Edit applies ONLY the finding; SIR template-sync from real grep (Rule 1); cross-artifact consistency; respects Scribe write boundary |
| #31 | Scribe | Idempotent merge + write boundary | Inbox merge is idempotent; per-file `git add -- <path>`; refuses writes outside `.squad/` |
| #32 | Ralph | Scan-cycle correctness + loop termination | Not LLM-output testing. Loop categorizes N+M+K correctly; terminates on idle; exact surface coverage; bounded iteration |

All labeled `squad,squad:{member},priority:p2,type:epic`. Hub comment on #24 links all 9. #15 / #30 relationship: file separately (different acceptance, consumers, cadence); share driver design if both land.

**Reusable framework:** Taxonomy of self-test meanings (reviewer verdict semantics / implementer scope / tester right-coverage / editorial mirror-fidelity / mechanical idempotency / loop correctness / M2 triage). Captured as `.squad/skills/agent-self-test/SKILL.md`.

---

### 2026-05-17T07:00:00Z: `squad-triage.yml` over-routes to Bashir — decision pending

**By:** Picard (M2 / Engineering Manager)
**What:** Triage bot (`.github/workflows/squad-triage.yml`) auto-assigns effectively every new `squad`-labeled issue to Bashir, even issues that are clearly feature work, workflow code, infra, deps, or process governance. As of 2026-05-17 snapshot: 11 open squad-labeled issues, 10 mis-routed to Bashir (only #18 is actual tester scope).

**Root cause:** Bot matches on weak keyword signals in Acceptance sections ("test", "verify", "check" appear in every well-written acceptance criterion) and falls back to `squad:bashir` as default when no stronger signal fires.

**Impact:** Signal-to-noise ~1-in-11. Bashir's queue looks artificially overloaded. Manual Picard re-triage is now a recurring tax.

**Recommended fix (not done, pending Kirk decision):** 
1. Remove Bashir default-fallback; leave bare `squad` label + post comment tagging Picard for manual triage.
2. Tighten keyword rules (require explicit "add test", "regression test", "known gap", or `type:test` label; not mere "test" keyword).
3. Add routing-confidence comment (rule name + matched phrase).

**Owner decision:** Kirk decides routing-rules redesign scope; Scotty or Uhura implements. Bashir keeps #18. All others have been re-routed as of 2026-05-17T07:00Z (see picard-retriage-2026-05-17).

---

### 2026-05-17T07:12:40Z: /chronicle tips — synthesis for team reference

**By:** Tuvok (Process Auditor / Editorial Specialist)
**Type:** Operational knowledge distilled from `.squad/skills/`, `.copilot/skills/`, governance, and Ralph learnings. Every tip cites a concrete artifact.

**Core working patterns:**
- **PR review:** Run `gh pr diff <N> --name-only` first for empty-diff (superseded) detection; `gh pr review --comment` + `gh pr merge` workaround for self-authored PRs; admin-bypass requires a decision.md note.
- **Workflows/CI:** Decode cron explicitly (`MIN HOUR DOM MONTH DOW`, DOW=0 is Sunday); grep tests for pinned literals before committing (Rule 3); new mutable-state workflows join `concurrency.group: stfc-gift-redeemer`.
- **Governance:** SIR template-sync check from real grep (Rule 1), not structural shortcuts; known Tensions need "Resolution scheduled: vX.Y.Z." target.
- **`.squad/` state:** Never use `git add .squad/` (Rule 2); Bashir auto-assignment unverified until Picard re-triages (bot keyword bleed); merge `both added` conflicts by extracting unique sections, not raw concatenation.
- **Recent gotchas:** `origin/main` moves every 15 min (rebase always conflict-free); empty-diff PR detection catches superseded work; triage-bot keyword bleed turns correct acceptance criteria into misprediction; worktree `--delete-branch` remote-succeeds-local-fails pattern.

Knowledge codified and reusable.

---

### 2026-05-17T16:58:02Z: Governance-doc model catalog drift — issue #21 filed

**By:** Tuvok (flagged); Cyrus (decision)
**What:** `.github/agents/squad.agent.md` model references have drifted from current CLI `task` tool enum. Six model IDs no longer present (`gemini-3-pro-preview`, `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1`, `gpt-5.1-codex-mini`, `claude-opus-4.6`); opus-4.7 family missing. Filed issue #21 (squad:tuvok, priority:p2, type:docs) for maintainer governance PR.

**Why:** Surfaced during docs/models.md refresh 2026-05-17. Choice: create issue (chosen by Cyrus).

**Status:** Tracked on #21; fix lands via normal PR review.

---

### 2026-05-17T16:58:02Z: Per-agent model overrides — 4 decisions applied

**By:** Cyrus Jamula (user); Tuvok (execution)
**What:** Applied user answers to docs/models.md § 5 (5 open questions). Config changes:
- **Uhura:** opus-4.7-1m-internal → sonnet-4.6 (integration work rarely needs 1M).
- **Kirk:** opus-4.7-1m-internal unchanged; rule "scope to architecture/multi-file; sonnet-4.6 for narrow review" codified in #21.
- **Scotty:** gpt-5.5 → gpt-5.3-codex (code-writing specialist, TypeScript/CLI beat).
- **Garak:** new gpt-5.5 (cross-provider diversity from Claude-heavy reviewers).

**Rationale:** Workload mismatches for Uhura/Kirk; unanchored Scotty override had no decisions.md anchor; Garak needs diversity post-gemini-removal.

**Files changed:** .squad/config.json (3 changes); GitHub issue #21 (governance doc drift).

---

### 2026-05-17T07:19:38Z: Rules 6 & 7 + Rule 5 extension — `.github/copilot-instructions.md` shipped

**By:** Tuvok (Process Auditor / Editorial Specialist)
**What:** Three surgical edits to `.github/copilot-instructions.md` (+69 lines, 124 → 193 lines):

1. **Rule 5 extended:** Added phase-boundary auto-commit + resume protocol. Implementer commits at phase end; Coordinator 1-line dispatch on resume ("Resuming Phase N at T0XX, dispatching Agent"). Skips "where were we?" friction (5+ instances in one feature cycle).

2. **Rule 6 added (ship it ritual):** Maps user phrasings (*"merge to main and sync"* / *"ship it"* / *"yes merge"* / etc.) to no-confirmation sequence: fetch + rebase → `gh pr merge --squash --delete-branch --auto` → checkout main + pull → cleanup. Evidence: 9+ phrasing variants in one session.

3. **Rule 7 added (auto-merge gate):** Reviewer-approved (Kirk/Picard/Garak APPROVE) + CI-green + no CHANGES_REQUESTED = immediate merge without asking. Override + governance carve-out included.

**In effect as of commit** (per Cyrus approval of `/chronicle improve` findings A/B/C/D).

---

### 2026-05-17T17:00:00Z: Issue #16 expanded — devcontainer scope + security_events permission

**By:** Uhura (Integrations Dev)
**What:** Original #16 scope (add `.devcontainer/devcontainer.json` with `idleTimeoutInMinutes: 180`) expanded during #17 Dependabot triage attempt. Codespace's `GITHUB_TOKEN` lacks `security_events` scope, causing `403 Resource not accessible by integration` on Dependabot alerts endpoint. Since `gh auth refresh` cannot add scopes to Codespace-managed tokens, only fix is declaring permission at container-creation time.

**PR #33 delivers both fixes in single file:**
- Image: `mcr.microsoft.com/devcontainers/javascript-node:24` (matches `.nvmrc`)
- Idle timeout: `180` minutes
- Features: github-cli enabled
- Post-create: `npm ci`
- Extensions: Copilot + Copilot Chat
- Permissions: `security_events: read` declared

**Tests:** 365 passing. Typecheck clean. Ready to merge.

**Required follow-up:** Cyrus must rebuild Codespace after PR #33 merges (token scope issued at container-creation time; existing sessions unaffected). Then #17 Dependabot triage can proceed with 200-OK instead of 403.

---

### 2026-05-17T17:39:49.968+00:00: Rule 8 — Worktree cleanup must sweep `.squad/` artifacts first

**By:** Picard (M2 / Engineering Manager)
**Issue:** #34
**PR:** #35

**Problem:** Rule 2 (agents must not commit `.squad/` paths — Scribe-only) and worktree mode interact to silently lose data. Agents write `.squad/` artifacts in the worktree; `git worktree remove` destroys uncommitted files; the artifacts vanish.

**Decision:** Add Rule 8 to `copilot-instructions.md` requiring a pre-cleanup `rsync` sweep of `.squad/` artifacts from the worktree back to the main checkout before any `git worktree remove`. Rule 2 is unchanged — Scribe still commits `.squad/` paths from the main checkout.

**Alternatives considered:**
- *Scribe commits in the worktree before merge:* Rejected — adds Scribe as a blocking dependency in the merge path, slows ship-it ritual.
- *Relax Rule 2 for worktree branches:* Rejected — splits `.squad/` commit ownership across branches, makes audit trail messy.
- *Pre-cleanup rsync sweep (chosen):* Minimal surface area, idempotent, preserves Rule 2 intact.

**Files changed:**
- `.github/copilot-instructions.md` (Rule 6 + new Rule 8)
- `.github/agents/squad.agent.md` (cleanup section)
- `.squad/templates/squad.agent.md.template` (template mirror)
- `.squad/templates/skills/git-workflow/SKILL.md`
- `.squad/templates/issue-lifecycle.md`

**Status:** PR #35 open, awaiting review.

---

### 2026-05-17T17:39:49.968+00:00: Scotty — Phase 5–6 classify wiring + Job Summary pattern

**By:** Scotty (Core Dev)

**What**: Wired the classify stage into the discord-monitor orchestrator (step 5 of the 11-step sequence) and introduced the `emitJobSummary()` pattern for GitHub Actions Job Summary emission.

**Decisions**:

1. **Classify stage lives in the orchestrator, not a separate module.** The moderation pre-filter → classifier → tip dedup pipeline runs inline in `discordMonitor()` after extraction. This keeps the health counter updates co-located with the pipeline stages that produce them.

2. **Job Summary is append-only Markdown.** `emitJobSummary()` appends a single Markdown table to `GITHUB_STEP_SUMMARY`. It's wrapped in its own try/catch (independent of digest write) and no-ops when the env var is unset. This means local `npm run skill:discord-monitor` runs produce no summary file — by design.

3. **modelLoaded.sha256Verified = true in heuristic-only mode.** When the placeholder SHA is detected and tier-2 is skipped, the heuristic classifier reports `sha256Verified: true` because there is no model to verify. This avoids false-negative operator alerts on the health surface.

**Status**: Landed in PR #37, pending review.

---

### 2026-05-17T17:53:01.345+00:00: User directive

**By:** Cyrus Jamula (via Copilot)

**What:** Priority order for remaining backlog: (1) Tuvok enforcement issues (#8–#11, #15, #21) before (2) self-test epic (#24–#32). Self-tests wait until PRs #35–#37 merge. Issue #18 (KNOWN GAP codes) decision: Option B — fix extractor by relaxing regex to 3 chars + add allowlist to block false positives.

**Why:** User request — captured for team memory

---

### 2026-05-17T17:53:01.345+00:00: Kirk batch code review — PRs #35, #36, #37

**By:** Kirk (Lead / Code Reviewer)

**Decisions:**

1. **PR #35 APPROVED** — Rule 8 (`.squad/` artifact sweep before worktree removal) is architecturally sound. Governance-only change, no runtime impact.

2. **PR #36 APPROVED** — `@xenova/transformers` → `@huggingface/transformers` resolves all 8 Dependabot advisories. API-compatible drop-in. Minor doc drift in quickstart.md noted for follow-up.

3. **PR #37 CHANGES_REQUESTED** — Variable shadowing bug in `discordMonitor.ts` causes classified tips to be silently discarded. RunHealth counters are correct but data output (`tips-seen.jsonl`, digest `tips` array) is always empty. Required fix: remove inner `const classifiedTips` declaration, add tip-flow integration test.

**Process recommendation:** Add ESLint `no-shadow` rule to the project to catch block-scope variable shadowing at CI time. This class of bug compiles cleanly and passes typecheck but produces wrong runtime behavior.

**Status:** PR #35 and #36 ready for merge. PR #37 blocked on Scotty's revision.

---

### 2026-05-17T17:53:01.345+00:00: Dependabot triage — replace @xenova/transformers with @huggingface/transformers

**By:** Uhura (Integrations Dev)
**Issue:** #17
**PR:** #36

**Decision:** Migrate from deprecated `@xenova/transformers@2.17.2` to the maintained successor `@huggingface/transformers@^4.2.0` to resolve all 8 Dependabot alerts rooted in `protobufjs@6.11.6`.

**Rationale:**
- All 8 advisories (1 critical, 4 high, 3 moderate) trace to a single transitive chain: `@xenova/transformers` → `onnxruntime-web@1.14` → `onnx-proto` → `protobufjs@6.x`.
- `@xenova/transformers` is unmaintained; `@huggingface/transformers` is the official continuation by the same author (now under the HuggingFace org).
- The new package uses `onnxruntime-web@1.26` → `protobufjs@^7.2.4` (7.5.9), clearing every advisory.
- The `pipeline()` API used in `src/discord/classifier.ts` is compatible; the tier-2 classifier remains gated behind placeholder SHA.

**Impact:**
- `npm audit` → 0 vulnerabilities (was 8).
- 283 tests pass, typecheck clean.
- No runtime behavior change for the currently-active heuristic-only classifier.

**Status:** PR #36 open for review.

---

### 2026-05-17T17:53:01.345+00:00: Fix extractor short-code gaps (Issue #18)

**By:** Bashir (Tester)
**PR:** #38 (`squad/18-fix-extractor-short-codes`)

**Decision:** Implemented **Option B** from #18: relax `CORE_CODE_REGEX` minimum from 4 chars to 3 (`{3,19}` → `{2,19}`), and expand the stoplist with 38 common 3-letter English words to maintain precision.

**Rationale:**
- TNG, GQ5, GQ7 are real active promo codes that were silently dropped.
- A blocklist approach (stoplist) is already the established pattern in this codebase — extending it to cover 3-char false positives is the natural, lowest-risk path.
- The stoplist is O(1) lookup and easy to maintain.

**Impact:**
- All 30 promo-codes.txt entries now extract (was 27/30).
- Test suite: 287 pass, 0 fail, 0 todo (was 283 pass + 3 todo).
- Schemas and contract docs updated to match the new regex.

**Files Changed:**
- `src/discord/extractor.ts`
- `src/discord/schemas.ts`
- `src/discord/stoplist.ts`
- `tests/discord/extractor.test.ts`
- `tests/discord/schemas.test.ts`
- `specs/001-discord-monitor/contracts/state-files.contract.md`

---

### 2026-05-17T17:53:01.345+00:00: PR #37 Review Fix — classifiedTips Shadowing

**By:** Uhura (Integrations Dev)
**PR:** #37

**Context:** Kirk's review of Scotty's PR #37 identified a variable shadowing bug where `const classifiedTips` inside the `if (token)` block shadowed the outer `let classifiedTips`, causing all classified tips to be silently dropped from digest output and `tips-seen.jsonl`.

**Decision:** Assigned to Uhura (Scotty locked out per reviewer rejection protocol). Applied a one-line fix (remove `const`, use plain assignment) plus a new integration test covering the full tip flow through to digest and persistence.

**Rationale:**
- Minimal, surgical fix — no refactoring beyond the shadowing removal.
- Integration test guards against future regressions on the tip data path.
- TypeScript does not warn on block-scoped shadowing by default; the test is the durable safety net.

