# Orchestration Log: speckit.constitution amendment (v1.3.0)

**Timestamp:** 2026-05-15T00:48:55Z  
**Workflow:** /speckit.constitution (via Picard)  
**Feature:** 001-discord-monitor  
**Trigger:** cyrusj request  

## Amendment Scope

**Version:** v1.2.0 → v1.3.0 (MINOR)

**Changes applied to `.specify/memory/constitution.md`:**

1. **Principle V (Durable Inputs)** — enumeration expanded  
   - Added `DISCORD_BOT_TOKEN` to secrets roster  
   - Added six new committed durable-input paths:
     - `config/discord-allowlist.json`
     - `config/classifier-model.json`
     - `data/discord/cursors.json`
     - `data/discord/candidates.jsonl`
     - `data/discord/tips-seen.jsonl`
     - `data/discord/suppression.json`
   - Added `data/digests/**` artifact tree

2. **Security & Compliance** — outbound destinations expanded  
   - Added `discord.com/api/v10` (message fetch/send)  
   - Added `huggingface.co` (ONNX model download)  
   - New binding constraint: NO Discord message content leaves runner

3. **Action Rosters** — third-party action pins extended  
   - Added `discord-monitor.yml` to SHA-pinning roster

**Principles unchanged (byte-identical):** I, II, III, IV, VI, VII, VIII, IX  
**Sections unchanged:** Speckit Reviewer Gates, Development Workflow, Governance, Known Tensions  

## Governance Impact

- **Strict STFC_ACCOUNTS writer gate:** UNCHANGED (v1.2.0 protocol holds)  
- **New governance model:** Secret-definition broadening from enumerated list to open-ended category ("any third-party API credential…") — deliberate, acknowledged in amendment

## Blocking Conditions Resolved (Phase 0)

All three amendment-PR acceptance criteria from governance reviews:

- **[P0-1]** `.specify/templates/plan-template.md` Principle V guidance re-synced  
- **[P0-2]** Per-principle change summary in Sync Impact Report (REVISED/KEPT/EXTENDED status)  
- **[P0-3]** Three Known Tensions and two `TODO(V1.3)` items disposition stated  

## Next Actions

1. Cyrus reviews amendment PR (`squad/governance-v1.3.0-amendment`, PR #6)  
2. Post-merge: `/speckit.implement` Phase 1+ unblocked  
3. `/speckit.analyze` cross-artifact consistency check recommended before implementation starts  

## Decision Record

This amendment unblocks feature 001-discord-monitor without violating v1.2.0's narrower enumerations. The amendment is separable from implementation — lands as standalone PR before feature tasks begin.

---

**Scribe:** Logged by Scribe per `/speckit` orchestration protocol.
