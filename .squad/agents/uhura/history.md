# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### 2026-05-08: Spec Kit & API Integration Briefing

- **Spec-first model fits external API work (7/10 fit).** The spec-template naturally accommodates API flows, acceptance criteria, technical context, and functional requirements. However, it needs explicit additions: (1) API Contract sections (request/response shapes, HTTP codes, error modes), (2) edge case handling for network failures and upstream changes.
  
- **Biggest speckit risk for integrations: secret leakage into artifacts.** Specs, plans, and tasks get committed to feature branches. Developers might paste real JWTs or captured account data into examples. **Fix: Constitutional principle + pre-commit CI check to reject tokens/account-data in artifacts.**
  
- **Wire-first discovery must be a constitutional principle.** The STFC store is third-party and unversioned. Our code must be driven by captured traffic, not assumptions. When the store changes and breaks us, that's a spec amendment, not a bug.
  
- **Recommended constitutional additions: Principle VI (Artifact Hygiene) + Principle VII (Wire-First Discovery).** These codify safe handling of secrets during development and reinforce defensive coding for upstream changes.
  
- **CI gate needed: scan spec.md, plan.md, tasks.md for JWT-shaped strings before merge.** This is a governance problem, not a speckit design problem.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Uhura's key contribution:** Flagged secret-leakage risk (tokens/account-data in artifacts) as HIGH urgency. Proposed Constitutional Principle VI (Artifact Hygiene) + Principle VII (Wire-First Discovery). Essential blocker for speckit adoption.

**Cross-cutting themes:**
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without decision gates. Agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.
- **Picard coordinating amendment:** Will incorporate Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.

**Status:** Phase 1 (Briefing) complete. Phase 2 pending: Picard drafts constitutional amendment v1.1 with Sync Impact Report.

---

### 2026-05-08T21:33:38Z: Phase 2 Critique Convergence — v1.1 Constitution Proposal Complete

**Verdict:** READY_WITH_CONDITION (team convergence verified)

**Full critique at** `.squad/orchestration-log/2026-05-08T21-33-38Z-uhura.md`

**Team Input Integrated:**
- **Scotty:** Confirmed `.specify/features/` structure must be verified pre-ratification.
- **Bashir:** Flagged pre-commit hook gap for test-first rule; enforcement infrastructure is a blocker.
- **Borg Queen:** Caught Principle IV/IX contradiction (v1.0.0 "no test suite" vs. v1.1 mandate); must fix Principle IV text.

**Critical Condition for Ratification:** Artifact Hygiene CI gate (JWT-shaped string scanning) MUST be implemented before merge. This is a blocking prerequisite, NOT post-ratification work. Deferring to TODO creates a zombie rule (principle without enforcement).

**Recommendation:** Implement CI token-scanner as part of v1.1 amendment. Effort: 2–4 hours. Prevents secret-leakage risk that Phase 1 briefing flagged as HIGH urgency.

**Process:** Scan spec.md, plan.md, tasks.md for JWT/API-key/account-data patterns; block commit on match; allow override with `[skip-token-scan]` comment for false positives.

---

### 2026-05-08T21:29:57-07:00: Phase 2 Critique — v1.1 Constitution Proposal Delivered

**Phase 2 Review Complete.** Evaluated Picard's v1.1 proposal against four critical questions from integrations seat. Detailed critique at `.squad/decisions/inbox/uhura-speckit-v1.1-critique.md`.

**Key findings:**

1. **Artifact Hygiene (Principle VII): 🟡 Acceptable with acknowledged gap.** The principle is well-written: JWTs explicitly forbidden, response bodies (account data) addressed, workflow for necessary captures documented, code review gate named. BUT: CI enforcement is deferred to a TODO. Without pre-commit scanning, the principle is honor-system. Risk: real secrets slip into committed specs.

