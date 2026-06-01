# Discord monitor extension skill

Use this when adding a new Discord message-class scanner to the existing monitor.

## Pattern

1. Add any new state-file schema/loader in `src/discord/schemas.ts` and `src/discord/state.ts`.
   - Operator-specific files should usually be missing-safe and return `[]`/empty state unless the feature is a hard prerequisite.
   - Commit only `.example` files for channel IDs or account-specific Discord configuration.

2. Build the ingest surface explicitly.
   - Merge allowlists only for REST polling if multiple scanners need different channel sets.
   - Preserve separate channel sets for downstream processing so one scanner does not feed another scanner's state, digest, or redemption path.

3. Keep scanner logic in `src/discord/<scanner>.ts`.
   - Export a small parser, any rate limiter/stateful helper, and a `process*()` function the monitor can call.
   - Tests should use mocked Discord message objects and must not call live Discord.

4. Add the monitor hook in `src/skills/discordMonitor.ts` after ingest succeeds.
   - Use structural client seams for optional capabilities like replies (`postMessage`).
   - Log drops/rate-limits, but do not persist scanner-only transient state unless the feature spec requires it.

5. Validation checklist.
   - Wire the new test file into `tests/index.test.ts`.
   - Run `npm run typecheck && npm test`.
   - If workflows changed, update pinned workflow tests in the same commit.
