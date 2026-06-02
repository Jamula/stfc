## Session 2026-06-02 — Discord slash epic #143 shipped

Parallel fleet delivered 6 PRs (commands.json, register workflow, Worker bridge, handler workflow, deploy, runbook). 4 reviewer-lockout cycles (Garak blockers → Scotty fixes). Epic fully operational.

# Kirk — Code Review History

Recent decisions from this session. Full history archived in `history-archive.md`.

## 2026-06-02 — PR #141 re-review (cleanup-old-runs workflow)

**Verdict:** APPROVE ✅ on `1068c1c`. All three blockers (B1 counter-abort, B2 subshell-counter-loss, B3 fake-backoff) addressed. Input validation, 404 idempotency, self-decap guard, permissions, status filter all clean. CI all-green. No Rule 3 pin needed (dispatch-only workflow).

### Learnings (bash-hygiene patterns reusable across workflows)

- **`set -e` + `((x++))` from 0 is a foot-gun**: `((0++))` returns exit 1 because the pre-increment value is 0. Always use `x=$((x + 1))` for counters under `set -e`. Trivial to verify with `grep -nE '\(\(\w+\+\+\)\)' .github/workflows/*.yml`.
- **Pipe-to-while in bash spawns a subshell** — every counter mutated inside the loop is lost when the pipe closes. Process substitution `done < <(cmd)` keeps the loop in the parent shell. Pattern to look for: `cmd | while read x; do counter=...`.
- **"Backoff" needs evidence of actual backoff** — a modulo on accumulated failure count (e.g. `if (( fail % 10 == 0 )); then sleep`) is a *circuit-breaker pulse*, not backoff. Acceptable minimum: one `sleep N` + single retry on every non-zero, classify the retry's stderr.
- **Workflow-pin Rule 3 only applies to scheduled/concurrency-bearing workflows.** Pure `workflow_dispatch` with no cron/concurrency/literal-secret-name doesn't need a pin test — confirmed via `grep -rn '<file>' tests/`.

## 2026-06-02 — PR #96 review (discord-channel stub + ingest script)

**Verdict:** APPROVE ✅ — https://github.com/Jamula/stfc/pull/96#issuecomment-4598333241

**Scope:** 4 files, +441 LOC, all docs + one offline ingest script. Picard un-drafted as Option C ship-prep on an external blocker (bot not in guild `639255937869152267`).

**What I verified:**
- `scripts/fetch-discord-channel.mjs` — token read from env, never echoed, JWT-regex redaction in FATAL handler. Pins-first then paginated history with `before=` cursor + 500 ms polite delay. 429→retry-after→single recursive retry. 401/403 produce actionable messages including invite URL template. Lineage block generated from constants. Read-only (no POST/PATCH/DELETE codepath). Idempotent (only overwrites its own two output files).
- Permission bitmask **66560 = 1024 + 65536** (VIEW_CHANNEL + READ_MESSAGE_HISTORY) verified numerically.
- Six-field Lineage block in channel stub matches convention.
- Rule 3 N/A (no workflow YAML); Rule 16 satisfied (script docs in header + 2 READMEs).
- `npm test`: 567/567 pass on `cae7efe`.

**One non-blocking observation (logged in PR comment):** repo convention for ingest-script exit codes is `0/1/2`. Currently 401 and 403 both exit 1. A future revision could split 403/5xx → exit 2 for cleaner CI signaling.

### Learnings (reusable for reviewing data-ingest scripts)

- **Token-leak defensive regex in the FATAL handler** (matches JWT-shaped `[\w-]{20,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{10,}`) is a cheap belt-and-suspenders pattern. Look for it in every script that handles `*_TOKEN`/`*_SECRET` env vars — error-bubbling via `err.message` can leak the raw token if a fetch implementation includes the Authorization header in its error text.
- **Permission-bitmask verification is fast** — `node -e "console.log(1024+65536)"`. Always cross-check the bitmask against the README's stated permission names; a wrong bitmask silently over-permissions a bot.
- **Idempotency check for ingest scripts** = grep for every `writeFile`/`mkdir` call and confirm each target is either (a) one of the script's own managed files, or (b) created with `{recursive: true}`. Anything writing to a hand-maintained file (like the channel `README.md` stub) is a footgun — confirm those are `console.log` advisories not actual writes.
- **"Defensible no-test" criteria for one-shot scripts:** (1) script is non-runtime, (2) main dependency is a live API the test environment can't reach, (3) script will be re-touched the moment it's actually used (forcing a test-add at that point). All three apply to #96 — no test gate today.
- **`Closes #N` per-line still applies even for single-issue PRs** — PR #96 has `Closes #76` on its own line. Confirmed Rule 6a compliant; no comma-list hazard.

## Re-review pattern for fix commits

**Date:** 2026-06-02T03:03:50Z

