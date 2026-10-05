# .squad/decisions/ — Decision Registry

**Updated:** 2026-08-16T23:15:28Z
**Session:** chronicle-analysis

This is the canonical local decision ledger at `.squad/decisions/decisions.md`.
When runtime state tools are available, `decisions.md` is the logical state key;
the runtime resolves it to the configured backend. The key does not name a
second local file, and there is no `.squad/decisions.md` mirror.

Older entries are kept in the tracked [decision archive](../decisions-archive.md).
Append new accepted decisions without rewriting existing entries. When archiving,
move complete entries without changing their meaning; do not keep duplicate
ledger copies.
