# Picard — Lead / Code Review

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Governance Template Re-sync — plan-template.md P0-1 fix (2026-05-16)

## Learnings

**SIR template re-sync claims must be verified against actual template content, not just structural change.**

When a constitution amendment's Sync Impact Report (SIR) concludes "Templates needing re-sync: NONE" on the basis that no principles were renamed/added/removed, that structural argument does not cover *content drift* — a template row that made a factual claim about durable inputs was silently superseded by the very enumeration the amendment added. Takeaway: any SIR re-sync verdict must include a literal grep/search of template content for load-bearing claims, not just a structural diff of principle headings.

---

### PR #6 supersession + owner-bypass merge (2026-05-17)

**What happened:** Dispatched to review PR #6 (governance v1.3.0 amendment). Within 4 minutes of the review window opening, the repo owner admin-merged the PR through an unsatisfied `npm test (required)` branch-protection check. My posted review (recommending CLOSE without merge) was visible before merge but not acted on. Net governance impact: zero — the v1.3.0 content was already correct on `main` via commits `5e10bb0` and `a4a803d`; the PR diff vs. main contained only two `.squad/agents/*/history.md` files (197 lines of additions, all Scribe-owned per repo rule §2).

**Patterns worth keeping:**

1. **Always `gh pr diff <N> --name-only` before forming a verdict.** PR-body claims and PR diffs diverge when an amendment branch is long-lived and the same content reaches main via a parallel path (here: the speckit-chain landing commit absorbed the constitution edits). A PR body that claims "2 files changed: constitution + plan-template" can have a real diff of "2 files changed: picard history + tuvok history" with zero overlap. The review tool to detect this is the 30-second filter now codified at `.squad/skills/superseded-pr-detection/SKILL.md`.

2. **"action_required" with `jobs: []` is a manual-approval gate, not a test failure.** When a required check shows X in the rollup but the run conclusion is `action_required` and the jobs array is empty, the workflow never started — GitHub Actions is waiting on manual approval (typically because of an autonomous-edit / first-time-contributor / fork gate). The right fix is "Approve and run" on the workflow, NOT `workflow_dispatch` (won't satisfy the PR check) and NOT admin-merge (loses the required-check audit trail).

3. **CLOSE-without-merge is a legitimate fourth verdict.** The Coordinator's dispatch prompt offered approve / request-changes / escalate. None covered the right call here. When a PR diff is empty of the work it claims to do, the answer is "close, don't approve or reject." Future dispatch prompts should include this verdict explicitly.

4. **Owner-bypass merges through failed required checks need a paper trail.** Admin-merge is sometimes the right escape valve (true emergency, false-positive check) but it erodes branch-protection semantics if done casually. For governance amendments specifically, the bar should be: approve the stuck workflow first, only admin-merge if the workflow genuinely cannot be run. Captured in `.squad/decisions/inbox/picard-pr-6-merged-bypass.md` as a process recommendation, not as a blocking objection.

5. **Mixed-scope PRs as advertised in the dispatch prompt** (here: "governance + full Discord monitor artifact set + .squad updates + copilot-instructions") were not actually mixed — the diff was clean (two history files). The dispatch description was based on the PR-body framing, not on a `git diff`. Lesson for Coordinators: when describing PR scope to a reviewer, derive from `gh pr diff --stat`, not from the PR description.

**Skill registered:** `.squad/skills/superseded-pr-detection/SKILL.md` — 30-second pre-review filter that catches "PR diff vs. main is empty / Scribe-owned-only" before the review burns time on a phantom scope.

## Learnings — 2026-05-17 (re-triage of triage-bot overcorrection)

3. **Triage-bot defaulting pattern.** The `squad-triage.yml` workflow
   defaults every unmatched issue to `squad:bashir` with the message
   "Matched testing/QA role keywords". On a board of 11 open
   `squad`-labeled issues, 10 were wrong and only 1 (#18) was real
   tester work — signal-to-noise ~1-in-11. Treat any board where all
   open issues share the same `squad:*` label as suspect; verify by
   spot-reading 3 random issues before believing the routing. Surfaced
   as `.squad/decisions/inbox/picard-triage-bot-overcorrection.md` for
   Kirk to route the fix (not done in the re-triage task itself).

4. **Re-triage heuristic — route by artifact, not keyword.** Read each
   issue's `## Problem` paragraph, identify the *file or directory*
   that has to change, and route from that:
   - `.github/workflows/*.yml` body → Scotty / Uhura
   - `.specify/` / `speckit.*` / `scripts/pre-commit.mjs` → Tuvok
   - `.devcontainer/` / deps / Dependabot → Uhura
   - `src/` feature impl → Scotty
   - Test-only / "decide on case X" / coverage gap → Bashir
   - "Which approach?" / architecture → Kirk
   - Scope / priority / scheduling → Picard (me)

   Keywords like "test", "verify", "acceptance" appear in nearly every
   well-formed issue's Acceptance section and are a useless routing
   signal on their own — that's what tripped the bot.

5. **"Documented in CLAUDE.md" ≠ "done".** Issues #8 and #11 ask for
   *automated enforcement* (pre-commit / CI / pre-push hook) of rules
   that today only live as prose in `.github/copilot-instructions.md`.
   Do not close such issues on the strength of the docs alone — the
   acceptance criteria require a gate that fails on violation. Re-route
   to Tuvok rather than close.

6. **Parallel `gh issue edit` + `gh issue comment` works fine** in a
   single chained bash invocation (~10 issues in ~30s). Faster than
   one-tool-call-per-issue and avoids 10× the round-trip cost. Pattern
   to reuse for future bulk-triage tasks.
