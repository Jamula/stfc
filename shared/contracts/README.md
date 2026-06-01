# shared/contracts/

Auto-generated TypeScript contracts (types + Zod schemas) from JSON Schema sources
in `specs/005-web-control-panel/schemas/`.

This directory is intentionally empty in Phase 1. Wave 3 task #122 (Scotty) will
populate it with a generator script that compiles the JSON Schemas into `.ts` files.

## Import path

```typescript
import type { Foo } from '@stfc/contracts/foo';
```

The `@stfc/contracts/*` path alias is defined in:
- `tsconfig.json` (root — for src/ + tests/)
- `web/tsconfig.json` (Vite frontend)
- `api/tsconfig.json` (Azure Functions)

## Source schemas

See `specs/005-web-control-panel/schemas/` for the canonical JSON Schema definitions.
The generator script (Wave 3, #122) will read those and write `.ts` files here.
