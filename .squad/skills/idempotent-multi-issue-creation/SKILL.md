# Idempotent multi-issue creation

Use this skill when a feature plan needs a batch of linked GitHub issues with dependency references that require final issue numbers.

## Inputs

- Inventory of issues: stable key, title, labels, owner, dependencies, scope, and acceptance criteria.
- A hidden body marker convention, for example `<!-- crew-plan-id: stable-key -->`.
- Any labels that must be avoided because workflows trigger on them.

## Procedure

1. **Discover before creating.** Query all existing issues for the hidden marker and map `stable-key -> issue number`. Existing keys must be edited in place, not duplicated.
2. **Render body files locally.** Write each body to a repo-local scratch directory. Avoid passing large Markdown bodies on the command line, and clean the scratch directory afterward.
3. **Pass 1: create or update without resolved dependencies.** Put a temporary `Depends on:` placeholder in each body. Add only required labels. For multi-owner issues, pass each label separately.
4. **Collect issue numbers.** Parse numbers from create output and merge them with discovered numbers.
5. **Pass 2: rewrite dependency references.** Re-render every body so each dependency reads `stable-key (#number)`. Issues with no dependencies should use `—`.
6. **Verify.** For every expected stable key, fetch the issue body and confirm the marker is present. Fetch labels and confirm no forbidden trigger label was applied. Run a spot-check search for the forbidden label plus the hidden marker.

## Failure handling

- Retry a failed `gh` command once.
- If the retry fails, stop at that issue and report the command, stderr, and which pass failed.
- Do not continue creating later issues after an unresolved failure; partial runs are safe because the next run starts with discovery.

## Squad-triage caution

For Squad-owned work, prefer explicit `squad:{member}` labels. Never add the plain `squad` label unless the intent is to invoke the triage workflow.
