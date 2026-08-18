// Partial-success path test for `scripts/discord-ops/set-discord-app-metadata.mjs`.
//
// Scenario (Kirk PR #71 LOW-4): the script is invoked with both
// `--icon` (PATCH /users/@me) and `--description` (PATCH /applications/@me).
// The first PATCH succeeds, the second is rejected by Discord with 500.
// User-visible contract being pinned here:
//   1. The success line for the first PATCH IS still printed to stdout —
//      operators need to know what landed before retrying.
//   2. The failure for the second PATCH prints to stderr with the
//      Discord error message visible but the bot token REDACTED (FR-012).
//   3. Final exit code is 2 (Discord-said-no, per the USAGE exit-code
//      table) — not 1, not 0.
//
// Sentinel token (registered in
// `.squad/decisions/inbox/bashir-discord-ops-tests.md`): reuse the
// same sentinel from set-discord-app-metadata.test.ts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "discord-ops",
  "set-discord-app-metadata.mjs",
);
const STUB_PATH = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "discord-ops",
  "fetch-stub-by-path.mjs",
);
const STUB = pathToFileURL(STUB_PATH).href;
const SENTINEL = "BOT_TOKEN_SENTINEL_DO_NOT_LEAK_a8f3c91e";

const scriptExists = fs.existsSync(SCRIPT);
const stubExists = fs.existsSync(STUB_PATH);

describe(
  "partial-success: /users/@me succeeds + /applications/@me fails",
  { skip: !scriptExists || !stubExists },
  () => {
    let tmpDir: string;
    let iconFile: string;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-discord-ops-partial-"));
      iconFile = path.join(tmpDir, "tiny.png");
      // Minimal valid 1x1 PNG (won't fail magic-byte detection; the
      // dimension-warning path is acceptable — we're only testing the
      // PATCH success/failure plumbing, not validation).
      const PNG = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
        "hex",
      );
      fs.writeFileSync(iconFile, PNG);
    });

    after(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    });

    it(
      "prints success for icon, prints redacted failure for description, exits 2",
      () => {
        const env = {
          PATH: process.env["PATH"] ?? "",
          HOME: process.env["HOME"] ?? "/tmp",
          DISCORD_BOT_TOKEN: SENTINEL,
          // First PATCH /users/@me succeeds (200).
          STUB_USERS_STATUS: "200",
          STUB_USERS_BODY: JSON.stringify({ id: "1", username: "bot" }),
          // Second PATCH /applications/@me fails (500).
          STUB_APPS_STATUS: "500",
          STUB_APPS_BODY: JSON.stringify({
            message: "Internal Server Error",
            code: 0,
          }),
        };
        const res = spawnSync(
          process.execPath,
          [
            "--import",
            STUB,
            SCRIPT,
            "--icon",
            iconFile,
            "--description",
            "partial success probe",
          ],
          { env, encoding: "utf8", cwd: REPO_ROOT, timeout: 10_000 },
        );

        // (1) Exit code: Discord said no on the second call → 2.
        assert.equal(
          res.status,
          2,
          `expected exit 2 on partial Discord-side failure; stdout=${res.stdout}\nstderr=${res.stderr}`,
        );

        // (2) Success line for /users/@me is still in stdout.
        assert.match(
          res.stdout,
          /✓\s+PATCH\s+\/users\/@me/,
          `expected /users/@me success line in stdout:\n${res.stdout}`,
        );

        // (3) Failure for /applications/@me is in stderr with the
        // Discord message visible.
        assert.match(
          res.stderr,
          /\/applications\/@me/,
          `expected /applications/@me failure mention in stderr:\n${res.stderr}`,
        );
        assert.match(
          res.stderr,
          /HTTP\s+500/,
          `expected HTTP 500 mention in stderr:\n${res.stderr}`,
        );

        // (4) Token NEVER appears in either stream.
        assert.ok(
          !res.stdout.includes(SENTINEL),
          `sentinel token leaked in stdout:\n${res.stdout}`,
        );
        assert.ok(
          !res.stderr.includes(SENTINEL),
          `sentinel token leaked in stderr:\n${res.stderr}`,
        );

        // (5) Stub recorded BOTH calls (confirms we didn't short-circuit
        //     on the first success or abort before the second).
        const stubLines = res.stderr
          .split("\n")
          .filter((l) => l.startsWith("STUB_FETCH "));
        assert.ok(
          stubLines.some((l) => l.includes("/users/@me")),
          "expected STUB_FETCH for /users/@me",
        );
        assert.ok(
          stubLines.some((l) => l.includes("/applications/@me")),
          "expected STUB_FETCH for /applications/@me",
        );
      },
    );

    it(
      "transport failure on /applications/@me yields exit 1, not 2",
      () => {
        // Reuse the by-path stub but force the default branch (unknown
        // URL) to a status that would normally be 2, then point base
        // URL at an unreachable host via DISCORD_API_BASE override —
        // but the script doesn't expose that env. So instead we
        // simulate transport failure by replacing the apps endpoint
        // with an explicit fetch-impl error using a separate stub:
        // simplest is to NOT use --import at all and let fetch fail
        // against an unresolvable host. The script's discordPatch
        // wraps any fetch throw as a non-DiscordApiError Error, which
        // the loop maps to exit 1.
        const env = {
          PATH: process.env["PATH"] ?? "",
          HOME: process.env["HOME"] ?? "/tmp",
          DISCORD_BOT_TOKEN: SENTINEL,
        };
        const res = spawnSync(
          process.execPath,
          [
            "--import",
            pathToFileURL(
              path.join(
                REPO_ROOT,
                "tests",
                "fixtures",
                "discord-ops",
                "fetch-throw-stub.mjs",
              ),
            ).href,
            SCRIPT,
            "--description",
            "transport failure probe",
          ],
          { env, encoding: "utf8", cwd: REPO_ROOT, timeout: 10_000 },
        );
        assert.equal(
          res.status,
          1,
          `expected exit 1 on transport failure (operator/infra); stdout=${res.stdout}\nstderr=${res.stderr}`,
        );
        assert.match(
          res.stderr,
          /network failure/i,
          `expected 'Network failure' message in stderr:\n${res.stderr}`,
        );
        assert.ok(
          !(res.stdout + res.stderr).includes(SENTINEL),
          "sentinel token leaked on transport-failure path",
        );
      },
    );
  },
);
