# Release Process

## Scope

This playbook describes releases for Jamula/stfc's private `stfc-gift-redeemer`
package. The repository uses a main-only branch model and does not publish the
package to npm.

## Release Workflow

`.github/workflows/squad-release.yml` runs when changes are pushed to `main`.
It selects Node from `.nvmrc`, installs the locked dependencies, runs
`npm run typecheck` and `npm test`, and requires a `CHANGELOG.md` heading for
the version in `package.json`.

If the matching `v<version>` tag already exists, the workflow skips release
creation. Otherwise, it creates an annotated `v<version>` tag and a latest
GitHub Release with generated release notes. It does not publish to a package
registry.

## Release Checklist

- Update the version in `package.json` and add the matching
  `## [<version>]` heading to `CHANGELOG.md`.
- Validate with `npm ci`, `npm run typecheck`, and `npm test`.
- Submit the change through a pull request targeting `main`.
- After it lands, inspect the `Squad Release` workflow and verify the tag and
  GitHub Release.

## Recovery

Use the failed `Squad Release` run to identify and fix validation or release
errors through a pull request. If the tag exists but its GitHub Release was not
created, a rerun will skip creation; a maintainer must reconcile the tag and
release before retrying.

## Workflow Publishing Guard

Active workflow `run` steps must not publish npm packages. The workflow
consolidation regression test checks that prohibition, and the required
`squad-test-gate.yml` runs that test through `npm test`. Any future registry
publishing must be designed and reviewed separately rather than added as an
uncovered workflow command.
