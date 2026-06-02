# Skill: json-config-validator

**Owner:** Uhura (Integrations Dev)
**First used:** 2026-06-02 (PR #150 — `discord/commands.json`)
**Reusability:** Any JSON config file that needs schema enforcement in CI.

## Summary

Pattern for adding a standalone `.mjs` validator script for a JSON config
file, wired into `npm test` via a TypeScript test suite.

## When to use

Use this skill when you are adding a new JSON config file that:
- Is a "single source of truth" consumed by multiple workflows or scripts
- Has a well-defined schema (required fields, string patterns, length limits)
- Needs to fail CI fast if it drifts from its contract

## File layout

```
<config-dir>/<file>.json          # the config file itself
scripts/validate-<file>.mjs       # the standalone ajv validator
tests/<area>/<file>.test.ts       # test suite (wired into tests/index.test.ts)
```

## Validator script template

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_PATH = resolve(REPO_ROOT, "<config-dir>/<file>.json");
const filePath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PATH;

const schema = { /* ... your JSON Schema here ... */ };

const ajv = new Ajv({ allErrors: true, unicodeRegExp: true });
const validate = ajv.compile(schema);

let raw, data;
try { raw = readFileSync(filePath, "utf8"); } catch (e) { process.stderr.write(`ERROR: ${e.message}\n`); process.exit(1); }
try { data = JSON.parse(raw); } catch (e) { process.stderr.write(`ERROR: Invalid JSON: ${e.message}\n`); process.exit(1); }

if (validate(data)) {
  process.stdout.write(`OK: valid\n`);
  process.exit(0);
} else {
  process.stderr.write(`INVALID:\n`);
  for (const err of validate.errors ?? []) process.stderr.write(`  ${err.instancePath} ${err.message}\n`);
  process.exit(1);
}
```

## Test template

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const VALIDATOR = resolve(REPO_ROOT, "scripts/validate-<file>.mjs");

function runValidator(path?: string) {
  const args = path ? [VALIDATOR, path] : [VALIDATOR];
  const res = spawnSync(process.execPath, args, { encoding: "utf8", cwd: REPO_ROOT, timeout: 10_000 });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

it("exits 0 on valid file", () => {
  const r = runValidator();
  assert.equal(r.status, 0);
});

it("exits 1 on broken fixture", () => {
  const fixturePath = resolve(REPO_ROOT, "<config-dir>/_test-broken.json");
  try {
    writeFileSync(fixturePath, JSON.stringify([{ broken: true }]));
    assert.equal(runValidator(fixturePath).status, 1);
  } finally {
    unlinkSync(fixturePath);
  }
});
```

## Key ajv gotchas

| Gotcha | Fix |
|---|---|
| `\p{L}\p{N}` Unicode patterns rejected | Pass `unicodeRegExp: true` to `new Ajv(...)` |
| `ajv-formats` needed only for `format:` keywords | Skip it if your schema has no format annotations |
| `additionalProperties: false` blocks future Discord fields | Use `additionalProperties: true` for externally-defined schemas |
| ajv v8 errors array is `validate.errors` (nullable) | Guard with `?? []` |

## Example: discord/commands.json

Reference implementation: PR #150, `scripts/validate-discord-commands.mjs`.

Schema enforces Discord CHAT_INPUT constraints:
- `name`: `^[-_\p{L}\p{N}]{1,32}$` with `unicodeRegExp: true`
- `description`: 1–100 chars
- `type`: enum [1, 2, 3] (CHAT_INPUT, USER, MESSAGE)
- `default_member_permissions`: string (Discord bitmask as decimal string, e.g. `"8"` for ADMINISTRATOR)
