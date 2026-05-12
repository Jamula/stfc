---
name: "merge-both-added"
description: "Pattern for resolving git 'both added' knowledge/skill doc conflicts"
domain: "git-workflow"
confidence: "high"
source: "picard-2026-05-12"
---

## When to Apply

When a `git merge` or `git rebase` produces **both added** conflicts on documentation, knowledge base, or skill files — i.e., two branches independently created the same file with different content.

## Resolution Algorithm

1. **Read both sides fully.** Don't pick one blindly.
2. **Determine the richer side.** Which has more research depth, more sections, more detail?
3. **Use the richer side as the base.** This is your starting document.
4. **Extract unique value from the other side.** Look for:
   - Sections not present in the base (e.g., an Index, a signal analysis table)
   - Structured summaries that complement the base's prose
   - Concrete named examples the base lacks
5. **Append or merge unique sections** from the other side into the base. Maintain the base's heading structure.
6. **If both sides conflict on a convention** (not just content), resolve explicitly and document the decision in `.squad/decisions/inbox/`.

## Example

Ours (research session): deep 80-line document with raw data, open questions, currency cheatsheet.
Theirs (PR): 30-line structured summary with resource vocabulary table and Index section.

Resolution: Take ours as base. Append theirs' Index. The resource vocabulary table from theirs is already covered in ours' cheatsheet — skip it to avoid duplication.

## Commands

```bash
# View both sides
git show HEAD:{file}          # current HEAD (during merge, HEAD = target branch)
git show MERGE_HEAD:{file}    # incoming branch

# After editing
grep -n '^<<<<<<<\|^=======\|^>>>>>>>' {file}  # verify no markers remain
git add {file}
```

## Anti-Patterns

- ❌ Taking "ours" because it's ours — check if theirs has unique value.
- ❌ Taking "theirs" because it looks cleaner — a cleaner structure on a shallower document is worse than a messier deep one.
- ❌ Concatenating both sides raw — always deduplicate and maintain coherent structure.
- ❌ Forgetting to check for conflict markers after editing — always grep before staging.
