# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Scope, priorities, "build vs defer" | Picard (M2/EM) | "Should we add multi-account support this release?", roadmap calls, scope trade-offs |
| Technical architecture, direction | Kirk (Lead) | "Should the digest writer live in `src/digest/` or `src/discord/`?", module-boundary calls, dependency choices |
| TypeScript / CLI / build | Scotty | Refactor `src/`, fix CLI flag, update `tsconfig.json`, dependency bumps |
| STFC API, auth, secrets | Uhura | JWT capture, redemption requests, response parsing, bookmarklet, `STFC_ACCOUNTS` format |
| Tests, fixtures, coverage | Bashir | Add unit tests, write integration tests, debug flaky CI tests, fix test fixtures |
| Critique, risk, assumptions | Garak | Pre-mortem a plan, audit a proposal, surface blind spots, devil's-advocate review, hostile fact-check claims against the live repo |
| Editorial passes on governance docs per explicit reviewer findings | Tuvok | Apply Garak's findings as surgical edits to constitution drafts, change-impact accounting, cross-reference fixes |
| Code review (technical correctness) | Kirk (with Garak on request) | Non-trivial PR review, architectural sign-off |
| Code review (scope / governance) | Picard | Sign-off that PR matches spec, no scope creep, constitution honoured |
| GitHub Actions workflows (build/test, cron, secrets, squad-automation) | O'Brien | All `.github/workflows/*.yml` changes — unified ownership as of 2026-05-18 (replaces the Scotty/Uhura split) |
| CodeQL alerts, Dependabot triage, PAT lifecycle, `secrets-check.yml` | O'Brien | Security toolchain end-to-end |
| Release engineering (`release.yml`, `CHANGELOG.md`, version bumps) | O'Brien | Full release pipeline |
| ML model lifecycle — HF cache invalidation, model-SHA rotation strategy | O'Brien (infrastructure) / Uhura (API + integration) | Cache-warming workflow + invalidation = O'Brien; HF client code + integration tests = Uhura |
| Session logging | Scribe | Automatic — never needs routing |
| Cross-team blocker removal, secret-custody escalations | Picard (M2/EM) | "We need a new GitHub secret added", environment fixes blocking the team |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Picard (M2/EM) |
| `squad:picard` | Scope / priority / governance / triage / blocker-removal work | Picard |
| `squad:kirk` | Architecture / technical direction / code review on correctness | Kirk |
| `squad:scotty` | TypeScript / CLI / build work | Scotty |
| `squad:uhura` | STFC API / auth / secrets work | Uhura |
| `squad:bashir` | Test work | Bashir |
| `squad:garak` | Critique / risk audit / hostile fact-check | Garak |
| `squad:tuvok` | Editorial / process-audit / template re-sync work | Tuvok |
| `squad:obrien` | Workflow YAML / CI/CD / security toolchain / release / ML cache infra | O'Brien |
| `squad:copilot` | Work scoped to @copilot's tier profile (🟢 small / 🟡 medium / 🔴 architecture) | @copilot (autonomous coding agent) |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, **Picard (M2/EM)** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes. For technical-direction issues, Picard may route to **Kirk** for sub-triage to the right contributor.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Picard's review.

### How to Create Issues (mandatory convention)

When ANY squad member files a new issue (`gh issue create`), it MUST carry routing labels. See `.copilot/skills/issue-creation/SKILL.md` for the full pattern. Quick reference:

| Situation | Labels |
|-----------|--------|
| In my own domain (self-assign) | `squad,squad:{my-name},{content-label}` |
| Clearly belongs to another agent | `squad,squad:{their-name},{content-label}` |
| Cross-domain or unclear → Picard triages | `squad,{content-label}` |

Where `{content-label}` is one of: `bug`, `enhancement`, `documentation`, `question`.

**Examples:**

```bash
# Bashir self-assigns a coverage gap
gh issue create -t "Fixture missing for Augments-faction ship" \
  -l "squad,squad:bashir,enhancement" -b "..."

# Uhura raises an auth migration and hands off to Scotty
gh issue create \
  --title "Migrate from password auth to Scopely OAuth" \
  --body "..." \
  --label "squad,squad:uhura,squad:scotty,enhancement"

# Anyone files a cross-cutting question for triage
gh issue create -t "Should we cap parallel redemptions per account?" \
  -l "squad,question" -b "..."
```

**Anti-patterns:**
- ❌ Filing without any `squad*` label — invisible to Ralph and squad workflows
- ❌ Self-assigning out-of-charter work — hand off explicitly instead
- ❌ Multiple `squad:{member}` labels when routing is unclear — use `squad` only and let Picard triage
- ❌ Using freeform labels (`picard`, `scotty`) instead of the `squad:{member}` convention


## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what's the cron schedule?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern. API shape questions go to Uhura even if the code lives in `src/` (Scotty's house). Scope questions go to Picard; technical-direction questions go to Kirk.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If Uhura is changing an API contract, spawn Bashir to update fixtures simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. Picard (M2/EM) handles all `squad` (base label) triage; he may delegate technical sub-triage to Kirk.
8. **Garak as default critique** — for non-trivial proposals, spawn Garak alongside the implementer to challenge assumptions in parallel. The team decides; he informs. (Seat previously held by Borg Queen through 2026-05-16.)
9. **Garak hard-gate (2026-05-18, audit #64)** — every `feat(*)` PR that touches `src/` MUST include a Garak adversarial review BEFORE merge. Garak's verdict is recorded via `gh pr comment` with the `**APPROVE** ✅` / `**CHANGES_REQUESTED** ⚠️` header per Rule 9b. Kirk's technical review and Garak's adversarial review are **independent gates — both required**. The Rule 7 auto-merge gate does not fire on a `feat(*) src/` PR until both verdicts are posted as APPROVE and CI is green.
10. **Bashir reviewer-gate escalation (2026-05-18, audit #63)** — when Bashir rejects a PR on coverage grounds (per `bashir/charter.md:17`), the Coordinator routes the revision to a **different** agent per the Reviewer Rejection Protocol. If the coverage gap is in product code → Scotty/Uhura; if it's in test infrastructure (workflows, test runner config, pin tests) → O'Brien. The original author does not get to "just add the tests themselves" — that defeats the reviewer-lockout.
11. **Discord direction precedence (2026-05-18, audit #67)** — for work under `src/discord/`: architecture and refactor decisions route to **Kirk** (module boundaries, contract shapes, dependency choices); integration / protocol / Discord-API-shape work routes to **Uhura** (auth flow, message-format parsing, rate-limit handling). When in doubt, Kirk decides whose work it is; Picard handles cross-cutting scope.
12. **Kirk-as-author-and-reviewer mitigation (2026-05-18, audit #68)** — when a PR implements a design Kirk authored (decision attributable to Kirk in `decisions.md` or `decisions/inbox/`), the PR review MUST include **Garak co-review** alongside Kirk's technical review. This prevents the Rule 7 auto-merge gate from firing on Kirk-approves-Kirk's-own-call. Kirk's APPROVE alone does NOT satisfy the gate; Garak's independent APPROVE is also required. (See `kirk/charter.md` — Tuvok handling the charter-side edit in parallel.)