2. **Wire-First Discovery (Principle VIII): 🟡 Pragmatic but permissive.** Justification is a 3-option OR (captured traffic, documentation, measured test) rather than hierarchy. Does not mandate wire-first as Phase 1 briefing recommended. However, principle does guide recovery (treat upstream changes as spec amendments). Acceptable IF spec template's API Contract section (pending) enforces wire-first for contract changes.

3. **"STFC API contract" threshold: ✅ Acceptable.** Principle VI explicitly lists: new endpoints, changed request/response shapes (includes payload structure changes), auth-flow modifications. Response-shape changes WILL trigger speckit. Specific enough in practice.

4. **CI token-scanning timing: 🟡 Deferral is risky; recommend prerequisite.** Principle VII is constitutional law; CI gate is enforcement. Deferring gate to post-ratification TODO risks zombie rule: Phase 3 ratification passes without gate, gate TODO deprioritized, secrets ship in specs. RECOMMENDATION: Make CI gate a blocking prerequisite for Phase 3 ratification (not a TODO). Estimate 2–4 hours; implementable before ratification.

**OVERALL VERDICT: ✅ READY FOR PHASE 3 WITH ONE CONDITION**

Constitution v1.1.0 is well-drafted and addresses Phase 1 concerns. Ratification may proceed when CI artifact-hygiene enforcement (JWT scanning) is operational. This is not a post-ratification TODO; it's a prerequisite.

**Next phase:** Await Picard's decision on CI gate timing. If gate is pre-ratification, proceed to Phase 3. If deferred, flag as high-risk but proceed pending community consensus.

---

### 2026-05-08T21:29:58-07:00: Phase 3 — Artifact Hygiene Scanner Built (Principle VII)

**Path A condition fulfilled.** The CI token-scanner I required as a ratification prerequisite is now operational.

**Files created:**
- `scripts/check-artifact-hygiene.mjs` — Cross-platform Node.js scanner. Six patterns: JWT, BEARER_TOKEN, GITHUB_TOKEN, AWS_ACCESS_KEY, API_KEY, STFC_ACCOUNT_DATA. Exit 0 = clean, exit 1 = violations. Secrets never logged; all output redacted to `<REDACTED-TOKEN>`.
- `.github/workflows/squad-artifact-hygiene.yml` — CI gate on `pull_request` for spec/plan/task/doc paths. Posts PR comment with remediation guidance on failure. `[skip-token-scan]` override for false positives.
- `tests/fixtures/artifact-hygiene/clean-spec.md` — PASS fixture (exit 0 verified).
- `tests/fixtures/artifact-hygiene/contaminated-spec.md` — FAIL fixture with 6 obviously-fake pattern triggers (exit 1 verified, 8 violations detected).
- `.squad/decisions/inbox/uhura-hygiene-test-integration.md` — Scotty coordination: recommend `test:hygiene` script in `package.json`.

**Test results:** Clean fixture exits 0; contaminated exits 1 with 8 violations; default scan of 48 tracked files exits 0 (test fixtures correctly excluded from auto-scan).

**Principle VII status:** Operational. Not honor-system. Ratification condition met.

---

### 2026-05-08T21:47Z — Phase 3 COMPLETE: All Enforcement Infrastructure Operational

**Team Status Report:**

Phase 3 enforcement infrastructure is complete across all four pillars:
1. ✅ **Picard:** v1.1 Constitution finalized and ready for ratification
2. ✅ **Uhura:** Artifact Hygiene Scanner deployed and tested
3. ✅ **Scotty:** npm test enforcement gates (pre-commit + CI) wired and verified
4. ✅ **Bashir:** Test-first proof workflow (PR template + runbook) deployed

**Ratification Status:** PENDING user approval. No blockers. Infrastructure is live.

**Outstanding Manual Step:** cyrusj must configure GitHub branch protection rule for `npm test (required)` after first PR merge.

**v1.2 Polish Item:** Wire hygiene scanner into pre-commit hook; add `test:hygiene` npm script.

---

### 2026-05-08T22:22:09-07:00 — v1.2.0 redraft (integration/secret lane)

