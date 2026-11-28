#!/usr/bin/env node
// DISABLED under issue #402: redistribution permission is unestablished.
// Use the source-link index in docs/stfc-knowledge/community-reference-sheet/.
// Public availability is not redistribution permission; this guard refuses to
// fetch or write local mirrors unless reuse terms are verified and authorized.

const SHEET = "19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit`;

async function main(): Promise<void> {
  throw new Error(
    "Community sheet mirroring is disabled (#402): redistribution permission has not been established. " +
      `Open the original source: ${SHEET_URL}. ` +
      "See docs/stfc-knowledge/community-reference-sheet/README.md; no data was fetched or written.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
