# Product versioning and release policy

**Status:** product version `0.1.0` (the root package); retain this version until
the STFC minimum viable product (MVP) has documented end-to-end acceptance
and the repository owner explicitly approves the next product version.
**This policy does not declare the MVP complete or authorize a release.**

## Canonical version

- Use [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html):
  `MAJOR.MINOR.PATCH`, optionally with a standard prerelease suffix.
- The product's source of truth is the root `package.json` `version`;
  root `package-lock.json` must match at the top level and at `packages[""]`.
- Git release tags and GitHub Release titles are `vMAJOR.MINOR.PATCH`
  (or `vMAJOR.MINOR.PATCH-prerelease`). `CHANGELOG.md` uses
  `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD` for published releases and
  `## [Unreleased]` for reviewed but not yet released work.
- The `api/`, `web/`, `worker/`, `pwa-token-api/` and
  `pwa-browser/` packages are independently versioned components.
  Their version strings are **not** evidence of a product release and must
  not be changed just to match the root. Avoid incidental changes to
  their lockfiles or packages.
- `.nvmrc` and Node/.NET SDK versions are *runtime/toolchain* versions,
  not the STFC product version.

## Version and acceptance gates

1. **While MVP acceptance is outstanding:** keep the root product version
   at `0.1.0`, including fixes, docs and preliminary features. Record
   changes under `[Unreleased]`; do not publish a new product tag.
2. **MVP acceptance:** establish the actual product milestones and acceptance
   requirements from the relevant tracked epics. Confirm real user workflows,
   security/privacy, authenticated operation, data persistence, recovery
   and required independent review with timestamped evidence. A merged PR,
   green CI or skipped deployment is not sufficient.
3. **Release authorization:** obtain the owner's separate explicit approval
   for the selected product version, scope and production impact. The owner
   authorizes any necessary merge and release action separately; issue or
   backlog approval alone is not release approval.
4. **Propose version change:** in a dedicated reviewed PR, update root
   `package.json`, both root lockfile version fields, `CHANGELOG.md`,
   and any directly affected documentation. Document the SemVer rationale
   and release scope, run `npm ci`, `npm run typecheck`, `npm test`
   and relevant subpackage tests, and preserve required checks.
5. **Publish only after separate approval:** `.github/workflows/release.yml`
   is a manually dispatched release workflow. Dispatch it on `main`
   with the **exact approved version**; it verifies the input against
   root metadata, lockfile and changelog before creating the `v` tag
   and GitHub Release. A non-existent tag is not itself release approval.
6. **Verify:** confirm published tag SHA, changelog entry and GitHub Release;
   record links in the release PR/issue. No release workflow, issue closure,
   merge or deployment is authorized merely by editing this policy.

For an ordinary patch, MINOR and MAJOR remain unchanged; a backward-compatible
new capability may justify MINOR; a breaking public contract can justify
MAJOR. During `0.x` the product remains pre-1.0 in SemVer terms; version
selection still requires the acceptance and owner gates above. Never infer
a version bump from the number of merged PRs.

## Historical tags: exception, not precedence

STFC released [`v1.0.0`](https://github.com/Jamula/stfc/releases/tag/v1.0.0)
on 2026-06-26 and later explicitly reset the current root product version to
[`v0.1.0`](https://github.com/Jamula/stfc/releases/tag/v0.1.0) on
2026-11-08. This is an acknowledged historical out-of-order release, **not**
a claim that SemVer normally allows decreasing a released version.
Preserve both historical records as they exist; do not delete, rename or
rewrite either without a separate express owner decision. Treat root
`0.1.0` as the **current agreed product baseline**; discuss any proposed
future version against the full published-tag history before approval.

## Workflow and security boundaries

- Ordinary pushes and PRs must never create a new product tag just because
  `package.json` was edited. The release pipeline's manual dispatch is a
  publication action, not a substitute for an approved PR.
- Keep code changes and product release actions separate. A draft PR remains
  in review and is not permission to activate the repository's auto-merge.
- Do not expose STFC login tokens, private account data, Discord credentials
  or production secrets in changelogs, issue comments or release notes.
- Public release/repository visibility is a separate process guarded by
  [#400](https://github.com/Jamula/stfc/issues/400),
  [#401](https://github.com/Jamula/stfc/issues/401) and
  [#402](https://github.com/Jamula/stfc/issues/402).

## Related documentation

- [README](../README.md) for product status and usage.
- [Contributing](../CONTRIBUTING.md) for PR and test requirements.
- [Changelog](../CHANGELOG.md) for release history.
- [Architecture](ARCHITECTURE.md) for release CI and security boundaries.
- [Release workflow](../.github/workflows/release.yml) for the
  manual-dispatch implementation.
