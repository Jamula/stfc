### 2026-05-18T02:46:00Z: Garak hostile fact-check — PR #71 (Constitution v1.4.0 → v1.5.0 + scripts/discord-ops/ carve-out)

**Verdict:** **APPROVE** ✅ — posted as PR comment
https://github.com/Jamula/stfc/pull/71#issuecomment-4473826038

**Branch reviewed:** `discord-ops-automation` @ `87a8ef6` (constitution +
plan-template sync) on top of `226ce7b` (script) on top of `6ea61c8`
(workflow).

**Summary of attack list (per Coordinator's dispatch prompt):**

| Attack vector | Outcome |
|---|---|
| Four deviations from override directive (endpoint narrowing / "outside src/" widening / explicit non-grant / workflow-pinning obligation) | All four defensible. Narrowing to `/users/@me` + `/applications/@me` is sufficient for foreseeable bot identity + application-metadata writes; "outside src/" claim is enforced by `tsconfig.json` include allowlist (not just claimed); non-grant clause is narrowly phrased but positive endpoint enumeration closes the loophole; workflow-pinning written as MUST + enforced by pre-commit `checkWorkflowPinningTests`. |
| Cross-reference integrity (FR-009 / FR-012 / spec path) | ✓ Both FR-009 and FR-012 resolve to `specs/003-discord-oauth/spec.md:78`/`:81`; the carve-out citation (":407") is correct. SIR / version footer / Last Amended are consistent (1.5.0 / 2026-05-18). |
| Plan-template sync sufficiency (Rule 1 canonical grep) | ✓ Plan-template row contains all required tokens (scripts/discord-ops/, discord.com/api/v10, DISCORD_BOT_TOKEN, users/@me, applications/@me, FR-012). Full inline sentence, not a comment. |
| Script obeys promised constraints (lives outside src/, no runtime imports, redacts token) | ✓ Verified `grep -rn "scripts/discord-ops" src/` → 0 hits. Every `runCli` error path routes through `redactString(..., token)`. `discordPatch` wraps both fetch-transport and !res.ok branches. |
| Workflow leaks token? | ✓ No `set -x`. `DISCORD_BOT_TOKEN` env scoped only to "Run metadata setter" step. Checkout/setup-node/install/validate/download steps cannot see the token. Inputs passed via env, not shell interpolation. |
| Test guarantees vs degenerate stubs | ✓ Workflow-pin test catches sneaky `schedule:` triggers (carves out `on:` block, asserts doesNotMatch). SHA-pin assertion catches version-tag drift. |
| `npm test` baseline | ✓ 557/557 pass on the branch head. |

**Findings posted publicly** (full text in PR comment):

- [MEDIUM] Constitution-pin test does not pin Tuvok's deviation #1
  (endpoint narrowing to `/users/@me` + `/applications/@me`).
- [MEDIUM] Workflow-pin test does not pin
  `concurrency.group: stfc-discord-ops` (asymmetric with existing repo
  convention at `tests/skills/discordMonitor.test.ts:503`).
- [LOW] Non-grant clause says "monitored servers or channels"; positive
  endpoint enumeration closes the loophole but tightening to "any
  channel" would make the prohibition stand on its own.
- [LOW] Last-ditch redactor at `set-discord-app-metadata.mjs:541` lacks
  the `token` arg (token is locally scoped to `runCli`). Discord bot
  tokens are not JWT-shaped, so `JWT_RE` won't catch a bare token
  escaping the fallback path; in practice all known escape paths are
  closed by the in-runCli redactors.
- [NIT] Constitution-pin test "names a write verb" assertion passes if
  ANY of PATCH/PUT/POST appears; degenerate amendment authorizing only
  POST would still pass.

**Side-channel notes (not in the public comment):**

1. **Routing on hypothetical CHANGES_REQUESTED:** per the protocol the
   Coordinator MUST NOT route revisions back to Tuvok. The MEDIUM
   findings (pinning gaps) are Bashir's charter, not Tuvok's; the
   constitution wording itself is sound. Reassign to **Bashir** for the
   pinning-test tightening if/when Picard wants v1.5.1 polish.

2. **Pattern to add to the "standard attack list" for future constitution
   amendment reviews:**
   - **Pinning-test scope check:** every MUST-language obligation the
     amendment adds should map to a literal-value assertion in a
     `tests/` file. Tuvok's amendment introduces FOUR new obligations
     (path scope, redaction, invocation surface, workflow pinning); the
     constitution-pin test covers 3/4 directly but the endpoint scope
     itself is not literally pinned. Future amendments: enumerate the
     amendment's MUST-clauses, then grep for each in `tests/`.

3. **Cross-provider critique note:** running this review as Garak (model
   defaults to `gpt-5.5` per `.squad/config.json`) gave a clean read on
   the deviation tradeoffs. The four deviations are exactly the kind of
   "narrower-than-asked-for" tightening that an in-family reviewer might
   wave through as obviously-good; the value of the cross-provider
   review here is that I checked whether each narrowing actually CLOSES
   the loophole it was sold as closing (endpoint scope, src/ widening,
   non-grant clause, workflow obligation) rather than just trusting the
   "I narrowed it on purpose" justification. All four hold up.

4. **Carry-forward for Picard's review:** Picard's earlier (c) Decline
   verdict centered on the read-only invariant on monitored channels.
   The carve-out preserves that invariant (verified — FR-009 cross-ref
   is correct + monitor runtime is byte-identical to v1.4.0). Picard
   has no factual basis to re-Decline; the override directive's scope
   is fully reflected in the amendment. Whether Picard wants stricter
   prose (e.g., the [LOW] "monitored" clause tightening) is governance
   judgment, not fact-check.

5. **Reviewer chain status (per Rule 7):** Garak APPROVE + (pending)
   Kirk + (pending) Picard + green CI gate the merge. Constitution
   amendments are noted in `.github/copilot-instructions.md` Rule 7 as
   a possible "governance carve-out (optional)" requiring explicit
   human ack — Cyrus has not stated this preference for this repo,
   default is auto-merge once all three reviewers are green.

---
**Audit trail:**
- PR: https://github.com/Jamula/stfc/pull/71
- Comment: https://github.com/Jamula/stfc/pull/71#issuecomment-4473826038
- Tuvok memo: `.squad/decisions/inbox/tuvok-constitution-v1.5.0.md`
- Override directive: `.squad/decisions/inbox/copilot-directive-override-picard-discord-avatar-(a).md`
- Original Picard (c): `.squad/decisions/inbox/picard-discord-avatar-automation-scope.md`
