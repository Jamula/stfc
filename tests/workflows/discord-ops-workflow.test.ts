// Pinning tests for the `.github/workflows/discord-ops.yml`
// workflow_dispatch wrapper.
//
// Rule 3: workflow YAML changes need pinning tests in the same commit.
// Per the directive, this workflow must:
//   - trigger ONLY on workflow_dispatch (NEVER push / pull_request /
//     schedule — the script writes to Discord);
//   - declare inputs for icon (path or URL), description, username;
//   - wire DISCORD_BOT_TOKEN from secrets to env;
//   - run on ubuntu-latest;
//   - keep `permissions:` minimal (no `write-all`, no broad scopes);
//   - invoke `node scripts/discord-ops/set-discord-app-metadata.mjs`.
//
// We assert via regex over the raw YAML body (same pattern as
// `tests/skills/discordMonitor.test.ts`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "discord-ops.yml");

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

const yaml = readIfExists(WORKFLOW);

describe(".github/workflows/discord-ops.yml", () => {
  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

  it(
    "declares `workflow_dispatch:` trigger",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^on:\s*[\s\S]*?workflow_dispatch:/m,
        "must trigger on workflow_dispatch",
      );
    },
  );

  it(
    "does NOT trigger on push / pull_request / schedule",
    { skip: yaml === undefined },
    () => {
      // Carve out the `on:` block by slicing from `on:` to the next
      // top-level key (any line starting at column 0 with a non-space).
      const onIdx = /^on:/m.exec(yaml!);
      assert.ok(onIdx, "could not locate `on:` block");
      const tail = yaml!.slice(onIdx.index);
      const nextTop = /\n[a-zA-Z_][\w-]*:\s*\n/.exec(tail);
      const onBlock = nextTop ? tail.slice(0, nextTop.index) : tail;
      assert.doesNotMatch(
        onBlock,
        /^\s+push:/m,
        "workflow MUST NOT trigger on push",
      );
      assert.doesNotMatch(
        onBlock,
        /^\s+pull_request:/m,
        "workflow MUST NOT trigger on pull_request",
      );
      assert.doesNotMatch(
        onBlock,
        /^\s+schedule:/m,
        "workflow MUST NOT trigger on schedule (manual-only)",
      );
    },
  );

  it(
    "declares inputs for icon, description, and username",
    { skip: yaml === undefined },
    () => {
      // Inputs live under `workflow_dispatch: -> inputs:`. We just
      // assert each name appears under a `key:` form somewhere in the
      // file — the YAML is short enough that false positives are
      // negligible, and a more precise parser would mean adding a YAML
      // dependency this repo doesn't have.
      assert.match(yaml!, /\binputs:\s*\n/, "expected an `inputs:` block");
      // Accept either `icon_path` or `icon_url` (or both).
      assert.ok(
        /\bicon(_path|_url|):\s/.test(yaml!) || /\bicon:\s/.test(yaml!),
        "expected an icon input (icon, icon_path, or icon_url)",
      );
      assert.match(yaml!, /\bdescription:\s/, "expected a `description` input");
      assert.match(yaml!, /\busername:\s/, "expected a `username` input");
    },
  );

  it(
    "maps secrets.DISCORD_BOT_TOKEN to an env var",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /DISCORD_BOT_TOKEN:\s*\$\{\{\s*secrets\.DISCORD_BOT_TOKEN\s*\}\}/,
        "expected env: DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}",
      );
    },
  );

  it(
    "pins `runs-on: ubuntu-latest`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /runs-on:\s*ubuntu-latest\b/,
        "expected runs-on: ubuntu-latest",
      );
    },
  );

  it(
    "declares a minimal top-level `permissions:` block (contents: read at most)",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^permissions:\s*\n/m,
        "expected a top-level `permissions:` block",
      );
      // Slice out the top-level permissions block.
      const m = /^permissions:\s*\n([\s\S]*?)(?:^[a-zA-Z_][\w-]*:|\Z)/m.exec(yaml!);
      assert.ok(m, "could not isolate permissions block");
      const block = m![1] ?? "";
      // Disallowed broad grants.
      assert.doesNotMatch(
        block,
        /write-all/,
        "permissions MUST NOT include write-all",
      );
      assert.doesNotMatch(
        block,
        /\bcontents:\s*write\b/,
        "permissions MUST NOT grant contents: write",
      );
      assert.doesNotMatch(
        block,
        /\bsecrets:\s*write\b/,
        "permissions MUST NOT grant secrets: write",
      );
      assert.doesNotMatch(
        block,
        /\bid-token:\s*write\b/,
        "permissions MUST NOT grant id-token: write",
      );
      // The block should be non-empty (otherwise GH applies default
      // broad permissions on some repos).
      assert.ok(
        /\S/.test(block),
        "permissions block must explicitly enumerate at least one scope",
      );
    },
  );

  it(
    "invokes `node scripts/discord-ops/set-discord-app-metadata.mjs`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /node\s+scripts\/discord-ops\/set-discord-app-metadata\.mjs/,
        "workflow must invoke the metadata-setter script via node",
      );
    },
  );

  it(
    "all `uses:` actions are SHA-pinned (40-hex)",
    { skip: yaml === undefined },
    () => {
      const uses = [...yaml!.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
      for (const u of uses) {
        assert.match(u, /@[0-9a-f]{40}\b/, `not SHA-pinned: ${u}`);
      }
    },
  );
});
