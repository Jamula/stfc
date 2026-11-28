#!/usr/bin/env node
/**
 * build-contracts.ts
 *
 * Reads each JSON Schema from specs/005-web-control-panel/contracts/*.json and
 * generates TypeScript types into shared/contracts/*.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { SCHEMAS, OUTPUT_DIR, generateTypes } from "./lib/generate-contracts.ts";

for (const { file, output } of SCHEMAS) {
  const ts = await generateTypes(file);
  const outPath = path.join(OUTPUT_DIR, output);
  fs.writeFileSync(outPath, ts, "utf8");
  console.log(`✓  ${output}  ←  ${file}`);
}

console.log("\nshared/contracts/ types are up to date.");
