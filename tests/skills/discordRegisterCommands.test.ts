// Pinning tests for `.github/workflows/discord-register-commands.yml`.
//
// Rule 3: workflow YAML changes need pinning tests in the same commit.
// This workflow must:
//   - trigger ONLY on workflow_dispatch (never push / pull_request / schedule)
//   - declare inputs: guild_id (optional string), dry_run (optional boolean, default false)
//   - use concurrency group `discord-register-commands`
//   - declare minimal permissions (contents: read; no write grants)
//   - SHA-pin actions/checkout and actions/setup-node
//   - reference discord/commands.json
//   - wire DISCORD_BOT_TOKEN from secrets (not hardcoded)
//   - NEVER echo the token value
//   - run validation BEFORE the curl call (correct step ordering)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "discord-register-commands.yml",
);

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

const yaml = readIfExists(WORKFLOW);

describe(".github/workflows/discord-register-commands.yml", () => {
  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

  it(
    "triggers ONLY on workflow_dispatch",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^on:\s*[\s\S]*?workflow_dispatch:/m,
        "must declare workflow_dispatch trigger",
      );
    },
  );

  it(
    "does NOT trigger on push / pull_request / schedule",
    { skip: yaml === undefined },
    () => {
      // Extract the `on:` block up to the next top-level key.
      const onIdx = /^on:/m.exec(yaml!);
      assert.ok(onIdx, "could not locate `on:` block");
      const tail = yaml!.slice(onIdx.index);
      const nextTop = /\n[a-zA-Z_][\w-]*:\s*\n/.exec(tail);
      const onBlock = nextTop ? tail.slice(0, nextTop.index) : tail;

      assert.doesNotMatch(onBlock, /^\s+push:/m, "MUST NOT trigger on push");
      assert.doesNotMatch(
        onBlock,
        /^\s+pull_request:/m,
        "MUST NOT trigger on pull_request",
      );
      assert.doesNotMatch(
        onBlock,
        /^\s+schedule:/m,
        "MUST NOT trigger on schedule — manual-only",
      );
    },
  );

  it(
    "declares `guild_id` input (optional string)",
    { skip: yaml === undefined },
    () => {
      assert.match(yaml!, /guild_id:/, "must have guild_id input");
      // guild_id must not be `required: true`
      const guildIdx = yaml!.indexOf("guild_id:");
      const guildBlock = yaml!.slice(guildIdx, guildIdx + 300);
      assert.doesNotMatch(
        guildBlock,
        /required:\s*true/,
        "guild_id must not be required",
      );
    },
  );

  it(
    "declares `dry_run` input (optional boolean, default false)",
    { skip: yaml === undefined },
    () => {
      assert.match(yaml!, /dry_run:/, "must have dry_run input");
      const dryIdx = yaml!.indexOf("dry_run:");
      const dryBlock = yaml!.slice(dryIdx, dryIdx + 300);
      assert.match(dryBlock, /default:\s*false/, "dry_run default must be false");
      assert.match(dryBlock, /type:\s*boolean/, "dry_run type must be boolean");
    },
  );

  it(
    "uses concurrency group `discord-register-commands`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /group:\s*discord-register-commands\b/,
        "concurrency group must be discord-register-commands",
      );
    },
  );

  it(
    "declares `permissions: contents: read` and no broader write grants",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^permissions:\s*\n/m,
        "must have a top-level permissions block",
      );
      assert.match(
        yaml!,
        /contents:\s*read/,
        "must grant contents: read",
      );

      // Isolate the top-level permissions block.
      const m = /^permissions:\s*\n([\s\S]*?)(?:^[a-zA-Z_][\w-]*:|\Z)/m.exec(
        yaml!,
      );
      assert.ok(m, "could not isolate permissions block");
      const block = m![1] ?? "";

      assert.doesNotMatch(block, /write-all/, "MUST NOT grant write-all");
      assert.doesNotMatch(
        block,
        /\bcontents:\s*write\b/,
        "MUST NOT grant contents: write",
      );
      assert.doesNotMatch(
        block,
        /\bsecrets:\s*write\b/,
        "MUST NOT grant secrets: write",
      );
      assert.doesNotMatch(
        block,
        /\bid-token:\s*write\b/,
        "MUST NOT grant id-token: write",
      );
      assert.doesNotMatch(
        block,
        /\bpull-requests:\s*write\b/,
        "MUST NOT grant pull-requests: write",
      );
    },
  );

  it(
    "all `uses:` actions are SHA-pinned (40-hex)",
    { skip: yaml === undefined },
    () => {
      const uses = [...yaml!.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
      assert.ok(uses.length > 0, "expected at least one `uses:` action");
      for (const u of uses) {
        assert.match(u, /@[0-9a-f]{40}\b/, `not SHA-pinned: ${u}`);
      }
    },
  );

  it(
    "pins actions/checkout at the canonical repo SHA",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/,
        "checkout SHA must match canonical pin used across this repo",
      );
    },
  );

  it(
    "pins actions/setup-node at the canonical repo SHA",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
        "setup-node SHA must match canonical pin used across this repo",
      );
    },
  );

  it(
    "references discord/commands.json",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /discord\/commands\.json/,
        "workflow must reference discord/commands.json",
      );
    },
  );

  it(
    "wires DISCORD_BOT_TOKEN from secrets (not hardcoded)",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /DISCORD_BOT_TOKEN:\s*\$\{\{\s*secrets\.DISCORD_BOT_TOKEN\s*\}\}/,
        "DISCORD_BOT_TOKEN must come from secrets.DISCORD_BOT_TOKEN",
      );
    },
  );

  it(
    "does NOT echo the DISCORD_BOT_TOKEN value (Rule 21)",
    { skip: yaml === undefined },
    () => {
      // Ensure no step prints the token via echo or set -x.
      assert.doesNotMatch(
        yaml!,
        /echo\s+['"$]?\$?\{?DISCORD_BOT_TOKEN\}?/,
        "MUST NOT echo DISCORD_BOT_TOKEN",
      );
      assert.doesNotMatch(
        yaml!,
        /echo\s+['"$]?\$\{DISCORD_BOT_TOKEN\}/,
        "MUST NOT echo ${DISCORD_BOT_TOKEN}",
      );
      assert.doesNotMatch(
        yaml!,
        /set\s+-x/,
        "MUST NOT use set -x (would print token to logs)",
      );
    },
  );

  it(
    "runs validate-discord-commands.mjs BEFORE the curl command",
    { skip: yaml === undefined },
    () => {
      const validateIdx = yaml!.indexOf("validate-discord-commands.mjs");
      const curlIdx = yaml!.indexOf("curl");
      assert.ok(
        validateIdx !== -1,
        "must reference validate-discord-commands.mjs",
      );
      assert.ok(curlIdx !== -1, "must contain a curl command");
      assert.ok(
        validateIdx < curlIdx,
        "validate-discord-commands.mjs must appear before curl in the workflow",
      );
    },
  );
});
