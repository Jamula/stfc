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

> Skip this section only if no box above is "Bug fix." Reviewers may request missing evidence on a bug-fix PR.

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

_(The pre-commit hook should enforce this automatically. The checkbox creates an auditable paper trail.)_

---

## Enforcement-gate changes

_Complete this section when adding or tightening a gate over existing repository state._

- [ ] The same PR includes the migration that makes the current repository satisfy the gate.
- [ ] Tests assert the real repository invariant, not only synthetic fixtures.
- [ ] Guarded paths are classified as static or mutable; every exception is explicit and narrowly scoped.
- [ ] The tracked Squad casting registry/history pair and commit marker are the only mutable-state exception; they use the native atomic casting protocol.

---

## Constitution check

- [ ] This change does not violate repository rules in `.github/copilot-instructions.md`.

_If there is a tension with a principle, describe it here and note how the plan's Constitution Check table addresses it:_

```
<!-- e.g., "Tension with Principle III: selector fallback omitted for the dialog — justified in plan.md §Complexity Tracking because the dialog is only reachable on mobile and the CSS path is stable across known versions." -->
```

---

## Reviewer lanes

_List requested reviewers and their focus, if applicable._

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
