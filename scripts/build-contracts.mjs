#!/usr/bin/env node
/**
 * build-contracts.mjs
 *
 * Reads each JSON Schema from specs/005-web-control-panel/contracts/*.json and
 * generates TypeScript types into shared/contracts/*.ts.
 *
 * Generator choice: json-schema-to-typescript (battle-tested, well-maintained,
 * handles const/enum/oneOf, ships its own prettier for deterministic output).
 * ajv is already in devDeps for runtime validation; this adds only the
 * compile-time generator. No Zod codegen here — Zod schemas are deferred to
 * a later wave per the spec.
 *
 * Idempotent: re-running with unchanged schemas produces no diff.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SCHEMAS, OUTPUT_DIR, generateTypes } from './lib/generate-contracts.mjs';

for (const { file, output } of SCHEMAS) {
  const ts = await generateTypes(file);
  const outPath = path.join(OUTPUT_DIR, output);
  fs.writeFileSync(outPath, ts, 'utf8');
  console.log(`✓  ${output}  ←  ${file}`);
}

console.log('\nshared/contracts/ types are up to date.');
