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

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

### 2026-05-18T02:46Z: PR #71 hostile fact-check (Constitution v1.4.0 → v1.5.0 scripts/discord-ops/ carve-out)

**Verdict:** APPROVE ✅ with 2× MEDIUM, 2× LOW, 1× NIT findings (all non-blocking, all pinning-test-scope issues to be addressed by Bashir if Picard wants v1.5.1 polish).

**Methodology that worked here:**

1. **Map every MUST-language obligation in the amendment to its pinning test.** Tuvok's carve-out introduces four MUST obligations (path scope, redaction, invocation surface, workflow pinning). Bashir's `tests/constitution/discord-ops-carveout.test.ts` covers 3/4 — the endpoint-scope narrowing (`/users/@me` + `/applications/@me` only) is NOT literally pinned. Adding "for each MUST in the amendment, grep `tests/` for a literal-value assertion" to the standard attack list catches this whole class.

2. **Verify "narrowing" claims by reading the positive enumeration, not the negation.** Tuvok's deviation #3 (explicit non-grant for message writes) is phrased narrowly ("monitored servers or channels") but the positive endpoint enumeration ("only the two endpoints named here") closes the loophole by construction. Reviewing the negation alone would have flagged a false positive; reviewing both halves is what gave the clean read.

3. **Cross-check static-separation claims against tsconfig.** The carve-out claims "ops scripts live outside `src/` so the type-check, the test suite, and any future static audit can distinguish them from the monitor runtime by path alone." Verified via tsconfig.json `include`: it's an allowlist (`src/{cli,api,discord,lib,skills,telemetry}` + `tests/**`), so `scripts/` is excluded by construction, not by exclusion list. The claim holds. Future reviews: never trust a "live outside X" claim without checking `include`/`exclude`/`paths` in the build config.

4. **Workflow secret-scope audit by step.** For any new workflow that carries a secret, walk every step and confirm the secret-bearing env is scoped to ONLY the step that needs it. `discord-ops.yml` correctly maps DISCORD_BOT_TOKEN only to the "Run metadata setter" step (line 98) — not at workflow level, not at job level, not on checkout/setup-node/install/validate/download. Existing repo pattern (refresh-token.yml, redeem.yml) follows the same discipline.

**New attack-list category to standardize for future constitution-amendment reviews:**

- **Pinning-test scope check.** Every MUST-language obligation the amendment adds should map to a literal-value assertion in a `tests/` file. The amendment's SIR should be cross-referenced against `tests/constitution/**` and `tests/workflows/**` to confirm coverage of each new MUST. Missing pinning is a MEDIUM finding (regression risk on degenerate future edits), not a BLOCKER (the amendment itself is correct).

**What I would have flagged but didn't, because the evidence didn't support it:**

- I considered flagging "endpoint narrowing locks out future bot tags / install_params writes" as a HIGH but verified those go through `/applications/@me` PATCH (already authorized). Discord's REST API model puts most application-level metadata under `/applications/@me`, so the narrowing actually locks out only `/channels/*`, `/guilds/*`, `/applications/{id}/emojis`, and similar — which is the intended bound. Conclusion stayed at "deviation defensible."

- I considered flagging path traversal exploit (`scripts/discord-ops/../foo/`) on the "lives outside src/" widening, but the operative path constraint is the specific `scripts/discord-ops/` prefix (first sentence of the subsection), not the looser "outside src/" justification. Traversal isn't a real risk because the constraint is checked by reviewer-eyes-on-PR, not by runtime path resolution.

**Cross-provider critique value:** Running on `gpt-5.5` gave a clean read on whether each narrowing actually closes the loophole it was sold as closing — not just trusting Tuvok's "I narrowed it on purpose" framing. Same-provider review might have rubber-stamped all four deviations as obviously-good without verifying each one's mechanism.


## 2026-05-31 — Spec + Constitution v1.6.0 + Data Layer Fact-Check

Garak's role: hostile fact-check on both PR #97 (spec claims) and PR #98 (contract enforcement).

**PR #97:** Approved. Verified Discord/OCR realism (message-text only, OCR deferred to v1.5), HuggingFace dependency in tree, pure-compute constraint on v1, Rule 1 grep hit, issue/scope gates. All claims hold; SemVer correct. Non-blocking board note: issue #86 title outdated.

**PR #98 (round 1):** CHANGES_REQUESTED. Three contract violations found:
1. Roster filename/account mismatch: `example.yaml` with `account: demo` violates `{account}.yaml` contract.
2. Byte-stable round-trip false: serializer sorts/reorders vs source.
3. Live roster data in CLI test: unclear if intentional real-data validation or test-style mistake.

Recommended Bashir (test/contract expert) not Scotty (per reviewer-lockout).

**PR #98 (round 2):** Approved after revision 277f7023. All three findings resolved: file renamed, round-trip canonicalized + tested, real-data exception documented.

**Lesson:** Contract enforcement gates data-layer stability. The three violations were inter-related (filename→account→serialization invariants). Kirk's architecture review missed these because they're not architectural—they're data-contract and test-contract bugs. Garak's role as fact-checker is essential on data-driven features.
