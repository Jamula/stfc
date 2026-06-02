// Tests for discord/commands.json + scripts/validate-discord-commands.mjs (#144).
// Verifies the single-source-of-truth command definitions are well-formed and
// that the validator script enforces Discord's CHAT_INPUT schema constraints.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const COMMANDS_JSON = resolve(REPO_ROOT, "discord/commands.json");
const VALIDATOR = resolve(REPO_ROOT, "scripts/validate-discord-commands.mjs");

function runValidator(filePath?: string): { status: number | null; stdout: string; stderr: string } {
  const args = filePath ? [VALIDATOR, filePath] : [VALIDATOR];
  const res = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 10_000,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe("discord/commands.json", () => {
  it("exists and parses as valid JSON", () => {
    const raw = readFileSync(COMMANDS_JSON, "utf8");
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed), "commands.json must be a JSON array");
  });

  it("contains at least one command", () => {
    const commands = JSON.parse(readFileSync(COMMANDS_JSON, "utf8"));
    assert.ok(commands.length >= 1, "commands.json must have at least one command");
  });

  it("every command has name (1-32 chars), description (1-100 chars), and type=1", () => {
    const commands = JSON.parse(readFileSync(COMMANDS_JSON, "utf8"));
    for (const cmd of commands) {
      assert.ok(typeof cmd.name === "string", `command.name must be a string: ${JSON.stringify(cmd)}`);
      assert.ok(cmd.name.length >= 1 && cmd.name.length <= 32, `name length out of range: "${cmd.name}"`);
      assert.match(cmd.name, /^[-_\p{Ll}\p{N}]+$/u, `name fails Discord pattern: "${cmd.name}"`);

      assert.ok(typeof cmd.description === "string", `command.description must be a string: ${JSON.stringify(cmd)}`);
      assert.ok(
        cmd.description.length >= 1 && cmd.description.length <= 100,
        `description length out of range: "${cmd.description}"`,
      );

      const type = cmd.type ?? 1;
      assert.equal(type, 1, `expected type=1 (CHAT_INPUT) for command "${cmd.name}", got ${type}`);
    }
  });

  it("includes /redeem-status command", () => {
    const commands = JSON.parse(readFileSync(COMMANDS_JSON, "utf8"));
    const cmd = commands.find((c: { name: string }) => c.name === "redeem-status");
    assert.ok(cmd, "redeem-status command missing from commands.json");
    assert.equal(cmd.description, "Show the latest redemption run results");
  });

  it("includes /trigger-redeem with ADMINISTRATOR permission (default_member_permissions='8')", () => {
    const commands = JSON.parse(readFileSync(COMMANDS_JSON, "utf8"));
    const cmd = commands.find((c: { name: string }) => c.name === "trigger-redeem");
    assert.ok(cmd, "trigger-redeem command missing from commands.json");
    assert.equal(
      cmd.default_member_permissions,
      "8",
      "trigger-redeem must require ADMINISTRATOR (bitmask '8')",
    );
  });
});

describe("scripts/validate-discord-commands.mjs", () => {
  it("exits 0 on the current commands.json", () => {
    const r = runValidator();
    assert.equal(r.status, 0, `validator failed on valid file; stderr=${r.stderr}`);
    assert.match(r.stdout, /OK:/, "expected OK: prefix in stdout");
  });

  it("exits 1 on a command with name longer than 32 chars", () => {
    const broken = [
      {
        name: "a".repeat(33),
        type: 1,
        description: "This name is too long",
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-commands.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for oversized name; stdout=${r.stdout}`);
      assert.match(r.stderr, /INVALID|maxLength|pattern/i, "expected error message in stderr");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 on empty description", () => {
    const broken = [{ name: "my-cmd", type: 1, description: "" }];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-empty-desc.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for empty description; stdout=${r.stdout}`);
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 on malformed JSON", () => {
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-json.json");
    try {
      writeFileSync(fixturePath, "{ not valid json }", "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for invalid JSON; stdout=${r.stdout}`);
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 on uppercase command names", () => {
    const broken = [{ name: "REDEEM", type: 1, description: "Uppercase should fail" }];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-uppercase-name.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for uppercase name; stdout=${r.stdout}`);
      assert.match(r.stderr, /pattern|lowercase|INVALID/i, "expected lowercase/pattern validation error");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 on duplicate (type, name) command pairs", () => {
    const broken = [
      { name: "foo", type: 1, description: "x" },
      { name: "foo", type: 1, description: "y" },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-duplicate-type-name.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for duplicate type+name; stdout=${r.stdout}`);
      assert.match(r.stderr, /duplicate command/i, "expected duplicate command message");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 when options are present", () => {
    const broken = [
      {
        name: "foo",
        type: 1,
        description: "x",
        options: [{ type: 3, name: "arg", description: "arg" }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-options-not-supported.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for options usage; stdout=${r.stdout}`);
      assert.match(r.stderr, /options not yet supported/i, "expected options-not-supported message");
    } finally {
      unlinkSync(fixturePath);
    }
  });
});