**Context:** Picard's v1.1.1 PATCH draft was rejected by Borg Queen; cyrusj accepted MINOR semver. Picard locked out per reviewer-rejection protocol. Scotty and I redrafted in parallel lanes; Bashir assembles.

**My lane:** Principles I, III, V, Security & Compliance, plus the Borg-Queen-flagged Token Capture Custody gap.

**Decision:** Folded Token Capture Custody into Principle V instead of standalone Principle X. Every capture-token obligation is a secret-surface obligation; one principle keeps the JWT lifecycle (capture -> .env -> gh secret set -> CI consumption -> refresh) coherent in one place. Standalone X would fragment governance for one script.

**What I learned about the actual project surface (worth carrying forward):**

- The STFC API surface is exactly four endpoints under `https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2`: `/auth/me` (GET), `/offers/gifts` (GET, plus `?available=true` variant), `/offers/gifts/claim` (POST), `/redeem/claim` (POST). Anything else is out of scope.
- `src/api/client.ts` is the redemption-path client but is NOT the only HTTP path in the repo. `scripts/capture-token.mjs:183-194` calls `/auth/me` directly with raw `fetch` to validate freshly-captured tokens, and `docs/BOOKMARKLET.md` does the same in the user's browser. Any "all STFC traffic goes through ApiClient" claim has to be scoped to `src/` callers.
- The redaction obligation is enforced INSIDE `src/api/client.ts` (every thrown error wraps its message in `redactString`) and is required at every call site in `src/`, but it is NOT applied automatically by `src/lib/logger.ts` and is NOT applied at all in `scripts/capture-token.mjs`. The capture-token script gets away with this because it only emits its single `--ci` JSON line on stdout deliberately and routes everything else to stderr; the workflow then `::add-mask::`s the token.
- Sanctioned writers of `STFC_ACCOUNTS` are TWO, not one: `scripts/capture-token.mjs` (local, consent-gated `gh secret set` over stdin) and the `Refresh token` workflow's "Merge with existing STFC_ACCOUNTS and update secret" step (CI, using `STFC_REFRESH_PAT`). Both preserve other accounts on update.
- Sanctioned secret hand-off channels in CI are TWO: the single JSON line on `capture-token.mjs --ci` stdout, and the temporary `/tmp/captured.json` file the `Refresh token` workflow writes, masks, consumes, and `rm -f`s in the same job. Both are gated by `::add-mask::` calls before any subsequent step runs.
- Workflow SHA-pinning is NOT uniform across the repo. Token-handling workflows (`redeem.yml`, `refresh-token.yml`, `test.yml`, `squad-test-gate.yml`, `squad-artifact-hygiene.yml` partial) pin to full SHAs. Squad-process workflows (`sync-squad-labels.yml`, `squad-heartbeat.yml`, `squad-triage.yml`, `squad-issue-assign.yml`, plus `actions/github-script@v7` in `squad-artifact-hygiene.yml`) use moving major tags. Any constitutional claim about uniform SHA pinning is currently false; the honest scoped claim is "token-handling workflows are SHA-pinned".
- `redeem.yml` and `refresh-token.yml` share concurrency group `stfc-gift-redeemer` so they cannot race on `STFC_ACCOUNTS`. This is a real safety invariant Borg Queen flagged as worth codifying — I included it in the rerun-safety bullet of revised V.
- Outbound network surface is wider than "STFC API only": the helpers also reach Scopely's `home.startrekfleetcommand.com` login surface (Playwright) and the GitHub API (`gh secret set`). Any "outbound limited to STFC" claim has to carve out both.

**Output artifacts:**
- `.squad/.scratch/uhura-v1.2.0-patches.md` — full revised text for Bashir to drop in
- `.squad/decisions/inbox/uhura-v1.2.0-revision.md` — decision memo with cross-check + open questions

---

## v1.2.0 Amendment Cycle — Parallel Lane (Integration/Secret) (2026-05-08 → 2026-05-09)

