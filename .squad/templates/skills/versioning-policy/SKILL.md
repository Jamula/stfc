---
name: "versioning-policy"
description: "Versioning policy for Jamula/stfc's private app package"
domain: "release, versioning"
confidence: "high"
source: "repository workflow"
---

## Context

Jamula/stfc is a main-only repository with one private `stfc-gift-redeemer`
package. Its version is recorded in the root `package.json`; this is not a
multi-package SDK/CLI workspace.

## Version Format

Use a valid `MAJOR.MINOR.PATCH` version in `package.json`. When preparing a
release, add the matching `## [<version>]` heading to `CHANGELOG.md`.

## Release Branch and Automation

Feature and version changes go through pull requests targeting `main`.
`.github/workflows/squad-release.yml` runs on pushes to `main`, validates the
version and changelog, then creates a `v<version>` tag and GitHub Release when
that tag does not already exist. The package is private and the workflow does
not publish it to npm.

## Version Change Checklist

- Update the root `package.json` version and matching changelog heading in a
  pull request to `main`.
- Run `npm run typecheck` and `npm test`.
- After merge, inspect the `Squad Release` workflow and verify the tag and
  GitHub Release.
- If the tag exists without a corresponding release, ask a maintainer to
  reconcile them; rerunning the workflow skips existing tags.
