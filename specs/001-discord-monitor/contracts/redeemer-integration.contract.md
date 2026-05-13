# Contract: Redeemer Integration Seam

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13

This contract defines exactly how Discord-sourced candidate codes flow into
the **existing** redemption pipeline without modifying the redeemer's public
contract or the STFC API client. Per FR-010 and Principle II, the monitor
MUST NOT call the STFC API directly.

## Existing surface (untouched)

- `src/skills/redeemCodes.ts` — current `redeem-codes` skill that loads
  codes from `promo-codes.txt`, iterates accounts, and returns
  `{ result, exitCode }`.
- `src/lib/promoCodes.ts` — current loader that reads `promo-codes.txt`,
  strips comments, dedupes, returns `string[]`.
- `src/api/client.ts`, `src/api/endpoints.ts` — STFC API surface. UNCHANGED.
- `src/lib/outcomes.ts` — outcome taxonomy. UNCHANGED. The new code MUST
  re-use the existing keys (`CODE_ALREADY_USED`, `CODE_INVALID_OR_EXPIRED`,
  `TRANSIENT`, `UNKNOWN_RESULT`, success). FR-011 explicitly forbids new
  outcome categories.

## New seam (the only addition to the existing redeemer surface)

Add ONE new function to `src/lib/promoCodes.ts`:

```ts
/**
 * Returns the list of codes the redeemer should attempt this run.
 * Combines (a) the static promo-codes.txt contents (read via the existing
 * `readPromoCodes(path)` + `parsePromoCodes(content)` pipeline) and (b) any
 * caller-supplied additional candidates, deduplicated, in deterministic
 * order (file first, then candidates in insertion order, dedup by string
 * equality after trim+uppercase normalization).
 *
 * Existing callers that invoke `readPromoCodes(path)` directly continue to
 * work unchanged.
 */
export async function readCodesForRun(opts?: {
  extraCandidates?: string[];
}): Promise<string[]>;
```

The existing `readPromoCodes(path)` and `parsePromoCodes(content)` keep their
signatures unchanged; `readCodesForRun` wraps them. Redeemer tests for the
direct `readPromoCodes` path remain unchanged.

## Caller contract (the new `discord-monitor` skill)

The new skill follows this sequence per run:

```ts
// pseudo-code; lives in src/skills/discordMonitor.ts
const ingested = await ingestDiscord(allowlist, cursors);
const candidates = extractCodes(ingested);              // CandidateCode[]
const fresh = dedupAndFilter(candidates, suppression, existingPromoCodesTxt);

if (fresh.length === 0) {
  // No new work for the redeemer; still write digest + advance cursors.
} else {
  // Hand off to the existing skill via direct in-process invocation.
  // The skill is imported and called as a function — NOT spawned as a
  // subprocess and NOT routed through src/cli.ts (which would call
  // process.exit). This preserves Principle II's exit-code contract.
  const { result } = await redeemCodes({
    extraCandidates: fresh.map(c => c.value),
  });
  recordPerAccountOutcomes(fresh, result);              // updates candidates.jsonl
}

const successful = fresh.filter(c => c.status === "redeemed");
if (successful.length > 0) {
  await appendToPromoCodesTxt(successful.slice(0, PER_RUN_CAP)); // R5
  await commitAndPush();                                          // workflow step
}

await writeDigest({ codes, tips, health });
await persistCursors(newCursors);
```

Where `redeemCodes(opts)` is the callable export from
`src/skills/redeemCodes.ts`, which today returns `{ result, exitCode }` per
the Principle II skill contract. **Required minor refactor:** `redeemCodes`
must accept an optional `{ extraCandidates?: string[] }` arg and pass it
through to `readCodesForRun(opts)`. That is the entire change to the
existing skill — its return shape, exit code semantics, summary writing,
and per-account error handling are unchanged.

## What the seam DOES NOT do

- Does NOT bypass `src/api/client.ts`. (Discord client traffic does not
  touch the STFC API.)
- Does NOT introduce a parallel redeem path. There is exactly one redeem
  call site per run.
- Does NOT mutate `promo-codes.txt` before redemption. Append happens only
  on a successful upstream `REDEEMED` outcome (FR-014 + R5).
- Does NOT re-classify outcomes. The existing `src/lib/outcomes.ts` keys
  are reused verbatim (FR-011).

## Exit-code propagation (Principle II)

The new `discord-monitor` skill returns `{ result, exitCode }` like every
other skill. Mapping:

| Condition                                                    | exitCode |
|--------------------------------------------------------------|----------|
| Successful run (any mix of monitor outcomes, including 0 candidates) | 0 |
| Discord auth failed but redeem succeeded on existing codes   | 0 (FR-012; auth failure surfaced in digest health, not workflow status) |
| Discord auth succeeded but redeemer raised infrastructure error | 1 (inherited from redeemCodes' return) |
| Classifier integrity / load failure                          | 1 |
| Allowlist file malformed                                     | 1 (treated as configuration error) |
| Allowlist file present but empty                             | 0 (FR-001; no-op the Discord half, still write digest) |

`src/cli.ts` is the only file in `src/` that calls `process.exit`; the
new skill MUST NOT call it directly.

## Test seam

`tests/skills/discordMonitor.test.ts` will use the existing fixture pattern
(stub `ApiClient`, stub Discord REST client) and assert:
- `redeemCodes({ extraCandidates: [...] })` is called with the deduped
  candidate list (zero spy calls if `fresh.length === 0`).
- `appendToPromoCodesTxt` is invoked only with codes whose outcome is
  `REDEEMED`.
- The per-run cap truncates the append list (not the redeem list).
