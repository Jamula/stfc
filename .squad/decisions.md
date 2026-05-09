# Squad Decisions

## Active Decisions

### 2026-05-08: Adopt Spec Kit (speckit) workflows when applicable
**By:** cyrusj (via Copilot)  
**Status:** Under team review (Phase 1 briefing completed)

The team should prefer Spec Kit (speckit) workflows — `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`, `/speckit.constitution`, `/speckit.checklist`, `/speckit.clarify`, `/speckit.analyze` — when starting new work, especially anything non-trivial. Use the speckit custom agents for the workflows they own rather than reinventing.

**Rationale:** User directive — captured for team memory. Brings discipline and traceability to spec → plan → tasks → implementation, and aligns this repo with its existing `.specify/` scaffolding.

**Team Input:**

- **Picard:** Proposes constitution amendment v1.1 (Option B: add Principle VI "Specification-First Governance"). Clarifies that speckit use is mandatory for non-trivial work; exempts typos/docs/bumps. See `.squad/decisions/inbox/picard-speckit-briefing.md` for analysis and open questions.

- **Scotty:** Speckit pragmatic for core dev; minimal build friction; proposes "Trigger Threshold" (use speckit for >4-hour work, multi-file changes, architectural decisions; skip for one-liners, single-file bugs, doc updates). Recommends Core Dev gate after `/speckit.plan` to validate tech context. See scotty-speckit-briefing.md.

- **Uhura:** Fit is 7/10; strong for happy-path; needs friction hooks for API discovery. Proposes constitutional Principle VI "Artifact Hygiene & Captured-Traffic Protection" (no tokens/real data in specs/plans/tasks) and Principle VII "Wire-First Discovery for Integration Changes." Pre-commit CI check to block JWT-shaped strings. See uhura-speckit-briefing.md.

- **Bashir:** Speckit makes testing visible and mandatory IF gates are set correctly. Critical gap: tests are optional in `/speckit.tasks` output. Proposes mandatory test-first discipline, spec review gate, tasks review gate (test tasks required), implementation review gate (all acceptance criteria have passing tests), and test-quality checklist template. See bashir-speckit-briefing.md.

- **Borg Queen:** "When possible" is vague and risky. Identifies three unstated assumptions (decision gates, overhead accounting, reviewer compatibility) and three failure modes (process theatre, constitution bloat, agent-authored code rejection loops). Proposes five prerequisites (decision gates, reviewer compatibility, overhead accounting, constitution lock-in, annual review). See borg-queen-speckit-briefing.md.