When reviewing a fix commit to CHANGES_REQUESTED blockers, structurally verify each blocker is addressed:

1. Link each blocker to the commit diff (make the fix visible in the verdict).
2. Verify non-blocking items from the original review are also addressed (signals thoroughness + builds confidence).
3. Confirm CI status (all-green = merge-safe).
4. Rule 3 pin: dispatch-only workflows don't need cron/concurrency pins; only code-path workflows need pinning.

This pattern distinguishes a "re-review pass" from a "spot-check" and elevates confidence in fix commits that touch multiple reviewers' feedback threads.

— Scribe (logged from orchestration)

## 2026-06-02 — Discord slash command architecture (Option B) scoping

**Decision context:** Cyrus chose Option B (Cloudflare Workers bridge) from Uhura's three options. Decision inbox: `.squad/decisions/inbox/copilot-discord-slash-arch-option-b.md`. Full arch note: `.squad/decisions/inbox/kirk-discord-slash-arch.md`.

**Filed epic + 6 child issues:** #143 (epic), #144 (commands.json), #145 (register workflow), #146 (Worker), #147 (handler workflow), #148 (deploy workflow), #149 (operator runbook). Dependencies mapped in epic body.

### Learnings (reusable architectural patterns)

- **Discord interactions bridge pattern (3-tier):** thin signature-verifier (Worker) → message bus (`repository_dispatch`) → business logic (existing GHA). Keeps all secrets/logic in their natural homes. Worker is ~100 LoC and stateless — easy to revert. Same pattern works for Slack, Microsoft Teams, any webhook-based chat platform that requires <3s ack.
- **The 3-second Discord timeout is a hard architectural constraint.** Any work that takes >3s MUST respond `type:5` (deferred) and post follow-up later. This rules out doing the work inline anywhere in the Worker's request lifecycle. `ctx.waitUntil()` in Workers extends execution past response but does NOT extend the response deadline — defer FIRST, then dispatch.
- **GH dispatch token scoping principle:** the token that can fire `repository_dispatch` is effectively a remote-trigger capability for every workflow listening on `repository_dispatch`. Even with one `event_type`, a leaked token lets an attacker re-fire arbitrary `client_payload`. Mitigation hierarchy: (1) fine-grained PAT, single repo, single permission; (2) handler workflow validates `client_payload.command` against an allow-list; (3) quarterly rotation. Coarse-grained `repo` PATs are a security regression vs. the existing CI surface — refuse them.
- **Interaction token 15-min expiry** is a separate, longer deadline from the 3s ack. Long-running GHA workflows can race it. Pattern: the handler workflow's FIRST follow-up should be "Started, results at <run URL>" within the first minute, so the user gets a working link even if the final results follow-up is too late. Cross-reference: Rule 6a (PR shipping) — both are about "make the slow path observable, don't black-hole it."
- **Single-source-of-truth pattern for command definitions** (`discord/commands.json`): two consumers (registration workflow + handler workflow) read the SAME file. Prevents drift where the registered command shape diverges from the handler's expected `client_payload`. Validator script (`scripts/validate-discord-commands.mjs`) enforces schema at commit time.
- **Stored memory hit:** existing `concurrency.group: stfc-gift-redeemer` (per `tests/skills/discordMonitor.test.ts` pin) already serializes redeem runs. Don't duplicate that — handler workflow uses its OWN group `stfc-discord-handler` because handler work is broader than redeem. `gh workflow run redeem.yml` from the handler picks up the existing serialization automatically.

## 2026-06-02T03:55Z — PR #151 review (Cloudflare Worker Discord bridge)

Reviewed Uhura's implementation of the arch I dispatched in `kirk-discord-slash-arch`. APPROVE with Garak co-review flagged per routing carve-out.

### Learnings — review patterns for serverless signature-verifying bridges

- **The "before any side effect" rule.** For any HTTP handler that gates on a crypto signature, the FIRST thing a reviewer reads is whether the signature check returns `401` *before* the handler invokes any side-effecting fetch/queue/db call. Read the control flow top-to-bottom and confirm the early return is unconditional. In PR #151 the order was: method → headers present → timestamp window → `await ed.verifyAsync` → only THEN `ctx.waitUntil(dispatch)`. Clean.
- **Trust the tests to prove ordering.** Best signal that ordering is right: the bad-signature tests do NOT mock `fetch`. If the dispatch fired on a bad sig, the test would actually try to hit `api.github.com` and either explode in CI or leak. Absence of a fetch mock in negative-path tests is itself a passive assertion.

### Learnings — `ctx.waitUntil` vs sync-await trap