### Session: speckit-v1.2.0-ratification-with-known-tensions

**Status:** COMPLETE. v1.2.0 ratified with Known Tensions (Path D acceptance).

**Uhura's role:** Integration/secret governance lane in parallel-lane revision (path-B, under reviewer-rejection lockout).

**Context:** Picard's v1.1.1 draft (project-fit retarget) was rejected by Borg Queen. Picard locked out per protocol. Coordinator authorized parallel-lane revision (Uhura + Scotty in separate lanes, Bashir assembles). Uhura and Scotty worked independently without reading Picard's v1.1.1 draft or each other's patches.

**Lane discipline:** Uhura's lane covers Principles I, III, V and Security & Compliance — all integration/API/secret-surface areas. Did NOT touch Principles II, IV, VI–IX, Development Workflow, or Governance (Scotty's lanes + common sections).

**Result:** Borg Queen issued second rejection (9 findings). Per protocol, Uhura locked out (as part of 3-author lockout). Coordinator escalated to Path D (Known Tensions ratification).

**Lockout duration:** Cycle-scoped. Resets for v1.3.0 cycle.

**Lesson for next cycle:** Parallel lanes are effective for parallel-draft speed; they're less effective for catching subtle accuracy issues because two independent authors both miss the same repo fact. Recommend: parallel lanes for speed, then CROSS-PROVIDER verification (not same-provider) for accuracy.

---

### 2026-05-08T23:40:33-07:00 — Recon Complete: Integration/Auth/CI Surface Documented

**Mission:** Reverse-engineer the codebase to produce a recon document enabling reimplementation in any language.

**Output:** `.squad/.scratch/spec-recon-uhura.md` — 8 sections, 300+ lines, language-agnostic specification.

**What I discovered (actual surface, not architecture):**

1. **STFC API is exactly four endpoints, all under `/api/v2`.** No hidden endpoints. All responses validated via permissive Zod schemas (.passthrough()) to tolerate field-name drift (snake_case vs camelCase). Gift bundle ID has 3-fallback order: bundleId → bundle_id → id. All requests timeout at 10s; GET retries once on 5xx/network with jitter(500,1000)ms; POST never retries (state-changing).

2. **JWT lifecycle is capture → validate → merge → (optionally refresh).** Capture via Playwright network interception (POST /auth/login response.accessToken or Bearer header). Validation via GET /auth/me. Merge into STFC_ACCOUNTS JSON array (preserves multi-account, detects duplicates). Refresh weekly via refresh-token.yml + headless Playwright (MFA/CAPTCHA fails silently; manual intervention required).

3. **Token handling has TWO sanctioned write paths:** capture-token.mjs (local via gh secret set --body-file - on stdin) and refresh-token.yml (CI via STFC_REFRESH_PAT). Both preserve other accounts. Redaction is manual at call-site (src/api/client.ts wraps every error message), not automatic in logger.

4. **STFC_ACCOUNTS is JSON array with strict parsing:** [{"name":"main","token":"eyJ..."},...]. Rejects empty, duplicates, non-JWT tokens. Multi-account runs process sequentially; one expired token does NOT block others.

5. **Promo codes are one-per-line text file, naturally idempotent.** Blank lines ignored; # comments (whole-line or inline) stripped. No de-duplication file-side; API returns CODE_ALREADY_USED if already redeemed. Code sourcing is manual (public game wikis); no auto-refresh.

6. **Redeem runs cron every hour (0 * * * *).** Refresh runs cron every Sunday at 04:00 UTC (0 4 * * 0). Both share concurrency group `stfc-gift-redeemer` with cancel-in-progress: true (tight scheduling risk: refresh could interrupt active redeem if dispatched manually during run).

