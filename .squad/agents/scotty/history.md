# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — npm test Enforcement Gate (2026-05-08)

**Implementation completed:** Built `npm test` CI enforcement gate to operationalize Principle IX (tests are not optional; `npm test` MUST pass before any commit).

**Trigger and Scope:**
- Workflow: `.github/workflows/squad-test-enforcement.yml`
- Triggered on: All pull requests touching `src/`, `tests/`, package.json, or tsconfig.json
- Enforcement: PR cannot merge until all tests pass in CI

**Coordination with Bashir:** Bashir's reviewer gates (spec review, tasks review, implementation review) complement this CI gate. Tests must exist (Bashir's gates) AND pass (Scotty's CI gate).

**Design Pragmatism:** "Trigger Threshold" (speckit for >4-hour work, multi-file changes, architectural decisions) calibrated to maintenance-heavy project. Exemptions cover 70–80% of actual PR mix (bumps, single-file fixes, docs).

**Post-Ratification Commitment:** Pre-commit hook optional but recommended (Bashir to advise if simple-git-hooks or husky are preferred).

**Status:** Deployed and operational. npm test is gated at both code-review and CI layers.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

### 2026-05-18T02:29:30Z — Discord ops script (`set-discord-app-metadata.mjs`)

Built `scripts/discord-ops/set-discord-app-metadata.mjs` per the (a)-override
directive. Operator-only one-shot for bot avatar / username / application
description; not reachable from `src/` runtime (FR-009 preserved). Pushed on
branch `discord-ops-automation`, all 557 tests green including Bashir's 9
script tests + 5 constitution carve-out pinning tests.

## Learnings

* **Discord app metadata endpoint split.** Bot username + avatar live on
  `PATCH /users/@me`; application description lives on `PATCH /applications/@me`.
  These are two distinct resources — bot identity vs. application identity —
  and the same script needs to hit both when the operator wants to update
  multiple fields at once. Merging avatar + username into one /users/@me
  call is correct (Discord accepts partial bodies); merging anything across
  the resources is not.
* **Avatar payload is a data URI, not multipart.** The `avatar` field on
  `PATCH /users/@me` takes a base64 data URI string
  (`data:image/png;base64,…`). No multipart/form-data, no file upload —
  the whole image rides inline in the JSON body. 10 MB Discord hard cap
  on the encoded body. Magic-byte MIME detection is mandatory because
  Discord rejects mismatched declared MIME vs. content.
* **Image dimension probing without a library.** PNG: IHDR chunk starts at
  byte 8; width is BE u32 at byte 16, height at byte 20. GIF: Logical
  Screen Descriptor — width LE u16 @6, height LE u16 @8. JPEG: walk
  markers from byte 2, skip fill 0xFFs, stop on SOF (0xC0–0xCF except
  C4/C8/CC); height is BE u16 at marker+3, width at marker+5. Roughly
  ~40 lines of Node Buffer reads, no deps. Good enough for a soft floor
  warning; not a substitute for sharp/image-size in a real pipeline.
* **Redaction pattern from `src/lib/redact.ts`.** Inlined rather than
  imported to keep FR-009 clean. Two regexes + literal-token substitution:
  (1) `(authorization\s*"?\s*[:=]\s*"?)(Bot|Bearer)?<value>` for header
  forms, (2) `\b<64+chars>\.<8+>\.<8+>\b` JWT shape. The literal-token
  pass (with regex-escaped substitution) is the belt-and-suspenders that
  catches anything the structural passes miss — Bashir's sentinel-token
  test specifically verifies this.
* **Tiny arg parser pattern.** ~25 lines of switch/case over argv with
  `argv[++i]` for value-bearing flags. No yargs, no commander. Last-wins
  on repeated flags is the right default for workflow_dispatch wrappers
  that pass optional inputs as either populated or empty.
* **Testability via injection.** Exporting `runCli({ argv, env, fetchImpl,
  stdout, stderr })` plus an `import.meta.url === file://argv[1]` guard
  is the cleanest way to make an `.mjs` script both directly executable
  and unit-testable. Bashir's test, however, ended up preferring a
  process-level `spawnSync` + `--import` stub approach — both work, but
  the spawnSync style exercises the actual process boundary (env, exit
  codes, stderr) which is what an ops script's contract really is.
* **`.mjs` files outside `tsconfig.json` include globs.** `tsc --noEmit`
  ignored the new file automatically because the include list is scoped
  to `src/**/*.ts` and `tests/**/*.ts`. No tsconfig change needed.

## 2026-05-18T02:45:00Z — PR #71 discord-ops automation batch completed

Coordinated Phase 1 fan-out (Tuvok constitution v1.5.0, Scotty script, Bashir tests, O'Brien workflow, Picard historical record). Cross-agent awareness: all decisions merged to decisions.md, orchestration logs written, session log at .squad/log/2026-05-18T024500Z-discord-ops-automation.md.

---


**2026-05-18T04:00:10Z:** PR #73 merged; exit-code convention restored in discord-ops script — see decisions.md (PR #73 → bashir-exit-code-restoration decision)
