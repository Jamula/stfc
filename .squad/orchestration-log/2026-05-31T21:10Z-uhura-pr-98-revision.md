# Uhura — PR #98 revision (findings 1–5)

**Agent:** Uhura (Integrations Dev)  
**Task:** Address Garak + Bashir findings from PR #98 round 1 review  
**Input:** 5 findings (3 from Garak, 2 from Bashir)  
**Verdict:** All findings resolved ✅  
**Revision pushed:** 277f7023 (+53 tests, 650 total passing)  

## Summary

Addressed all findings in a single revision:

**Garak findings:**
1. **Roster contract invariant:** Renamed `example.yaml` → `demo.yaml`; enforced `account === filename basename` in `loadRoster()`.
2. **Byte-stable round-trip:** Canonicalized `demo.yaml` through production serializer; added real-data round-trip test.
3. **Real-data exception:** Documented T100 real-data validation exception in `tests/crew/realdata.test.ts` and `specs/004-crew-optimizer/plan.md`.

**Bashir findings:**
4. **Task YAML loader-path test:** Added 2 new tests in `tasks.test.ts` exercising malformed YAML through `loadTask()`.
5. **Schema invariants:** Expanded `schemas.test.ts` from 14 to 35 assertions, each with independent coverage of required invariants.

**Decision:** Selected **Option A** (roster naming) — rename to `demo.yaml` because:
- Committed roster already used `account: demo`.
- `demo` is a clearer illustrative account name.
- Preserves contract that filename matches in-file account.

## Validation

- `npm test`: 650/650 pass (up from 597).
- `npx tsc --noEmit`: clean.
- CI: all 5 checks green on 277f7023.

## Next steps

Both Garak and Bashir re-reviewed and approved. Merged as eb2fd9d on main.

## Decision record

`.squad/decisions.md` — "Uhura — Option A roster naming decision (PR #98 revision)" section.
