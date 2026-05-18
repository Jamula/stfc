# Orchestration Log — Uhura Discord Discovery (Turn 1)

**Agent:** Uhura (Integrations Dev)  
**Session:** stfc-discovery  
**Task:** Find STFC Discord servers on official site  
**Timestamp:** 2026-05-18T01:39:34.656+00:00  
**Status:** SUCCESS

## Outcome

Located exactly one Discord-VERIFIED+PARTNERED server via canonical official links:
- Invite: `https://discord.com/invite/stfc` (vanity: `stfc`)
- Guild ID: `509679626763632640`
- Name: `Star Trek Fleet Command`
- Scale: ~129K members
- Verification: Discord API GET `/api/v10/invites/stfc?with_counts=true` confirmed official status

## Key Finding

Cannot admin that server → cannot invite bot into it directly. Proposed 3-path decision (admin approval vs relay server vs alternative source).

## Artifacts

- Decision proposal: `.squad/decisions/inbox/uhura-stfc-discord-discovery.md` (created)
- Agent history: `.squad/agents/uhura/history.md` (appended)

## Next

Turn 2: Research official site for 7-day news activity.
