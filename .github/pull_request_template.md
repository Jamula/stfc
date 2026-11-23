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

When **Version bump** is checked, link the explicit owner release approval and
MVP acceptance evidence, or mark the PR as **version-policy preparation only**.
The root package and lockfile must agree, the dated changelog entry must exist,
and the GitHub Release action requires a separately authorized manual dispatch.
See [docs/VERSIONING.md](../../docs/VERSIONING.md). Do not publish a tag or
merge merely because this checkbox is checked.

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

_For **non-trivial** changes (multi-file, cross-skill, new feature, >4 hr, build-config, or API contract change — see `CONTRIBUTING.md`), link the spec or issue plan:_

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
- [ ] Tracked mutable paths are untracked and ignored, and conflicting merge attributes are removed; static configuration remains trackable.
- [ ] Tests assert the real repository invariant, not only synthetic fixtures.
- [ ] Guarded paths are classified as static or mutable; every exception is explicit and narrowly scoped.
- [ ] The tracked Squad casting registry/history pair and commit marker are the only mutable-state exception; they use the native atomic casting protocol.

---

## Constitution check

- [ ] This change does not violate repository rules in `.github/copilot-instructions.md`.

_If there is a tension with a documented repository convention, describe it here and note why the tradeoff is justified:_

```
<!-- e.g., "Tradeoff: retained duplicate config file because an existing Squad CI test pins its presence until upstream template migration completes." -->
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

> Required for any change to live store redemption flow, browser-relay login automation, or auth detection.
> Skip if this PR touches only docs, tests, types, or build config.

- [ ] Smoke-tested against the live STFC store (extension).
- [ ] Smoke-tested against the live STFC store (web app).

_Observations:_

```
<!-- what you clicked, what you saw -->
```
