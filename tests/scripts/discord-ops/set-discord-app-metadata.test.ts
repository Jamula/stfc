// Pinning tests for `scripts/discord-ops/set-discord-app-metadata.mjs`
// (Scotty's operator-only one-shot script).
//
// Constitution v1.4.0 → next bump: the Principle V carve-out grants this
// script PATCH/PUT/POST authority against `discord.com/api/v10`. The
// non-negotiable invariant — FR-012 — is that DISCORD_BOT_TOKEN MUST be
// redacted from every error path. These tests pin that invariant with a
// sentinel-token assertion: a unique string the test sets as the token,
// then asserts the script's stdout AND stderr never echo it back.
//
// Sentinel token: BOT_TOKEN_SENTINEL_DO_NOT_LEAK_a8f3c91e
// (registered in `.squad/decisions/inbox/bashir-discord-ops-tests.md` —
// future devs MUST NOT reuse this string for any other purpose.)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "discord-ops",
  "set-discord-app-metadata.mjs",
);
const STUB = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "discord-ops",
  "fetch-stub.mjs",
);
const SENTINEL = "BOT_TOKEN_SENTINEL_DO_NOT_LEAK_a8f3c91e";

interface RunOpts {
  args: string[];
  env?: Record<string, string | undefined>;
  withStub?: boolean;
  stubStatus?: number;
  stubBody?: string;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(opts: RunOpts): RunResult {
  const nodeArgs: string[] = [];
  if (opts.withStub) {
    nodeArgs.push("--import", STUB);
  }
  nodeArgs.push(SCRIPT, ...opts.args);

  // Build env from scratch — DO NOT inherit DISCORD_BOT_TOKEN from the
  // dev's shell.
  const baseEnv: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "/tmp",
  };
  const env = { ...baseEnv, ...(opts.env ?? {}) } as Record<string, string>;
  if (opts.withStub) {
    if (opts.stubStatus !== undefined) env["STUB_STATUS"] = String(opts.stubStatus);
    if (opts.stubBody !== undefined) env["STUB_BODY"] = opts.stubBody;
  }
  // Drop any key whose value is undefined so spawn doesn't reject.
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete env[k];
  }

  const res = spawnSync(process.execPath, nodeArgs, {
    env,
    encoding: "utf8",
    cwd: REPO_ROOT,
    // 10s is plenty for a one-shot HTTP-stubbed script.
    timeout: 10_000,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

const scriptExists = fs.existsSync(SCRIPT);

// All assertions live inside the describe block so the suite still runs
// (and reports a clean "skipped — script not yet committed" message)
// when Scotty hasn't landed his file yet. Once the file exists, the
// tests become real regression guards.
describe("scripts/discord-ops/set-discord-app-metadata.mjs", { skip: !scriptExists }, () => {
  it("--help prints usage and exits 0", () => {
    const r = run({ args: ["--help"] });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
    const out = r.stdout + r.stderr;
    assert.match(out, /usage/i, "expected usage hint in --help output");
    // --help should mention each flag the directive promised.
    assert.match(out, /--icon/, "expected --icon flag in usage");
    assert.match(out, /--description/, "expected --description flag in usage");
    assert.match(out, /--username/, "expected --username flag in usage");
  });

  it("missing DISCORD_BOT_TOKEN exits 1 with clear message", () => {
    const r = run({ args: ["--description", "hi"] });
    assert.equal(r.status, 1, `expected exit 1 when token missing`);
    const out = (r.stdout + r.stderr).toLowerCase();
    // Message must name the variable so the operator knows what to set,
    // but must NOT echo any token-looking value (there is no value to echo
    // in this case — this assertion is here for documentation).
    assert.match(out, /discord_bot_token/);
  });

  it("--dry-run does NOT echo the token in stdout or stderr", () => {
    const r = run({
      args: ["--dry-run", "--description", "hello"],
      env: { DISCORD_BOT_TOKEN: SENTINEL },
    });
    // Whether the script chooses exit 0 (success preview) or non-zero
    // (refusing to do anything), it MUST NOT have leaked the token.
    assert.ok(
      !r.stdout.includes(SENTINEL),
      `sentinel token leaked in stdout:\n${r.stdout}`,
    );
    assert.ok(
      !r.stderr.includes(SENTINEL),
      `sentinel token leaked in stderr:\n${r.stderr}`,
    );
  });

  it("401 from Discord surfaces the API message but NEVER the token (FR-012)", () => {
    const r = run({
      args: ["--description", "hi"],
      env: { DISCORD_BOT_TOKEN: SENTINEL },
      withStub: true,
      stubStatus: 401,
      stubBody: JSON.stringify({ message: "401: Unauthorized", code: 0 }),
    });
    // Discord rejected a well-formed request → exit 2 per runAll.ts convention.
    assert.equal(r.status, 2, `expected exit 2 (Discord-said-no) on 401; got ${r.status}`);
    const combined = r.stdout + r.stderr;
    // Discord's error message MUST be visible to the operator…
    assert.match(combined, /unauthorized/i, "expected Discord auth message in output");
    // …but the literal token value MUST NEVER appear.
    assert.ok(
      !combined.includes(SENTINEL),
      `sentinel token leaked on 401 path:\n${combined}`,
    );
  });

  it("200 OK on --description exits 0 with a success line", () => {
    const r = run({
      args: ["--description", "hi"],
      env: { DISCORD_BOT_TOKEN: SENTINEL },
      withStub: true,
      stubStatus: 200,
      stubBody: JSON.stringify({ id: "1234567890", description: "hi" }),
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    // Some recognizable success marker — script-agnostic.
    assert.match(
      r.stdout + r.stderr,
      /(updated|success|ok|patched|✓)/i,
      "expected success indicator in output",
    );
    // And the stub MUST have been called against discord.com/api/v10.
    assert.match(
      r.stderr,
      /STUB_FETCH .*discord\.com\/api\/v10/,
      "expected PATCH to discord.com/api/v10",
    );
    // And the call MUST have used PATCH (per the directive — both
    // /users/@me and /applications/@me are PATCHed).
    assert.match(r.stderr, /STUB_FETCH .*"method":"PATCH"/, "expected PATCH method");
    // Token MUST NOT have leaked back via the recorded headers either —
    // even though the stub records Authorization, the bare sentinel
    // (the value without the `Bot ` prefix) must not appear in stdout.
    assert.ok(
      !r.stdout.includes(SENTINEL),
      `sentinel token leaked in stdout:\n${r.stdout}`,
    );
  });

  it("--icon /nonexistent/path exits non-zero with a file-not-found message", () => {
    const bogus = path.join(os.tmpdir(), `definitely-not-here-${Date.now()}.png`);
    const r = run({
      args: ["--icon", bogus],
      env: { DISCORD_BOT_TOKEN: SENTINEL },
    });
    assert.notEqual(r.status, 0, `expected non-zero exit on missing icon file`);
    const combined = (r.stdout + r.stderr).toLowerCase();
    assert.ok(
      combined.includes("not found") ||
        combined.includes("no such file") ||
        combined.includes("enoent") ||
        combined.includes("does not exist"),
      `expected file-not-found message, got:\n${r.stdout + r.stderr}`,
    );
    // And token still must not leak.
    assert.ok(
      !(r.stdout + r.stderr).includes(SENTINEL),
      `sentinel token leaked on icon-missing path`,
    );
  });

  // Optional 11 MB oversize guard. Synthesize the file inside a tmp dir
  // so we can clean it up unconditionally.
  describe("--icon oversize guard", () => {
    let tmpDir: string;
    let bigFile: string;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-discord-ops-"));
      bigFile = path.join(tmpDir, "huge.png");
      // Scotty's script validates magic bytes BEFORE size, so the file
      // must start with a valid PNG signature (8 bytes) to reach the
      // size check. Pad with zeros to push total size past 10 MB.
      const PNG_MAGIC = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const PADDING = Buffer.alloc(11 * 1024 * 1024, 0);
      fs.writeFileSync(bigFile, Buffer.concat([PNG_MAGIC, PADDING]));
    });

    after(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    });

    it("rejects icons over the 10 MB Discord limit", () => {
      const r = run({
        args: ["--icon", bigFile],
        env: { DISCORD_BOT_TOKEN: SENTINEL },
      });
      assert.notEqual(r.status, 0, `expected non-zero exit on oversize icon`);
      const combined = (r.stdout + r.stderr).toLowerCase();
      assert.ok(
        combined.includes("10 mb") ||
          combined.includes("10mb") ||
          combined.includes("exceeds") ||
          combined.includes("too large"),
        `expected oversize message, got:\n${r.stdout + r.stderr}`,
      );
      assert.ok(
        !(r.stdout + r.stderr).includes(SENTINEL),
        `sentinel token leaked on oversize path`,
      );
    });
  });

  // ── Exit-code convention pins (runAll.ts: 1=infra, 2=Discord-said-no) ──────

  it("unknown flag exits 1 (bad args = operator/infra error)", () => {
    const r = run({ args: ["--unknown-flag"] });
    assert.equal(r.status, 1, `bad args must exit 1 per runAll.ts; got ${r.status}`);
  });

  it("no flag exits 1 with 'At least one of' message (operator/infra error)", () => {
    const r = run({ args: [] });
    assert.equal(r.status, 1, `no-flag must exit 1 per runAll.ts; got ${r.status}`);
    assert.match(
      r.stdout + r.stderr,
      /at least one of/i,
      "expected 'At least one of' guidance in output",
    );
  });

  it("empty --username exits 1 (validation failure = operator/infra error)", () => {
    // validateUsername rejects names shorter than USERNAME_MIN (2 chars).
    const r = run({
      args: ["--username", "x"],
      env: { DISCORD_BOT_TOKEN: SENTINEL },
    });
    assert.equal(r.status, 1, `validation failure must exit 1 per runAll.ts; got ${r.status}`);
  });
});
