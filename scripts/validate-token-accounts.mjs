import { readFile } from "node:fs/promises";
import { isTokenAccounts } from "../shared/token-account-schema.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Account-token file path is required.");
  process.exitCode = 1;
} else {
  try {
    const accounts = JSON.parse(await readFile(file, "utf8"));
    if (!isTokenAccounts(accounts)) {
      throw new Error("invalid account data");
    }
  } catch {
    console.error("Account-token data is invalid; the legacy secret was not migrated.");
    process.exitCode = 1;
  }
}
