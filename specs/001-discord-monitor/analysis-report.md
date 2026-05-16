# Cross-Artifact Analysis Report — `001-discord-monitor`

**Date:** 2026-05-16
**Analyst:** /speckit.analyze (read-only)
**Scope:** spec.md, plan.md, research.md, data-model.md, contracts/*, quickstart.md,
checklists/requirements.md, `.specify/memory/constitution.md` v1.3.0,
`.specify/memory/reviewer-runbook.md`, `package.json`, `.nvmrc`, `src/` layout.
**Mode:** NON-DESTRUCTIVE. No artifact modified.

---

## Verdict

**BLOCKED — fix the following before /speckit.tasks can be re-run cleanly.**

> Note: a `tasks.md` is already present on disk from a prior `/speckit.tasks`
> run. The two BLOCKERs below land squarely inside provisions that the existing
> task list assumes; both must be reconciled (either in the plan/contracts or in
> the constitution) before the existing task list is allowed to drive
> `/speckit.implement`. The remaining warnings can be fixed in flight.

---

## Top Findings (highest impact, ≤ 10)

| # | Severity | One-line summary |
|---|----------|------------------|
| 1 | 🔴 BLOCKER | `data/discord/suppression.json` writer mismatch: constitution v1.3.0 says **human operator** is the writer (skill may *suggest*); plan/data-model/contracts have the **skill** auto-write 30-day cool-down entries with no operator confirmation. (constitution.md:261–264 vs plan.md:255–258, data-model.md:240–256, state-files.contract.md:127–139) |
| 2 | 🔴 BLOCKER | Constitution v1.3.0 names the digest writer module as **`src/digest/`** (constitution.md:270); plan.md and every contract place the digest writer at **`src/discord/digest.ts`** (plan.md:199, digest-writer.contract.md:8). Both names cannot be correct; one MUST move before tasks/implement. |
| 3 | 🟡 WARNING | Plan § Constitution Impact (plan.md:389–449) and Constitution Check (plan.md:91) still describe the v1.3.0 amendment as *future / proposed*. v1.3.0 is now drafted in `constitution.md` (uncommitted on this branch). Plan is stale relative to the constitution it must conform to. |
| 4 | 🟡 WARNING | FR-003 requires ingestion of "**plain text + message edits within the lookback window**" (spec.md:221–223). The plan's ingestion strategy (research.md:111–116; plan.md:245–247) uses `?after=<lastMessageId>` only — it never re-fetches prior pages, so message edits are **never re-scanned**. Real coverage gap. |
| 5 | 🟡 WARNING | Quickstart Step 1.2 (quickstart.md:18–20) requires enabling Discord's privileged **Message Content Intent**. Neither spec FR-002 (spec.md:220) nor the discord-bot contract (discord-bot.contract.md:6–18) lists this prerequisite. Operator will hit a silent "empty `content`" failure if intent is not toggled. |
| 6 | 🟡 WARNING | `.squad/decisions.md:1459` and similar log entries treat the v1.3.0 amendment as approved/imminent and have language describing implementation as "unblocked"; the user has confirmed nothing is merged. The real git state is the source of truth (constitution.md modified, no PR landed). Note for awareness; do NOT edit `.squad/`. |
| 7 | 🟡 WARNING | Plan's "Acknowledged assumptions" #5 (plan.md:493–494) flags that `onnxruntime-node` could `process.exit` on a native segfault, killing the run. There is no contract item or task to mitigate (e.g., a parent-process write-state-on-signal trap, or running classifier in a child process). Real risk hot-spot. |
| 8 | 🟡 WARNING | FR-018 says near-duplicate tips MAY be collapsed via similarity threshold (spec.md:269–272). Plan defers near-duplicate (plan.md:506) and uses **exact-hash only** in `tips-seen.jsonl` (state-files.contract.md:106–117). Permitted by the MAY, but spec/data-model don't surface that v1 ships exact-hash only — 🟡 because tasks.md will silently bake in exact-only forever if not flagged. |
| 9 | ℹ️ INFO | Spec's "Constitution Alignment Notes" section (spec.md:435) cites **constitution v1.2.0** verbatim. Expected (spec was written before v1.3.0) but reviewer should not be confused. |
| 10 | ℹ️ INFO | The Speckit Reviewer Gates section of the constitution (constitution.md:514–544) only enumerates Bashir + Picard. Plan adds Borg Queen (critic) and Tuvok (process audit) for this feature (plan.md:455–461). These are squad-process roles, not constitutional gates — fine, but reviewers should know the broader review board is feature-specific, not constitutional. |

---

## A. Internal consistency: spec ↔ plan ↔ constitution v1.3.0

### A.1 Suppression-file writer mismatch — 🔴 BLOCKER

- Constitution v1.3.0 (`.specify/memory/constitution.md:261–264`):
  > `data/discord/suppression.json` — operator-curated suppression rules for
  > noisy patterns. **Writer: human operator (manual edit, reviewed PR);** the
  > skill MAY append machine-suggested entries that an operator MUST confirm
  > before they take effect.
- Plan sequence step 6 (`plan.md:255–258`):
  > Update `suppression.json` for any new failures.
- Data-model (`data-model.md:240–256`) and state-files contract
  (`state-files.contract.md:127–139`) describe `firstFailedAt → suppressedUntil
  = firstFailedAt + 30d` as a fully-automated transition with **no operator
  confirmation step**.
- Constitution wins (Principle VI). Either:
  - **(a)** amend the v1.3.0 text to allow the skill to *also* be the writer
    of failure-derived suppression entries (and keep the human as writer of
    pattern-rules), or
  - **(b)** change plan/data-model/contracts to write skill suggestions to
    a separate "pending suppression" surface that requires operator
    confirmation before taking effect.
- Until reconciled, the plan **violates** Principle V's writer-enumeration
  rule. This is exactly the class of issue Speckit Reviewer Gates exists to
  catch.

### A.2 Digest module path mismatch — 🔴 BLOCKER

- Constitution `.specify/memory/constitution.md:268–270`:
  > The `discord-monitor` skill additionally produces the committed artifact
  > tree `data/digests/YYYY-MM-DD.md`. Writer: the skill itself
  > (**`src/digest/`**), executed inside
  > `.github/workflows/discord-monitor.yml`.
- Plan `plan.md:199`: `digest.ts` lives at `src/discord/digest.ts`.
- Digest-writer contract (`digest-writer.contract.md:8`):
  `// src/discord/digest.ts (target location)`.
- The strings diverge by one path segment. Constitution names a module
  (`src/digest/`); plan locates the file under `src/discord/`. Implementation
  MUST pick one, and per Principle VI the constitution wins unless amended.
- Recommendation: either move the digest writer to its own `src/digest/`
  module (sibling to `src/discord/`, matching constitution v1.3.0 wording) or
  patch the constitution string to `src/discord/digest.ts` in the same
  amendment that lands v1.3.0.

### A.3 Constitution v1.3.0 already drafted; plan still treats it as future — 🟡 WARNING

- Plan § Constitution Impact (`plan.md:389–444`) and the Constitution Check
  table row V (`plan.md:91`) read as if v1.2.0 is the active constitution and
  v1.3.0 is a recommendation. v1.3.0 is in fact already drafted in
  `.specify/memory/constitution.md` (uncommitted edit on this branch).
- This will not block tasks/implement, but it makes the plan misleading. A
  one-paragraph note ("v1.3.0 amendment text is in this same branch and
  lands as Phase 0 of `tasks.md`") would resolve the drift.

### A.4 Spec ↔ plan FR coverage — 🟢 OK (one gap, see A.5)

| FR | Plan / contract / data-model coverage |
|----|----------------------------------------|
| FR-001 | `config/discord-allowlist.json`; empty handled (plan.md:241; state-files.contract.md:34–42; quickstart §3) — 🟢 |
| FR-002 | discord-bot.contract.md:6–18; secrets table (plan.md:340–350) — 🟢 |
| FR-003 | plan.md ingestion uses `?after=<id>` only — see A.5 — 🟡 |
| FR-004 | concurrency.group + cursors + idempotent digest (plan.md:289, 264, digest-writer.contract.md:36–55) — 🟢 |
| FR-005 | discord-bot.contract.md:67, rate-limit budget — 🟢 |
| FR-006 | research.md:147–188 (3-stage regex with stop-list + context bonus) — 🟢 |
| FR-007 | research.md:150–155 normalize step — 🟢 |
| FR-008 | dedup against `promo-codes.txt` + `candidates.jsonl` + `suppression.json` (plan.md:254–256) — 🟢 |
| FR-009 | 30-day cool-down (plan.md:71, 365–371; data-model.md:255; state-files.contract.md:131) — 🟢 (writer issue is A.1, not coverage) |
| FR-010 | redeemer-integration.contract.md (whole) — 🟢 |
| FR-011 | redeemer-integration.contract.md:97–98; reuses `src/lib/outcomes.ts` — 🟢 |
| FR-012 | discord-bot.contract.md:64; redeemer-integration.contract.md:108 — 🟢 |
| FR-013 | data-model.md:73–79 `perAccountOutcome` array — 🟢 |
| FR-014 | per-run cap 10 (plan.md:354–361; research.md:196–224) — 🟢 |
| FR-015 | classifier.contract.md:10–13 (full label set) — 🟢 |
| FR-016 | research.md:51–105 (local DeBERTa-xsmall) — 🟢 |
| FR-017 | classifier.contract.md:70–75 (no-network invariant + test) — 🟢 |
| FR-018 | exact-hash only in v1; near-duplicate deferred (plan.md:506; state-files.contract.md:106–121) — see #8 — 🟡 |
| FR-019 | data-model.md:133 `excerpt: verbatim, max 600 chars + …` — 🟢 |
| FR-020 | classifier.contract.md:77–89 moderation pre-filter — 🟢 |
| FR-021 | digest-writer.contract.md (whole) — 🟢 |
| FR-022 | path + idempotent re-render (digest-writer.contract.md:29–55) — 🟢 |
| FR-023 | "retained indefinitely; no automated deletion" (plan.md:354 implicit; spec verbatim) — 🟢 |
| FR-024 | digest-writer.contract.md:56–98 (markdown shape) — 🟢 |
| FR-025 | digest-writer.contract.md:114–123 (forbidden contents); state-files.contract.md:170 — 🟢 |
| FR-026 | plan.md:281–318 workflow yaml is non-interactive — 🟢 |
| FR-027 | data-model.md:259–284 RunHealth + plan.md sequence step 10 — 🟢 |
| FR-028 | plan.md:340–350 secrets table; constitution.md v1.3.0 § V enumerates `DISCORD_BOT_TOKEN` — 🟢 |
| FR-029 | discord-bot.contract.md:64 (`redactForLog` on auth fail); classifier.contract.md:98 — 🟢 |
| FR-030 | discord-bot.contract.md:55–69 typed errors + zod — 🟢 |

### A.5 FR-003 message-edit gap — 🟡 WARNING

- Spec FR-003 (`spec.md:221–223`) commits to scanning *plain text + message
  edits within the lookback window*.
- Research R3 (`research.md:111–116`) and plan sequence step 3
  (`plan.md:245–247`) describe a strict forward-only `?after=<lastMessageId>`
  pagination. Edits to messages already past the cursor will never be
  re-fetched.
- `IngestedMessage.editedTimestamp` field exists (data-model.md:30) but is
  never consumed by the ingest loop documented anywhere in the plan.
- Either spec FR-003 must be narrowed (drop "edits"), or plan must add a
  bounded re-scan of the last *N* messages or the last *T* hours per channel.
  Suggest: small re-scan window (last 24h or last 1 page) per channel,
  documented as a separate metric in `RunHealth`.

### A.6 Constitution durable-input enumeration ↔ plan paths — 🟢 OK (one nit)

- The 6 durable inputs the constitution v1.3.0 enumerates
  (constitution.md:32–39) are byte-identical to plan.md and state-files
  contract:
  `config/discord-allowlist.json`, `config/classifier-model.json`,
  `data/discord/cursors.json`, `data/discord/candidates.jsonl`,
  `data/discord/tips-seen.jsonl`, `data/discord/suppression.json`,
  plus the `data/digests/**` artifact tree. ✅
- Nit: `tasks.md` Phase 0 acceptance bullet [P0-1] (line 60) calls these
  *"7 new durable inputs"* — counting the digest tree as the 7th. The
  constitution Sync Impact Report counts it as **6 + the digest tree**
  (constitution.md:31–39). Same files, different counting convention.
  Cosmetic but worth normalizing.

### A.7 Six clarifications (Q1–Q5 + Q-deferred) — 🟢 OK

| Clarification | Plan honors verbatim? | Citation |
|---|---|---|
| Q1 dedicated Discord bot, READ_MESSAGE_HISTORY + VIEW_CHANNEL only | ✅ | discord-bot.contract.md:12–18 |
| Q2 local small model, no message text leaves runner | ✅ | research.md:69; classifier.contract.md:70–75 |
| Q3 empty allow-list at launch, operator-configurable, no hard-coded IDs | ✅ | state-files.contract.md:34–42; quickstart §3 |
| Q4 auto-commit to `main`, no PR gate, capped per run | ✅ (cap = 10) | plan.md:354–361 |
| Q5 `data/digests/YYYY-MM-DD.md`, retained indefinitely | ✅ | digest-writer.contract.md:29 |
| Q-deferred 30-day cool-down default | ✅ | plan.md:71, 365–371 |

No drift. ✅

---

## B. Quality of the plan

### B.1 Template completeness — 🟢 OK
Every plan section is filled with concrete prose; no `[…]` placeholders. (Manually
scanned plan.md, all 5 contracts, data-model.md, research.md, quickstart.md.)

### B.2 Concrete decisions — 🟢 OK with one INFO
- Library versions pinned to caret ranges: `@discordjs/rest ^2.5.0`,
  `discord-api-types ^0.38.x`, `@xenova/transformers ^2.17.x` (plan.md:31–37).
  These are real versions on npm as of plan date.
- Model pinned: `Xenova/nli-deberta-v3-xsmall` with revision SHA + weight
  SHA-256 in `config/classifier-model.json` (research.md:80–87).
- Numeric caps explicit: per-run auto-commit = 10; cool-down = 30d;
  per-channel page cap = 5 × 100; classifier confidence floor = 0.55;
  extraction confidence floor = 0.6; excerpt cap = 600 chars.
- ℹ️ INFO: caret ranges (`^2.5.0` etc.) will float on `npm ci`; for
  reproducibility a lockfile is the safety net. Plan does not explicitly
  say "commit `package-lock.json` updates" — already the repo convention,
  so fine.

### B.3 Contracts implementer-readiness — 🟢 OK
All five contracts give:
- Function signatures (TypeScript) with input/output types.
- Failure-mode tables.
- Storage paths and serialization rules.
- Test seams (e.g., classifier privacy invariant testable by stubbing
  `globalThis.fetch`).

An implementer working from the contracts alone could write each module's
skeleton without further questions.

### B.4 Data-model coherence — 🟢 OK
- Eight entities (`IngestedMessage`, `CandidateCode`, `RedemptionResult`,
  `Tip`, `DailyDigest`, `IngestionCursor`, `AllowlistEntry`,
  `SuppressionEntry`) plus `RunHealth`.
- `RedemptionResult` is correctly noted as a flow-through, not a persisted
  entity — folded into `CandidateCode.perAccountOutcome[]`. No orphans.
- Storage location and serialization defined for every persisted entity
  (data-model.md "Storage:" line on each).
- Cross-entity invariants enumerated (data-model.md:291–301; state-files
  contract:161–172). They are auditable by `git grep`.

---

## C. Constitution compliance (v1.3.0)

### C.1 Principle I (Safety) — 🟢 OK
- No new auto-action against the player's STFC account. Only redemption,
  routed through the existing `redeem-codes` skill.
- Auto-commit operates on a repo file, not the game account.
- `DISCORD_BOT_TOKEN` redaction enforced via `src/lib/redact.ts` on every
  Discord error path (FR-029, discord-bot.contract.md:64).

### C.2 Principle II (Headless / CI-first) — 🟢 OK
- New skill `discord-monitor` returns `{ result, exitCode }`; does not call
  `process.exit` (redeemer-integration.contract.md:114).
- Workflow has zero interactive steps (plan.md:281–318 yaml). Operator-only
  steps are documented separately in quickstart.md and clearly marked as
  one-time provisioning (Step 1).

### C.3 Principle V + Token Capture Custody — 🟢 OK with one BLOCKER (A.1)
- ✅ No new sanctioned writer of `STFC_ACCOUNTS`. Plan secrets table
  explicitly forbids merging `DISCORD_BOT_TOKEN` into `STFC_ACCOUNTS`
  (plan.md:348–350; constitution.md:360–365).
- ✅ `DISCORD_BOT_TOKEN` is env-only; `MUST NOT be written to disk by
  feature code` is asserted (constitution.md:292–294; discord-bot.contract.md:9).
- 🔴 **A.1 mismatch:** plan auto-writes `suppression.json`; constitution
  reserves it as a human-written file. Must reconcile.
- ✅ Six durable inputs + `data/digests/**` are the only files written by
  the skill. No other file paths surface in plan or contracts.

### C.4 Security & Compliance — outbound network — 🟢 OK
- Only `discord.com/api/v10` and `huggingface.co` (model fetch on cache
  miss) are introduced. Both are in the constitution v1.3.0 enumeration
  (constitution.md:566–579).
- No plan section implies a call to any other domain. Quickstart §1
  references `discord.com/developers/applications` but that's an operator
  browser action, not workflow code — out of constitutional scope.

### C.5 Speckit Reviewer Gates — 🟢 OK
- Plan § Reviewer Gate plan (plan.md:451–462) names Bashir (Tester),
  Picard (Lead), Borg Queen (critic), Tuvok (process auditor). Constitution
  Speckit Reviewer Gates section enumerates only Bashir + Picard
  (constitution.md:514–544). The two extra agents are squad-process roles
  layered on top — consistent with `.squad/` convention; not a violation
  but worth noting (#10 in Top Findings).

---

## D. Risk hot-spots for /speckit.implement (top 5)

1. **Suppression.json writer reconciliation (BLOCKER A.1).** Implementer
   cannot start writing failure→suppression code paths until the constitution
   text or the plan is patched to agree on who writes the file.
2. **Classifier cold-start cost on cache miss vs `timeout-minutes: 10`**
   (plan.md:295; research.md:89; plan.md:486–488). Plan estimates 25 s
   download + 1.8 s warm load; if HuggingFace is slow or the heuristic
   pre-filter passes more traffic than estimated, the workflow times out and
   leaves state half-written. Mitigation idea: persist cursor advancement
   *before* classifier runs (so the "ingest" half is durable even if
   "classify" half times out).
3. **Auto-commit cap × branch protection** (plan.md:472; quickstart §6 row
   "Auto-commit failed on `main`"). If branch protection on `main` blocks
   `GITHUB_TOKEN` pushes, every monitor run silently fails its commit step
   and successful redemptions never make it into `promo-codes.txt`.
   Recommendation: add a `git push` retry that fails the workflow loud (not
   just `|| true`) so the regression is visible in the digest.
4. **Idempotent digest re-render across overlapping 4-hour runs.** The
   digest-writer contract (digest-writer.contract.md:36–55) round-trips
   through an embedded JSON state block. If two near-simultaneous runs both
   read the file, race on the state block, and push, the shared
   `concurrency.group: stfc-gift-redeemer` is the only thing serializing
   them. Plan acknowledged-assumption #2 (plan.md:484–486) flags this — it
   is real and worth a regression test.
5. **Stale `.squad/` orchestration claims** (Top Finding #6). Operators
   reading `.squad/decisions.md` and the orchestration log may believe the
   v1.3.0 amendment has merged when it has not. This is a process-hygiene
   risk, not a code risk, but it could lead to /speckit.implement being
   started against an unamended constitution. Verify git state before
   starting Phase 1+ of `tasks.md`.

---

## E. Out-of-scope creep / silently-dropped requirements

### Creep (plan/contracts beyond what spec demands)
- 🟢 None of substance. The plan is conservative and frequently *narrower*
  than the spec (e.g., near-duplicate tip dedup deferred — see below).

### Silently dropped (spec ≥ plan)
- 🟡 **FR-003 message edits** — see A.5.
- 🟡 **FR-018 near-duplicate tip dedup** — spec uses *MAY*, plan defers
  to v1.1 (plan.md:506). Permitted by the MAY but should be surfaced in
  the digest header so the operator understands the v1 limit.
- ℹ️ **SC-003 operator-survey signal** — not actionable in code; will
  require a manual monthly check-in. No plan task — fine, but worth
  noting that no automation backstops the survey.

---

## F. Tasks readiness (against the user's checklist)

| Item | Status | Notes |
|------|--------|-------|
| Concrete file paths to be created | ✅ | plan.md:166–229 enumerates every NEW/MODIFIED path. |
| Concrete dependencies + versions | ✅ | plan.md:31–37 (`@discordjs/rest ^2.5.0`, `discord-api-types ^0.38.x`, `@xenova/transformers ^2.17.x`). `package.json` does not yet list them — install task will go in /tasks. |
| Contracts map 1:1 to test files | ✅ | classifier.contract.md ↔ tests/discord/classifier.test.ts (plan.md:206); discord-bot.contract.md ↔ tests/discord/ingest.test.ts (plan.md:209); digest-writer.contract.md ↔ tests/discord/digest.test.ts (plan.md:208); state-files.contract.md ↔ schemas in tests/discord/* (implicit, plan.md:201); redeemer-integration.contract.md ↔ tests/skills/discordMonitor.test.ts (plan.md:210–213). |
| Clear sequencing | ✅ | plan.md:237–273 enumerates a 11-step run pipeline (boot → token check → ingest → extract → classify → dedup+redeem → auto-commit → state write → digest → job summary → exit). |
| Reviewer gates identified | ✅ | plan.md:451–462. |
| `.nvmrc` / Node version | ✅ | repo `.nvmrc` = `24`; `package.json` engines `>=24`; plan `Node ≥ 24` (plan.md:27). All three agree. |
| `src/` layout collisions | ✅ | repo `src/` has `api`, `cli.ts`, `lib`, `skills`. Plan adds `src/discord/`; **but constitution names `src/digest/` for the digest writer** — see BLOCKER A.2. Aside from that mismatch, no name collision. |

**Net:** the artifacts are *almost* tasks-ready. Two BLOCKERs (A.1 + A.2)
must be reconciled first, and the existing `tasks.md` should be re-checked
against any reconciliation outcome.

---

## Cross-reference matrix (FR → plan section / contract / data-model entity)

| FR | plan.md anchor | contract | data-model entity |
|----|----------------|----------|-------------------|
| FR-001 | § Sequence step 1 (l.241) | state-files § allowlist | `AllowlistEntry` |
| FR-002 | § Secrets table (l.340) | discord-bot § Auth | — |
| FR-003 | § Sequence step 3 (l.245) ⚠ A.5 | discord-bot § Endpoints | `IngestedMessage` |
| FR-004 | § GH workflow concurrency (l.289); § Sequence step 9 (l.265) | digest-writer § Idempotency | `DailyDigest`, `IngestionCursor` |
| FR-005 | discord-bot § Error handling | discord-bot | — |
| FR-006 | research § R4 | — | `CandidateCode.extractionConfidence` |
| FR-007 | research § R4 step 1 | — | `IngestedMessage.contentNormalized` |
| FR-008 | § Sequence step 6 (l.254) | state-files § candidates | `CandidateCode.status: duplicate / already-known` |
| FR-009 | § Cool-down window (l.363) | state-files § suppression ⚠ A.1 | `SuppressionEntry` |
| FR-010 | § Architecture overview (l.129) | redeemer-integration | — |
| FR-011 | redeemer-integration | redeemer-integration | `RedemptionResult.outcome` |
| FR-012 | discord-bot 401 row | discord-bot; redeemer-integration | — |
| FR-013 | data-model entity 2 | state-files § candidates | `CandidateCode.perAccountOutcome[]` |
| FR-014 | § Per-run cap (l.352) | redeemer-integration § What seam DOES NOT do | — |
| FR-015 | classifier | classifier | `Tip.category` |
| FR-016 | research § R2 | classifier § Privacy invariant | — |
| FR-017 | research § R2; classifier § Privacy invariant | classifier | — |
| FR-018 | state-files § tips-seen | state-files § tips-seen | `Tip.contentHash` |
| FR-019 | data-model entity 4 | digest-writer § File format | `Tip.excerpt` |
| FR-020 | classifier § Moderation pre-filter | classifier | — |
| FR-021 | digest-writer | digest-writer | `DailyDigest` |
| FR-022 | digest-writer § Output file path | digest-writer | `DailyDigest.date` |
| FR-023 | digest-writer (retain indefinitely) | digest-writer | — |
| FR-024 | digest-writer § File format | digest-writer | `DailyDigest` |
| FR-025 | digest-writer § Forbidden contents | digest-writer; state-files § Cross-file | — |
| FR-026 | plan § GH workflow (l.281) | — | — |
| FR-027 | data-model entity 9 | digest-writer § File format § Ingestion health | `RunHealth` |
| FR-028 | plan § Secrets (l.340) | discord-bot § Auth | — |
| FR-029 | discord-bot 401 row; classifier failure modes | discord-bot; classifier | — |
| FR-030 | discord-bot § Error handling | discord-bot | — |

Every FR has at least one anchor. ⚠ = open item from this report.

---

## Severity counts

- 🔴 BLOCKER: **2** (A.1 suppression writer; A.2 digest module path)
- 🟡 WARNING: **6** (A.3 stale plan amendment language, A.5 FR-003 edits gap, Top #5 message-content-intent, Top #6 .squad inaccuracy, Top #7 onnxruntime exit risk, Top #8 near-duplicate tips silently exact-only)
- 🟢 OK: **majority of cross-checks** (24 of 30 FR rows trivially OK; both BLOCKERs are scoped to one file each)
- ℹ️ INFO: **3** (A.6 6-vs-7 counting; B.2 caret ranges; #9 spec cites v1.2.0; #10 reviewer gates squad roles)

---

## Suggested next actions

1. **Resolve BLOCKER A.1.** Pick (a) amend constitution v1.3.0 to allow the
   skill to write failure-derived suppression entries, OR (b) split
   `suppression.json` into operator-pattern-rules (human-written) + a
   separate `suppression-pending.json` (skill-written, requires operator
   `enabled: true` flip to take effect). I recommend (a) for v1 to ship
   faster; (b) is the higher-trust long-term shape.
2. **Resolve BLOCKER A.2.** Either move the digest writer to `src/digest/`
   in the plan + contracts + tasks.md, OR patch the constitution v1.3.0
   draft (still uncommitted) to say `src/discord/digest.ts`. The latter is
   smaller; either is acceptable.
3. **Address WARNING A.5 (FR-003 message edits).** Decide: drop the spec
   line, OR add a bounded re-scan window to the ingestion strategy and
   surface the choice in plan + research + tests.
4. **Add a quickstart/contract note about the privileged Message Content
   Intent** (Top Finding #5). Currently only quickstart mentions it; the
   contract should too.
5. **Update plan § Constitution Impact** (Top Finding #3) to reflect that
   v1.3.0 is now drafted in the same branch (it currently reads as a
   forward-looking recommendation).
6. **Re-run /speckit.tasks** after the two BLOCKERs are resolved to
   regenerate `tasks.md` against the reconciled artifacts. The current
   `tasks.md` was produced from the pre-reconciliation versions; its
   Phase 0 checklist is largely correct but has not seen A.1 / A.2.

Once items 1 and 2 are resolved, the verdict moves to **READY with
WARNINGS**, and items 3–5 can be addressed in flight during /implement
without blocking task generation.

---

*End of analysis report. No artifacts modified.*

---

## Resolution Note (2026-05-16)

**Resolved by:** Picard (Lead) via /speckit.implement preflight
**Requested by:** cyrusj

### BLOCKER #1 — `data/discord/suppression.json` writer mismatch

**Resolution:** Option A (Constitution-led fix) — split into two files:
- `data/discord/suppression.json` — operator-curated allow/deny rules. Writer: human operator (manual edit, reviewed PR).
- `data/discord/cooldowns.json` — auto-written cool-down telemetry (FR-009). Writer: feature code at `src/discord/`.

**Rationale:** Preserves Principle V's bright-line separation between policy (operator) and telemetry (skill). The cost (one additional constitution enumeration entry) is minimal and stays within the v1.3.0 amendment scope.

**Files updated:** constitution.md (SYNC IMPACT REPORT + durable-inputs enumeration), plan.md (layout, sequence, test strategy, Constitution Impact), data-model.md (split entity), contracts/state-files.contract.md (schemas), research.md (R6 table).

### BLOCKER #2 — Digest module path mismatch

**Resolution:** Option A (Plan-led fix) — move digest writer from `src/discord/digest.ts` to `src/digest/index.ts`.

**Rationale:** Matches constitution wording exactly; cleaner module boundary (digest is conceptually downstream of Discord, not part of it — it summarizes redemption activity too).

**Files updated:** plan.md (layout, architecture diagram, test strategy), contracts/digest-writer.contract.md (file path).

### Verdict Update

**BLOCKED → READY** for /speckit.tasks regeneration.

The existing `tasks.md` was generated against artifacts containing the two inconsistencies and MUST be regenerated before /speckit.implement runs.
