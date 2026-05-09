# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture, scope, direction | Picard | "Should we add multi-account support?", design proposals, trade-off calls |
| TypeScript / CLI / build | Scotty | Refactor `src/`, fix CLI flag, update `tsconfig.json`, dependency bumps |
| STFC API, auth, secrets | Uhura | JWT capture, redemption requests, response parsing, bookmarklet, `STFC_ACCOUNTS` format |
| Tests, fixtures, coverage | Bashir | Add unit tests, write integration tests, debug flaky CI tests, fix test fixtures |
| Critique, risk, assumptions | Borg Queen | Pre-mortem a plan, audit a proposal, surface blind spots, devil's-advocate review |
| Editorial passes on governance docs per explicit reviewer findings | Tuvok | Apply Borg Queen's findings as surgical edits to constitution drafts, change-impact accounting, cross-reference fixes |
| Code review | Picard (with Borg Queen on request) | Non-trivial PR review, architectural sign-off |
| GitHub Actions workflows | Scotty (build/test) / Uhura (cron + secrets) | `.github/workflows/*.yml` changes |
| Session logging | Scribe | Automatic — never needs routing |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Picard |
| `squad:picard` | Architecture / triage / review work | Picard |
| `squad:scotty` | TypeScript / CLI / build work | Scotty |
| `squad:uhura` | STFC API / auth / secrets work | Uhura |
| `squad:bashir` | Test work | Bashir |
| `squad:borg-queen` | Critique / risk audit | Borg Queen |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, **Picard** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Picard's review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what's the cron schedule?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern. API shape questions go to Uhura even if the code lives in `src/` (Scotty's house).
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If Uhura is changing an API contract, spawn Bashir to update fixtures simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. Picard handles all `squad` (base label) triage.
8. **Borg Queen as default critique** — for non-trivial proposals, spawn Borg Queen alongside the implementer to challenge assumptions in parallel. The team decides; she informs.
