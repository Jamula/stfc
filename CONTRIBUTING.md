# Contributing to `Jamula/stfc`

This document covers the practices that keep the repository healthy across all
subsystems (`src/`, `api/`, `web/`, `worker/`, `pwa-token-api/`, `pwa-browser/`,
`shared/`, and `scripts/`). For authoritative agent and repository rules, read
[`.github/copilot-instructions.md`](.github/copilot-instructions.md). When this
file conflicts with repository instructions, `.github/copilot-instructions.md`
wins.

---

## Build, test, and typecheck gates

`npm test` and `npm run typecheck` are **two independent gates** at the root:
`npm test` runs `node --import tsx --test`, which strips TypeScript types
without checking them. Always run both before pushing:

```bash
npm ci                                       # root dependencies
npm --prefix api ci && npm --prefix web ci && npm --prefix pwa-token-api ci && npm --prefix pwa-browser ci && npm --prefix worker ci
npm test                                     # full root suite
npx tsx --test tests/skills/runAll.test.ts   # single file while iterating
npm run typecheck                            # tsc --noEmit (requires subpackage node_modules above)
```

### Repository-specific traps to avoid

1. **Register new root tests in `tests/index.test.ts`.** Root `npm test` runs a
   single aggregator file (`tests/index.test.ts`). Any new `tests/**/*.test.ts`
   file that is not imported there **silently never runs**.
2. **Keep `.mjs` and `.d.mts` pairs in sync.** Standalone JavaScript modules in
   `scripts/*.mjs` and `shared/*.mjs` carry adjacent `.d.mts` declaration files.
   Adding or changing an export requires updating its `.d.mts` file or
   `npm run typecheck` will fail.
3. **Subpackage checks.** `.github/workflows/test-gate.yml` also runs `worker/`
   (`npm ci`, `npm run typecheck`, `npm test`) and independent `typecheck` steps
   for `pwa-browser/` and `pwa-token-api/`. When editing `web/` or `api/`, run
   their build scripts (`npm run build:web`, `npm run build:api`) as well.
4. **Node versions and stack conventions.** Root workflows use Node from
   `.nvmrc` (Node 24); `api/.nvmrc` uses Node 22 for Azure Static Web Apps
   Functions. Preserve existing stacks when maintaining current subsystems. For
   net-new standalone tools or systems, prefer C# on a supported .NET LTS
   release, Node.js/TypeScript when .NET is unsuitable, and avoid Python where
   possible.
5. **Cross-platform portability (Windows + Linux Codespaces).** Never put
   `:`/`*`/`?`/`"`/`<`/`>`/`|` in tracked filenames (use `2026-08-13T04-38-00Z`
   for timestamps). Normalize CRLF (`\r?\n`) when parsing repo files, and pass
   `shell: true` on Windows when spawning `npm`.
6. **Schema tolerance, never silent failure.** Permissive upstream API schemas
   must still resolve every operation to an explicit `Outcome`. Never classify
   expired tokens, unknown responses, or transient errors as benign success.
7. **Coding style & manifest invariants.** `.editorconfig`, `.prettierrc.json`,
   and `.prettierignore` codify 2-space indentation (no tabs in `package.json`
   or `tsconfig*.json`), UTF-8, `semi: true`, `singleQuote: false`, `"strict": true`
   across all TypeScript configs, and `lf` line endings.

---

## Test-first discipline for bug fixes

Every bug fix MUST include a test that reproduces the bug — the test must fail
before the fix is applied and pass after. The PR description MUST provide proof
that this sequence actually happened.

### Why the paper trail matters

A reviewer cannot inspect your local git history. If you just write a passing
test and attach it to the fix commit, there is no way to verify it ever failed.
The failing-test commit SHA in the PR description closes that gap: anyone can
check out that commit and run `npm test` to confirm the test failed there.

### Concrete example

**Step 1 — Write the failing test (commit this alone):**

```
git add tests/lib/promoCodes.test.ts
git commit -m "test(promoCodes): reproduce #42 — empty code string crashes parser"
# commit SHA: abc1234
```

Run `npm test` on this commit. It fails:

```
FAIL tests/lib/promoCodes.test.ts
  ● parsePromoCode › crashes on empty string
    TypeError: Cannot read properties of undefined (reading 'trim')
      at parsePromoCode (src/lib/promoCodes.ts:17:14)
```

Copy that output. You will paste it into the PR.

