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

  it("includes /game-state command with file (ATTACHMENT) and note (STRING) options", () => {
    const commands = JSON.parse(readFileSync(COMMANDS_JSON, "utf8"));
    const cmd = commands.find((c: { name: string }) => c.name === "game-state");
    assert.ok(cmd, "game-state command missing from commands.json");
    assert.ok(Array.isArray(cmd.options) && cmd.options.length >= 1, "game-state must have at least one option");

    const fileOpt = cmd.options.find((o: { name: string }) => o.name === "file");
    assert.ok(fileOpt, "game-state must have a 'file' option");
    assert.equal(fileOpt.type, 11, "file option must be type 11 (ATTACHMENT)");
    assert.equal(fileOpt.required, true, "file option must be required");

    const noteOpt = cmd.options.find((o: { name: string }) => o.name === "note");
    assert.ok(noteOpt, "game-state must have a 'note' option");
    assert.equal(noteOpt.type, 3, "note option must be type 3 (STRING)");
    assert.equal(noteOpt.required, false, "note option must not be required");
  });

  it("includes /game-state with ADMINISTRATOR permission (default_member_permissions='8')", () => {
    const commands = JSON.parse(readFileSync(COMMANDS_JSON, "utf8"));
    const cmd = commands.find((c: { name: string }) => c.name === "game-state");
    assert.ok(cmd, "game-state command missing from commands.json");
    assert.equal(
      cmd.default_member_permissions,
      "8",
      "game-state must require ADMINISTRATOR (bitmask '8')",
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

  it("exits 1 when options contain a subcommand type (type 1 — recursive, not supported)", () => {
    const broken = [
      {
        name: "foo",
        type: 1,
        description: "x",
        options: [{ type: 1, name: "sub", description: "a subcommand" }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-options-subcommand.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for subcommand option type; stdout=${r.stdout}`);
      assert.match(r.stderr, /not supported/i, "expected not-supported message in stderr");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 when options contain an out-of-range type (type 99)", () => {
    const broken = [
      {
        name: "foo",
        type: 1,
        description: "x",
        options: [{ type: 99, name: "arg", description: "unknown type" }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-options-out-of-range.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for out-of-range option type; stdout=${r.stdout}`);
      assert.match(r.stderr, /not supported/i, "expected not-supported message in stderr");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 0 for a command with an ATTACHMENT option (type 11) — the game-state shape", () => {
    const valid = [
      {
        name: "my-upload",
        type: 1,
        description: "Upload a file",
        options: [{ type: 11, name: "f", description: "x", required: true }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-valid-attachment-option.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(valid), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 0, `expected exit 0 for ATTACHMENT option; stderr=${r.stderr}`);
      assert.match(r.stdout, /OK:/, "expected OK: prefix in stdout");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 on uppercase option names", () => {
    const broken = [
      {
        name: "my-upload",
        type: 1,
        description: "Upload a file",
        options: [{ type: 11, name: "UPPERCASE", description: "bad", required: true }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-uppercase-option-name.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for uppercase option name; stdout=${r.stdout}`);
      assert.match(r.stderr, /option\[0\]\.name/i, "expected option-name validation error");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 1 on option names with spaces", () => {
    const broken = [
      {
        name: "my-upload",
        type: 1,
        description: "Upload a file",
        options: [{ type: 11, name: "my file", description: "bad", required: true }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-broken-space-option-name.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(broken), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 1, `expected exit 1 for option name with space; stdout=${r.stdout}`);
      assert.match(r.stderr, /option\[0\]\.name/i, "expected option-name validation error");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 0 on a valid lowercase option name", () => {
    const valid = [
      {
        name: "my-upload",
        type: 1,
        description: "Upload a file",
        options: [{ type: 11, name: "note", description: "ok", required: false }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-valid-lowercase-option-name.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(valid), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 0, `expected exit 0 for valid lowercase option name; stderr=${r.stderr}`);
      assert.match(r.stdout, /OK:/, "expected OK: prefix in stdout");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("exits 0 with default_member_permissions='8' on a command", () => {
    const valid = [
      {
        name: "my-upload",
        type: 1,
        description: "Upload a file",
        default_member_permissions: "8",
        options: [{ type: 11, name: "file", description: "x", required: true }],
      },
    ];
    const fixturePath = resolve(REPO_ROOT, "discord/_test-valid-default-member-permissions.json");
    try {
      writeFileSync(fixturePath, JSON.stringify(valid), "utf8");
      const r = runValidator(fixturePath);
      assert.equal(r.status, 0, `expected exit 0 with default_member_permissions='8'; stderr=${r.stderr}`);
      assert.match(r.stdout, /OK:/, "expected OK: prefix in stdout");
    } finally {
      unlinkSync(fixturePath);
    }
  });
});
