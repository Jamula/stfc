# STFC Gift Redeemer — Pull Request

> If this PR was driven by a design doc or feature spec, link it under "Spec linkage" below.

---

## Type of change

_Tick **at least one**. Multiple selections are allowed._

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Docs / comments
- [ ] Chore (dependency bump, config, CI)
- [ ] Version bump

---

## Test-first evidence _(REQUIRED when "Bug fix" is ticked above)_

> Skip this section only if no box above is "Bug fix." Leaving it blank on a bug-fix PR will result in a **request-changes** from the Tester reviewer.

**Failing-test commit SHA** _(the commit where the test exists but the fix does not — proves test-first)_

```
<sha or intra-PR commit hash>
```

**Test name + file path**

```
<describe("…") / it("…") block name>   tests/<path/to/file.test.ts>
```

**Failure output** _(paste stdout from `npm test` on the failing commit — redact any tokens/account data)_

```
<paste here>
```

**Passing output after fix** _(paste stdout from `npm test` on the fix commit)_

```
<paste here>
```

---

## Spec linkage

_For **non-trivial** changes (multi-file, cross-skill, new feature, >4 hr, build-config, or API contract change — per Principle VI), link the spec:_

- Spec: `specs/NNN-feature-name/spec.md` — <!-- or paste link -->
- Exempt: `<!-- single-file fix / typo / version bump / doc only — state reason here -->`

---

## Tests run

- [ ] `npm test` passed locally with zero failures before this PR was opened.

_(Scotty's pre-commit hook should enforce this automatically. The checkbox creates an auditable paper trail.)_

---

## Constitution check

- [ ] This change does not violate repository rules in `.github/copilot-instructions.md`.

_If there is a tension with a principle, describe it here and note how the plan's Constitution Check table addresses it:_

```
<!-- e.g., "Tension with Principle III: selector fallback omitted for the dialog — justified in plan.md §Complexity Tracking because the dialog is only reachable on mobile and the CSS path is stable across known versions." -->
```

---

## Reviewer lanes

_Replace the placeholder with every reviewer required for this PR. The reviewer gate fails closed until all placeholders are replaced and every listed reviewer approves the current head SHA._

- **<Reviewer>** (<lane>): <scope>

---

## What was changed and why

_One paragraph. What problem does this solve? Why this approach?_

---

## Manual smoke-test (required for automation-logic changes)

> Required for any change to redemption flow, selector logic, or auth detection (per Development Workflow & Quality Gates).
> Skip if this PR touches only docs, tests, types, or build config.

- [ ] Smoke-tested against the live STFC store (extension).
- [ ] Smoke-tested against the live STFC store (web app).

_Observations:_

```
<!-- what you clicked, what you saw -->
```
