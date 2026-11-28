#!/usr/bin/env node
/**
 * check-contracts-types.ts  (CI gate)
 *
 * Re-runs the contract generator in memory and diffs the result against the
 * committed shared/contracts/*.ts files.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { SCHEMAS, OUTPUT_DIR, generateTypes } from "../lib/generate-contracts.ts";

let failed = false;

for (const { file, output } of SCHEMAS) {
  const outPath = path.join(OUTPUT_DIR, output);

  if (!fs.existsSync(outPath)) {
    console.error(`✗  ${output}  — file missing. Run: npm run build:contracts`);
    failed = true;
    continue;
  }

  const expected = await generateTypes(file);
  const actual = fs.readFileSync(outPath, "utf8");

  if (expected === actual) {
    console.log(`✓  ${output}  is in sync with  ${file}`);
  } else {
    console.error(`✗  ${output}  is OUT OF SYNC with  ${file}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nFix: run `npm run build:contracts` and commit the result.");
  process.exit(1);
}

console.log("\nAll contract types are in sync with their schemas. ✓");
