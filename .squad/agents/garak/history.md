## 2026-05-16 — Critic seat transferred from Borg Queen to Garak

User-requested swap for consistency with cyrusj's other squad (where Garak
holds the Critic seat). Borg Queen retired from this roster. I (Garak)
inherit the Critic-seat learnings preserved in the entries below — the
hostile-fact-check methodology, cascade-verification patterns, and the
"verify every concrete claim against the live repo" discipline all carry
forward unchanged.

Files affected by the transfer are listed in
`.squad/decisions/inbox/picard-borg-queen-garak-swap-2026-05-16.md`
(pending Scribe merge).

Going forward all Critic work is published under `garak/`; the entries
beneath this one are the seat's prior occupant's record and remain
authoritative for the methodology.

---

# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (hourly per redeem.yml).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Key Insights from Constitution v1.2.0 Cycle (2026-05-08 → 2026-05-09)

**Cross-Provider Critique Effectiveness:** Borg Queen (gpt-5.4) performed 4 verification passes on the v1.2.0 amendment cycle, finding structural claims that same-provider reviewers would likely rationalize internally. Key finding: claim-by-claim verification against live repo code (not just the diff) is the distinguishing factor between hollow governance and real governance.

**Ratification Outcome:** v1.2.0 ratified with Known Tensions (Path D acceptance). 3 known defects acknowledged in Known Tensions section (Principle III auth/me failure taxonomy, Principle VII .github/ scan path, redeem/refresh concurrency lock) scheduled for v1.3.0 resolution.

**Reviewer-Lockout Pattern:** Cycle-scoped lockout (applies to all authors) resets for v1.3.0. Recommended approach: Same cross-provider critic (Borg Queen) for consistency in future cycles.

**Core Learning:** Critique framing matters. "Did this amendment defuse my concerns?" is weaker than "Does every concrete claim match the repository?" The latter catches inherited baseline text overclaiming and structural lies that delta-focused review misses.

### 001-discord-monitor Plan Hostile Fact-Check (2026-05-13)

**Claim-types most often wrong in this codebase:**

1. **Enumeration counts.** The plan claimed "42 codes" when the file has 30. Counting errors are endemic in prose that describes file contents — always re-count programmatically.
2. **Cron cadence descriptions.** The plan said "same 4-hour cron" but redeem.yml runs hourly. Cron expressions are misread or mis-remembered more often than any other CI detail.
3. **Install size estimates.** npm unpacked sizes are routinely understated because transitive deps are forgotten. Always sum the full dep tree.
4. **Regex boundary coverage.** Edge-case codes (3-char `TNG`) escape length-bounded regexes. Always run the regex against the actual file, not a mental model of its contents.

**Verification techniques that worked:**

- `grep -P` with the exact proposed regex against the live file — caught TNG miss instantly.
- `npm view <pkg> dist.unpackedSize` for every transitive dep — caught the 2× size undercount.
- `wc -l` / `awk` count against the real file — caught the 42→30 overcount.
- Literal string comparison of `concurrency.group` across workflow files — confirmed match.
- Reading the actual function signature in `src/lib/promoCodes.ts` — caught `loadPromoCodes` vs `readPromoCodes` name mismatch.

### 001-discord-monitor Plan Round-2 Fact-Check (2026-05-13)

**Which corrections held cleanly vs. which need correction-of-correction:**

- 7 of 8 round-1 corrections verified clean on first pass. The P1-6 function-name cascade (loadPromoCodes → readCodesForRun) was the most complex multi-file correction and propagated perfectly — zero stale references remain. The P1-5 count fix ("six" → "seven") also propagated cleanly to all 3 locations.
- 1 partial: P1-7 (git pull --rebase) was correctly added but the adjacent `git push` line was not brought into alignment with redeem.yml's explicit refspec pattern. Surgical edits to a multi-line shell block need to consider both the target line AND its neighbors.

**Cascade verification pattern after surgical edits:**

When a factual claim is corrected (e.g., "42 codes" → "30 codes"), every *derived* statistic and every *downstream consumer* of that claim must also be updated. Round 2 found two cascades that were missed:
1. **Derived statistics:** Correcting the code count (42→30) without recomputing the derived rate (count/months) left a stale "~3.5/month" where the correct value is ~2.5/month. Rule: after changing any numerator or denominator, grep for every expression that uses either.
2. **Test assertions:** Acknowledging a regex gap (TNG/GQ5/GQ7 don't match) without updating the test strategy row that claims "every code is matched" creates a contradiction. Rule: after narrowing any coverage claim, grep for the old universal claim ("every", "all") and qualify it.

The takeaway for future rounds: after verifying each correction landed, run a second pass asking "what else in the document depends on the old value?" — not just the corrected line, but any prose, formula, test description, or cross-reference that consumed the old claim.

### 001-discord-monitor Round-3 Fact-Check (2026-05-13)

**Derivative artifact inheritance pattern:** When a new artifact (tasks.md) is generated from a corrected parent (plan.md), verify that (a) corrections propagated into the derivative, and (b) stale claims that survived in the parent did NOT propagate. In this round, the 3-char gap correction propagated cleanly into tasks.md T013 — the generator correctly picked up the corrected plan.md:377. However, the stale `~3.5/month` rate (plan.md:356) was harmlessly omitted from tasks.md because tasks.md doesn't reference the rate. The bare `git push` (plan.md:317, P1-NEW-3) DID propagate into tasks.md:373. Rule: after any derivative is generated, grep for every open P1 finding from the parent and check whether it was inherited, fixed, or omitted.

**Line-number citations drift:** tasks.md cited `redeem.yml:31` for the concurrency group when the actual line is :28. File-line citations in generated artifacts should be treated as hints, not contracts — they drift as the source file is edited. Test assertions should match on VALUE, not on line number (tasks.md correctly does this).

### Post-Ratification Backlog (v1.3.0)

- **Known Tension 1:** Principle III overstates which per-account `auth/me` failures stay non-fatal.
- **Known Tension 2:** Principle VII/Security overclaim `.github/` scan coverage in PRs vs. workflow trigger scope.
- **Known Tension 3:** Redeem/refresh concurrency lock is un-principled (enforced via shared `concurrency.group` but not stated in any principle).

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work
