# shared/contracts/

Auto-generated TypeScript contracts (types + Zod schemas) from JSON Schema sources.

## Generated contracts

These files are **auto-generated** — do not hand-edit. See the banner in each file for regeneration details.

### Available contracts

- **`chat-tool-call.ts`** — Canonical tool-call payload for HMAC confirmation gate (RD P1.9)
- **`audit-event.ts`** — Audit log event structure for SWA operations
- **`run-result.ts`** — Structured result from skill/operator runs

See the banner in each file for:
- Source schema location (under `specs/005-web-control-panel/contracts/`)
- Regeneration command
- Schema review authority (e.g., "Kirk review #6")

## Regenerate contracts

When JSON schemas in `specs/005-web-control-panel/contracts/` change:

```bash
npm run build:contracts
```

This compiles the JSON Schemas into TypeScript types + Zod validators in this directory.

## Verify type sync

To ensure all required contracts are generated:

```bash
npm run check:contracts
```

This gate runs in CI and enforces that no contract schema is missing its generated `.ts` file.

## Import path

```typescript
import type { ChatToolCall } from '@stfc/contracts/chat-tool-call';
import { AuditEventSchema } from '@stfc/contracts/audit-event';
```

The `@stfc/contracts/*` path alias is defined in:
- `tsconfig.json` (root — for src/ + tests/)
- `web/tsconfig.json` (Vite frontend)
- `api/tsconfig.json` (Azure Functions)