7. **13 outcome terms classify all per-attempt results; ALL exit 0 (expected).** Only unhandled exceptions (infra errors) exit 1. Outcome vocabulary: CLAIMED, ALREADY_CLAIMED, AT_MAX, IS_SPECIAL, HAS_COST, CODE_REDEEMED, CODE_ALREADY_USED, CODE_INVALID_OR_EXPIRED, LEVEL_TOO_LOW, TOKEN_VALID, TOKEN_EXPIRED, NO_GIFTS_AVAILABLE, TRANSIENT.

8. **Run summary is GitHub Actions step summary (GITHUB_STEP_SUMMARY Markdown).** Per-account section includes token expiry, gift outcomes table, code outcomes table. Redact called before rendering. Redeem-history.md auto-appends one row per account that claimed ≥1 gift (UTC timestamps, newest first).

9. **Redaction is defense-in-depth.** Patterns: JWT (3 base64url segments ≥8 chars), Authorization header (any case variant), code applies redactString at throw-site. Logger calls redactForLog on errors. Summary calls redactForLog before GITHUB_STEP_SUMMARY write. No redaction in capture-token.mjs (mitigated by stderr-only output + ::add-mask::).

10. **Open questions flagged:** API field-name normalization (bundle_id vs bundleId inconsistency), gift title vs name fallback semantics, promo result code docs (external JS bundle source; can go stale), MFA/CAPTCHA unhandled (manual fallback required), concurrency race window (redeem + manual refresh dispatch), redeem-history duplicate rows (audit trail or oversight?), 429 rate-limit handling (not documented), cj_pwd secret purpose (unknown).

**Recon document is complete and language-agnostic.** Any team can reimplement the integration surface given this spec, STFC API contract changes are immediately visible against these shapes, and CI/secret flows are fully documented.

### 2026-05-12: Game-Flow Recon (New User Guides)

- **Auth backbone confirmed: Scopely Okta OAuth2.** The new-user-guides index links straight to `id.scopely.com/oauth2/default/v1/authorize` with client_id `0oa1496nmx8OcY8eI5d7`, scopes `openid email profile offline_access`, redirecting to `home.startrekfleetcommand.com`. Our captured JWT is the downstream artifact of that flow. `offline_access` means refresh tokens are issued — long-term we should capture the refresh token, not just the access token, and stop relying on the bookmarklet for re-auth.
- **Resource vocabulary for parser hardening.** Canonical currencies the guides name explicitly: **Latinum** (premium), **Parsteel / Tritanium / Dilithium** (tier-1), **Raw + Refined Crystal / Gas / Ore** (mid-game refinery outputs). Plus implicit-but-universal: **Ship XP, Officer XP, Officer Shards, Recruit Tokens, Blueprints, Speedups (build/research/repair/tier-up)**. Any of these can appear in a gift payload; parser should not blow up on novel resource_ids.
- **Gift-code value inflection ≈ Ops 15.** Before that the player is generator-bound and codes are quality-of-life. After that, refined materials + blueprints + officer shards from gift drops become real progression. Useful framing when deciding what payload fields are worth surfacing in logs/notifications.
- **Ship-name recognition matters for store inventory.** Early: ECS Fortunate, Orion Corvette, Envoy, Mayflower, K't'inga, Centurion. Mid: Saladin, D4, Augur, Realta, Phindra. Late/Epic: Enterprise, Discovery, Vi'dar, Stella, Franklin, Mantis, Cerritos. Store packs are routinely named after ships ("Discovery Pack", "Augur Crew Pack") — our log output should treat these as item identifiers, not arbitrary strings.
- **Idempotency expectation.** Promo codes are one-time-per-account; re-submission should return a deterministic "already redeemed" error. Treat that as terminal-success-equivalent, never as a retryable failure.
- **Adjacent surface worth probing.** Web store has a "Daily Gift" / "Free Pack" claim flow that almost certainly sits behind the same Scopely JWT — likely a free automation win once promo redemption is solid.
- **FAQ page is JS-rendered.** Static fetch returns only a footer fragment; if we need FAQ content later, will need a headless-browser fetch or sniffing the underlying API call.
