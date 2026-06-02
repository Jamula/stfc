# verify-action-sha

## Purpose

Verify a GitHub Action SHA pin actually matches the claimed release tag before merge.

## When to use

- Any workflow change adds or updates `uses: owner/repo@<sha>`
- A reviewer questions provenance of an existing SHA pin

## Procedure

1. Resolve the tag to a SHA:

```bash
gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'
```

2. Compare the returned SHA to:
   - workflow YAML `uses:` line
   - pinning test assertions
   - PR description notes

3. If mismatched, update all references to the verified SHA in one commit.

4. Re-run validation:

```bash
npm test
npm run typecheck
```

## Notes

- Prefer stable releases (non-draft, non-prerelease) from repository releases.
- `git/refs/tags/<tag>` works for lightweight tags and is the preferred API check.