**Step 2 — Write the fix (commit this separately):**

```
git add src/lib/promoCodes.ts
git commit -m "fix(promoCodes): guard against empty code string (#42)"
# commit SHA: def5678
```

Run `npm test` again. It passes.

**Step 3 — Fill in the PR template:**

Under "Test-first evidence":
- Failing-test commit SHA: `abc1234`
- Test name + file: `parsePromoCode › crashes on empty string   tests/lib/promoCodes.test.ts`
- Failure output: _(paste the stdout from Step 1)_
- Passing output: _(paste the stdout from Step 2)_

Reviewers can request the missing evidence before approving a bug-fix PR.

---

## Planning expectations

Use a short written plan in the issue or PR description for non-trivial work,
especially when the change crosses modules, touches CI/build config, or changes
API contracts. Single-file fixes, typos, and docs-only edits can go straight to
implementation.

---

## Secrets, licensing, and authorization boundaries

- **Zero live credentials in Git or PRs.** Never read `.env` files, echo bearer
  tokens, or include real STFC account data in commits, tests, issues, or PRs.
  The pre-commit hook and `artifact-hygiene.yml` scan changed files for known
  token patterns and selected STFC account fields, redacting matched content
  (heuristics are defense-in-depth, not a guarantee).
- **Licensing.** Original project code contributions are submitted under the
  [Apache License 2.0](LICENSE) (`Copyright 2026 Jamula, Inc.`). Do not vendor
  or mirror third-party or community content without verified redistribution
  rights and attribution.
- **Explicit owner approval gates.** Opening or merging a PR does **not**
  authorize marking a draft PR ready, bumping the `0.1.0` product version
  ([CHANGELOG.md](CHANGELOG.md)), publishing a release, deploying cloud
  services, running live store redemptions, or changing external GitHub/cloud
  settings.

---

## Review and CI

Review changes for correctness, security, and coverage of the documented
acceptance criteria.

The `test-gate.yml` workflow runs `npm run typecheck` and `npm test` for the
root package and `worker/`, plus `typecheck` for `pwa-browser/` and
`pwa-token-api/`. Run the relevant commands locally and report the results in
the pull request. The pre-commit hook runs the root test suite.

Ready PRs from branches in this repository targeting the default branch are
automatically enrolled in squash auto-merge, except Dependabot PRs. The workflow
also reconciles open PRs every 15 minutes, including those created by GitHub
Actions, and will re-enable auto-merge if it is manually disabled. Drafts and fork
PRs are excluded. Use a draft to keep an eligible same-repository PR from being
enrolled.

The default-branch ruleset must strictly require the GitHub Actions checks
`npm test (required)` and `verify` (Protected paths). GitHub also enforces any
other required checks, reviews, and rules before merging. Do not require checks
from workflows that do not run on every PR; they can leave PRs blocked. The
automation fails if its two baseline required checks are missing, and reports
other API or permission failures in its workflow run. Configure the repository
variable `AUTO_MERGE_APP_CLIENT_ID` and secret `AUTO_MERGE_APP_PRIVATE_KEY` for
a GitHub App installed only on this repository with Contents and Pull requests
write permissions and no ruleset bypass. The workflow uses this scoped App token
for API and CLI operations so resulting merges trigger downstream workflows;
it fails closed if the App can bypass a protected ruleset.

---

## Dependency maintenance and Dependabot policy

The owner-approved [policy in #316](https://github.com/Jamula/stfc/issues/316)
designates Seven for weekly Dependabot triage. If Seven is unavailable, the
owner should designate an alternate maintainer. Dependabot checks each npm
package and GitHub Actions weekly; minor and patch updates are grouped by
ecosystem and directory, while major updates remain separate by dependency.
Playwright version updates are grouped by dependency name across the root and
`pwa-browser` so both lockfiles can move together. Dependabot can still open
separate PRs for incompatible constraints or security updates; keep
`playwright` and `playwright-core` versions aligned in both lockfiles.

Major updates require explicit maintainer review and passing required checks
before a **manual merge**; they must not be blanket auto-merged. Routine updates
also require maintainer triage and applicable checks before merging. The repository's
auto-merge workflow does not automatically enroll any Dependabot PR because it
cannot reliably distinguish every major update. It does not cancel existing
auto-merge requests: check their state during triage, and do not enable one for
a major update. The workflow's exclusion does not prevent someone from
enrolling a PR through another mechanism.