- The Cloudflare Workers `ctx.waitUntil(promise)` pattern is the ONLY correct way to "respond fast, work async" inside the same handler. Writing `await dispatch(); return Response.json({type:5})` is a silent bug: the response is correct but arrives after the dispatch resolves, which can blow past Discord's 3-second window when GH API is slow.
- Reviewer heuristic: grep the handler for `await` between the response construction and the return. Any await on an outbound fetch that isn't wrapped in `ctx.waitUntil` is suspect. In PR #151, the only `await` between sig-verify and the type:5 return was `req.text()` (local) and `ed.verifyAsync` (local crypto, fast). No outbound await. ✓
- **Test pattern:** the APPLICATION_COMMAND test asserts (a) response status + body first, (b) `ctx.waitUntil` was called once, (c) then *manually settles* `ctx.waitUntil.mock.calls[0][0]` to drive the dispatch and assert payload. This is the right structural test for the pattern.

### Learnings — hex-to-bytes pitfalls

- The `hexToBytes` helper in PR #151 throws `RangeError` on odd-length input. Uncaught at handler level → Workers runtime returns generic 500 instead of 401. Not a security bypass (the malformed sig would fail verify anyway) but a noisier response signature for attackers and an avoidable 500 in logs.
- `parseInt(slice, 16)` on non-hex chars returns `NaN`, which `Uint8Array` coerces to `0` — silently produces invalid bytes that fail verify cleanly. So malformed-hex-chars is fine, odd-length isn't.
- **Reviewer checklist for any hex parser in a security path:** (a) odd length, (b) non-hex chars, (c) leading/trailing whitespace, (d) `0x` prefix, (e) uppercase. Wrap the whole thing in try/catch → 401 to make all failures look identical to attackers.

### Learnings — Discord 3-second timeout discipline

- Discord's interactions endpoint has a hard 3-second deadline for the FIRST response. After that the interaction is dead — no follow-up message can recover it because the interaction token is rejected.
- type:5 (DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) is the escape hatch: respond fast with "thinking..." and have the actual work send a follow-up to `PATCH /webhooks/{app_id}/{token}/messages/@original` within 15 minutes.
- The discipline this enforces on the architecture: the Worker MUST NOT do any I/O that could exceed ~2s in the synchronous path. Sig verify is local (fast). PING is a constant return. The GH dispatch goes to `ctx.waitUntil`. Anything else (e.g. fetching user info from Discord, looking up state from KV) would have to also go async or be inlined into the GH Actions handler.
- Reviewer red flag: any synchronous `await` on a network call in the request handler is a 3-second-timeout risk waiting to fire under upstream slowness.

## 2026-06-02T04:38Z — PR #155 re-verify (operator runbook fix commit `17702fc`)

**Verdict:** APPROVE ✅ — https://github.com/Jamula/stfc/pull/155#issuecomment-4598761402

All 5 findings from prior CHANGES_REQUESTED verified addressed. **Final piece of epic #143** — Discord slash command pipeline complete (#144–#149 all merged or merging).

### Re-verify checklist for docs PRs (reusable)

When re-reviewing a docs-only fix commit after CHANGES_REQUESTED, run this batch in one shot:

1. `git show <sha> --stat` — confirm scope is docs-only, no surprise files.
2. **For each blocker, run a targeted grep that would fail loudly if the fix is incomplete:**
   - PAT scope: `grep -n "Contents.*[Ww]rite\|Actions.*[Ww]rite" <docs>` — pattern matches the BAD form too, so you SEE if it's still there.
   - Missing prereq: positive grep for the tool's install/auth commands (`grep -n "npx wrangler\|npm install.*wrangler"`).
   - Typos: literal grep for the typo (must return zero matches).
   - Broken relative links: `ls -la <target-path>` + `grep -n "^## <section>" <target>` to prove the anchor exists.
3. `npm test` — even for docs-only, the pre-commit gate must pass (proves the docs change didn't accidentally touch a code-path file).
4. `gh pr checks <N>` — all required checks green.
5. `gh pr view <N> --json body --jq .body | grep -E "Closes #|## Tests"` — Rule 6a (per-line `Closes`) + Rule 15 (`## Tests` heading present, even if "no test changes — docs only").
6. Post verdict via `gh pr comment` (Rule 9b — single-maintainer repo).

**Key insight:** the BAD-form grep is the highest-signal check. A grep like `grep "Actions: Read and write"` returning ZERO matches proves the bad string is gone better than reading the file. Always include the negative case in the grep pattern.

### Epic completion note

Epic #143 (Discord slash command infrastructure, Option B / Cloudflare Workers bridge) shipped in 6 child PRs over ~8h on 2026-06-02:
- #144 (commands.json) → #145 (register workflow) → #146/#151 (Worker) → #147 (handler workflow) → #148 (deploy workflow) → #149/#155 (operator runbook).

End-to-end flow now operational once Cyrus sets the live secrets and saves the Interactions Endpoint URL in the Discord Developer Portal. Runbook is the user-facing artifact that closes the loop.