**Next Phase:** Team converges on constitutional amendments (likely combining Picard/Scotty/Uhura/Bashir proposals with Borg Queen's prerequisites). Phase 2 drafts amendment; Phase 3 merges into constitution.

---

### 2026-05-08T21:37:54-07:00: Picard — v1.1 Constitution FINAL DRAFT (ready for infra-gated ratification)

**By:** Picard  
**What:** Produced the finalized v1.1 draft at `.squad/.scratch/constitution-v1.1-proposal.md`. Four targeted edits were made to the Phase 2 proposal:

1. **Principle IV rationale rewritten** — The v1.0.0-era claim "no automated test suite" was preserved verbatim in the Phase 2 draft, creating a direct contradiction with Principle IX's `npm test` mandate. The rationale now correctly scopes Principle IV's safety-net claim to UI-layer correctness and explicitly acknowledges that Principle IX adds the test suite as a complementary (not competing) requirement. No obligations in Principle IV's bullet list changed.

2. **Principle VI version-bump exemption tightened** — The "version bumps and routine dependency updates" exemption was ambiguous: a developer could argue that touching `package.json` for any reason qualified. The exemption now specifies it covers changes to the `dependencies` or `devDependencies` fields only, with a clear NOTE that `scripts`, build config, and CI workflow changes are NOT exempt and meet the speckit trigger threshold.

3. **Enforcement infrastructure promoted from TODO to ratified policy** — The Phase 2 draft listed the CI token-scanner and npm test CI gate as post-ratification TODOs. Since the team selected Path A (Full Ship) and Uhura/Scotty/Bashir are building these gates this batch, the constitution now states the outcomes as enforced facts: (a) JWT-pattern files are blocked from merging by the CI workflows in `.github/workflows/`; (b) commits that fail `npm test` are blocked from merging by those same workflows; (c) bug-fix PRs require a documented failing-then-passing test artifact. No specific tool names (husky, simple-git-hooks, etc.) are named — that is Scotty's implementation call.

4. **Sync Impact Report updated** — Added a Finalize Pass section (timestamped 2026-05-08T21:37:54-07:00) summarizing the four edits, upgraded the enforcement infrastructure from TODO items to a pre-ratification implementation block, and dropped the CI token-scanner TODO (now policy, not backlog).

**Why:** Borg Queen's IV/IX contradiction finding was a hard blocker — the document would be internally inconsistent on its face. Scotty's exemption feedback prevents a real developer confusion vector that could route package.json script changes around the speckit gate. The enforcement promotion follows directly from the Path A decision: if the team is committing to build the infra, the constitution must describe the world those gates create, not aspirationally wish for it.

**Status:** Draft is ready. Ratification (apply to `.specify/memory/constitution.md`) PENDING completion of infra work by Uhura/Scotty/Bashir this batch.

---

### 2026-05-08T21:29:58-07:00: Uhura — Artifact Hygiene Scanner Built (Principle VII Enforcement)

**By:** Uhura (API & Integrations Developer)

---

**What was built**

Five files created to enforce Constitution Principle VII — no real tokens or account data in committed artifacts:

| File | Purpose |
|------|---------|
| `scripts/check-artifact-hygiene.mjs` | Cross-platform Node.js scanner (runs on Windows + Linux without separate sh/ps1) |
| `.github/workflows/squad-artifact-hygiene.yml` | CI gate: triggers on PR touching specs/plans/tasks/docs; posts remediation comment on failure |
| `tests/fixtures/artifact-hygiene/clean-spec.md` | PASS fixture — demonstrates correct `<REDACTED>` placeholder usage |
| `tests/fixtures/artifact-hygiene/contaminated-spec.md` | FAIL fixture — 6 distinct fake-token patterns, each clearly labeled as fabricated |
| `.squad/decisions/inbox/uhura-hygiene-test-integration.md` | Coordination note for Scotty re: `npm test` integration |

---

**Patterns covered (6 total)**

| Pattern name | What it catches |
|---|---|
| `JWT` | 3-segment base64url token starting with `eyJ` (≥10 chars per segment) |
| `BEARER_TOKEN` | `Authorization: Bearer <value>` headers where value is not a `<REDACTED>`/`YOUR_*` placeholder |
| `GITHUB_TOKEN` | `ghp_`, `gho_`, `ghs_`, `ghu_` tokens (36-char suffix) |
| `AWS_ACCESS_KEY` | `AKIA` + 16 uppercase alphanumeric chars |
| `API_KEY` | `api_key` or `api-key` assignment with alphanumeric value ≥ 20 chars |
| `STFC_ACCOUNT_DATA` | `account_id`, `alliance_id`, or `balance` JSON fields with numeric values > 999 |

All output redacts matched content to `<REDACTED-TOKEN>`. No secret value is ever logged.

---

**How to invoke**

```bash
# Scan all tracked files in watched dirs (default)
node scripts/check-artifact-hygiene.mjs

# Scan only staged files (pre-commit)
node scripts/check-artifact-hygiene.mjs --staged

# Scan specific files
node scripts/check-artifact-hygiene.mjs path/to/spec.md path/to/plan.md
```

Watched directories (default scan): `specs/`, `plans/`, `tasks/`, `.specify/memory/`, `.specify/templates/`, `docs/`, `.github/`

Exit code 0 = clean. Exit code 1 = violations found.

---

**Test results (verified locally)**

```
PASS: node scripts/check-artifact-hygiene.mjs tests/fixtures/artifact-hygiene/clean-spec.md
      → "Artifact hygiene: 1 file(s) scanned, 0 violations. ✓"  exit 0

FAIL: node scripts/check-artifact-hygiene.mjs tests/fixtures/artifact-hygiene/contaminated-spec.md
      → 8 VIOLATION lines (6 patterns, 3 STFC_ACCOUNT_DATA fields on separate lines)
      → "ARTIFACT HYGIENE FAILED — 8 violation(s) found"  exit 1

DEFAULT: node scripts/check-artifact-hygiene.mjs
      → "Artifact hygiene: 48 file(s) scanned, 0 violations. ✓"  exit 0
         (tests/ directory correctly excluded — contaminated fixture not auto-scanned)
```

---

**CI workflow details**

- Trigger: `pull_request` only (not push — avoids main-branch noise per brief)
- Path filter: `specs/**`, `plans/**`, `tasks/**`, `.specify/memory/**`, `.specify/templates/**`, `docs/**`, `.github/**/*.md`
- Override: PR description containing `[skip-token-scan]` bypasses the scan (for false positives)
- On failure: `actions/github-script@v7` posts a redaction-guidance comment to the PR
- Pinned actions: `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5` (v4.3.0), `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0)

---

**Why this fulfills the ratification condition**

My Phase 2 critique set a hard condition: *"Ratification may proceed when CI artifact-hygiene enforcement (JWT scanning) is operational."* The scanner is now operational and tested. Principle VII is no longer honor-system — it has enforcement infrastructure from day one.

The scanner is intentionally boring: plain Node.js, standard regex, no external dependencies, no marketplace actions beyond `actions/github-script`.

---

**Scotty coordination**

See `.squad/decisions/inbox/uhura-hygiene-test-integration.md` for my recommendation on wiring `test:hygiene` into `npm test`. TL;DR: recommend adding `"test:hygiene": "node scripts/check-artifact-hygiene.mjs"` to `package.json` scripts — Scotty's call.

**Uhura**

---

### 2026-05-08T21:29:58-07:00: Scotty — `npm test` enforcement gate built (Principle IX enforcement)

**By:** Scotty
**What:**

**Hook tool chosen:** `simple-git-hooks` — lighter than husky (no postinstall surprises, no extra config files, no nested package), 1 devDependency, cross-platform out of the box (hook script is a `.mjs` Node script so no shell dependency on Windows).

**Package.json delta:**
- Added `"prepare": "simple-git-hooks"` to scripts (auto-registers hooks on `npm install`)
- Added `"simple-git-hooks": { "pre-commit": "node scripts/pre-commit.mjs" }` config block
- Added `"simple-git-hooks": "^2.11.1"` to devDependencies

**Files created:**
- `scripts/pre-commit.mjs` — Node.js hook runner; runs `npm test`; exits 1 on failure (aborts commit). Contains TODO(Uhura) comment marking exactly where `check-artifact-hygiene.mjs` plugs in once it lands.
- `.github/workflows/squad-test-gate.yml` — PR-only CI workflow. Triggers on all pull_requests. Steps: checkout (pinned SHA), setup-node from `.nvmrc`, `npm ci`, `npm test`. Job name: `npm test (required)`.

**Test results from end-to-end verification:**
- Baseline: 87/87 pass before any changes.
- `node scripts/pre-commit.mjs` (green path): exits 0, all 87 pass. ✅
- Deliberately broken test (`isJwtShaped` forced to `false`): hook exits 1, commit would be aborted. ✅
- Reverted break: 87/87 pass again, hook exits 0. ✅

**Emergency bypass (auditable):** `git commit --no-verify` — documented in `scripts/pre-commit.mjs` header and below. Use only in emergencies; leave an audit comment in the commit message.

**Manual GitHub branch-protection step required from cyrusj:**
Branch protection rules cannot be set by an agent. After this PR merges and the `squad-test-gate` workflow has run at least once on a PR, do the following:

1. Go to: GitHub → **repo Settings** → **Branches** → **Add branch protection rule**
2. Branch name pattern: `main`
3. Check: ☑ **Require status checks to pass before merging**
4. Search for and select: **`npm test (required)`** (this is the job name in `squad-test-gate.yml`)
5. Check: ☑ **Require branches to be up to date before merging**
6. Save

Until that step is done, the local pre-commit hook is the only mechanical gate. CI workflow will run and report, but won't block merges.

**Why:** Implements Principle IX per Path A (Full Ship); closes the enforcement gap Bashir identified — `npm test` was a documented rule with no mechanical enforcement beyond developer honour.

---

### 2026-05-08T21:29:58-07:00: Bashir — Test-first proof workflow built (closes Principle IX honor-system gap)

**By:** Bashir

**What:**

**Files created:**

| File | Status |
|---|---|
| `.github/pull_request_template.md` | NEW |
| `CONTRIBUTING.md` | NEW |
| `.specify/memory/reviewer-runbook.md` | NEW |

**PR template — four required sections (plus smoke-test gate):**

1. **Type of change** — checkboxes for bug fix / new feature / refactor / docs / chore / version bump. Author must tick at least one; unticked template is immediate `request-changes`.

2. **Test-first evidence** — conditional section, required when "Bug fix" is ticked. Author must supply: (a) failing-test commit SHA or intra-PR hash, (b) test name + file path, (c) failure stdout from `npm test` on the failing commit (redacted), (d) passing stdout after the fix. Leaving this blank on a bug-fix PR triggers `request-changes` from Tester.

3. **Spec linkage** — for any non-trivial change per Principle VI Pragmatic threshold, link the `specs/NNN-foo/spec.md`. Exempt claims require explicit single-sentence justification (e.g., "single-file/version-bump/doc only").

4. **Tests run** — checkbox confirming `npm test` passed locally. Creates paper trail alongside Scotty's pre-commit hook.

5. **Constitution check** — checkbox confirming no constitutional violation, with space to document tensions and plan-table references.

_(Bonus: manual smoke-test section for automation-logic changes per Development Workflow gates.)_

**CONTRIBUTING.md — three sections:**

- *Test-first discipline for bug fixes*: Full concrete two-commit example (failing test commit → fix commit), failure output, what to paste in the PR. Explicit statement: "PRs marked 'bug fix' without test-first evidence will be requested-changes by the Tester reviewer."
- *Speckit usage*: Decision tree tied to Principle VI's Pragmatic threshold. When required (multi-file, cross-skill, new feature, >4hr, build-config, API contract). When not required (typo, version bump, single-file fix, docs). "When in doubt, use speckit."
- *Review gates*: All four Bashir veto powers named: (a) spec testability gate, (b) task-level test requirements gate, (c) implementation coverage mapping gate, (d) bug-fix test-first gate. Also documents Picard's gates and the artifact-hygiene scan step (Uhura's domain).

**Reviewer runbook — 9-step checklist:**

1. Read type-of-change  
2. Bug fix? Verify SHA via `git checkout <sha> && npm test` — test must fail on that commit  
3. Non-trivial? Verify spec exists and covers the change  
4. Run Uhura's artifact-hygiene scanner on spec/plan/tasks files in the diff  
5. Confirm "Tests run" checkbox  
6. Confirm "Constitution check" checkbox; challenge vague tension notes  
7. Verify CI is green (no exceptions for "flakes")  
8. Smoke-test gate for automation-logic changes  
9. Decision table: approve / request-changes / block

**Why:** Implements the enforcement layer for Principle IX's bug-fix discipline per Path A ("Full Ship"). The critique identified two gaps: (1) no PR template forced the author to supply test-first evidence, and (2) reviewers had no procedure to verify the SHA claim mechanically. The template closes gap 1; the runbook's SHA verification step closes gap 2. Together they convert "reviewer honor" into "verifiable audit trail."

**Open coordination items:**

- **Scotty** owns `package.json` / pre-commit hook wiring — the "Tests run" checkbox notes his hook but does not replace it.
- **Uhura** owns the artifact-hygiene scanner — the runbook references it as an invokable script (Step 4) but does not implement it.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
