import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

const initSurfaces = [
  ".github/skills/coordinator-init-mode/SKILL.md",
  ".squad/templates/init-mode.md",
  ".squad/reference/init-detail.md",
  ".squad/templates/skills/init-mode/SKILL.md",
];

const canonicalEmptyLedger = `# .squad/decisions/ — Decision Registry

**Updated:** {current UTC timestamp}
**Session:** {initialization session name}

This is the canonical local decision ledger at \`.squad/decisions/decisions.md\`.
When runtime state tools are available, \`decisions/decisions.md\` is the logical
state key; the runtime resolves it to the configured backend. The key does not
name a second local file, and there is no \`.squad/decisions.md\` mirror.

Older entries are kept in the tracked [decision archive](../decisions-archive.md).
Append new accepted decisions without rewriting existing entries. When archiving,
move complete entries without changing their meaning; do not keep duplicate
ledger copies.`;

function normalizeInitText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readInitSurface(path: string): string {
  return normalizeInitText(readFileSync(resolve(process.cwd(), path), "utf-8"));
}

function modelInitConfigRerun(
  configPath: string,
  explicitlySelectedBackend?: string,
): { config: Record<string, unknown>; created: boolean } {
  if (existsSync(configPath)) {
    const originalText = readFileSync(configPath, "utf-8");
    const existingConfig: Record<string, unknown> = JSON.parse(originalText);
    if (
      explicitlySelectedBackend !== undefined &&
      explicitlySelectedBackend !== existingConfig.stateBackend
    ) {
      throw new Error("Existing stateBackend conflicts; explicit state migration is required");
    }
    return { config: existingConfig, created: false };
  }

  const config = {
    version: 1,
    stateBackend: explicitlySelectedBackend ?? "local",
  };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return { config, created: true };
}

describe("Init Mode state ownership guidance", () => {
  for (const path of initSurfaces) {
    it(`${path} initializes backend config and ignores mutable state`, () => {
      const text = readInitSurface(path);

      assert.match(text, /\.squad\/config\.json/);
      assert.match(text, /statebackend/);
      assert.match(text, /explicitly selected backend/);
      assert.match(text, /if no backend was explicitly selected, default to local/);
      assert.match(
        text,
        /if \.squad\/config\.json already exists, preserve its exact contents byte-for-byte, including statebackend, worktrees, model\/context\/reasoning overrides, and unknown or future settings/,
      );
      assert.match(
        text,
        /if an explicitly selected backend conflicts with the existing statebackend, fail closed and require the user to authorize an explicit state migration/,
      );
      assert.match(
        text,
        /only when \.squad\/config\.json is absent, create it with version: 1/,
      );
      assert.match(
        text,
        /if the existing file cannot be read or parsed, stop and report the error rather than replacing it/,
      );
      assert.match(text, /\.gitignore/);
      assert.match(text, /\.squad\/decisions\/decisions\.md/);
      assert.match(text, /\.squad\/decisions\/inbox\//);
      assert.match(text, /\.squad\/agents\/\*\/history\.md/);
      assert.match(text, /\.squad\/agents\/\*\/history-archive\*/);
      assert.match(text, /\.squad\/casting\/history\.json/);
      assert.match(text, /\.squad\/identity\//);
      assert.match(text, /\.squad\/log\//);
      assert.match(text, /\.squad\/orchestration-log\//);
      assert.match(text, /\.squad\/memory\/\*/);
      assert.match(text, /!\.squad\/memory\/config\.json/);
      assert.match(
        text,
        /config\.json is a static, constitution-tracked policy file and must stay tracked/,
      );
      assert.match(text, /\.squad\/sessions\//);
      assert.match(text, /\.squad\/\.scratch\//);
      assert.match(text, /\.squad\/\.cache\//);
      assert.match(text, /\.squad\/\.watch-pids/);
      assert.match(text, /\.squad\/ralph-circuit-breaker\.json/);
      assert.match(text, /\.squad\/\*\/audit-trail\.md/);
    });

    it(`${path} seeds casting and agent history according to the configured backend`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for the local\/worktree backend, copy .* create registry\.json and history\.json .* as files/,
      );
      assert.match(
        text,
        /for every other backend, seed this same data through squad_state_write to the equivalent logical keys instead of writing checkout files directly/,
      );
      assert.match(
        text,
        /read it back with squad_state_read to verify the write before proceeding/,
      );
      assert.match(
        text,
        /for the local\/worktree backend, write history\.md as a file/,
      );
      assert.match(
        text,
        /for every other backend, seed it through squad_state_write to the logical agents\/\{name\}\/history\.md key and verify with squad_state_read; do not create a checkout copy/,
      );
    });

    it(`${path} keeps the active ledger backend-owned, not Git-merged`, () => {
      const text = readInitSurface(path);

      assert.doesNotMatch(
        text,
        /\.squad\/decisions\/decisions\.md\s+merge=union/,
      );
      assert.doesNotMatch(
        text,
        /decisions,\s*memories,\s*and logs from all branches combine automatically/,
      );
      assert.doesNotMatch(text, /decisions flow through git merges/);
      assert.match(
        text,
        /decisions\/inbox\/ as a backend-independent logical runtime namespace/,
      );
      assert.match(
        text,
        /physical \.squad\/decisions\/inbox\/ fallback.*only with local\/worktree backends/,
      );
      assert.match(
        text,
        /nonlocal backends.*do not create, read, or write a checkout snapshot/,
      );
      assert.match(text, /never git-merge or commit the inbox state/);
      assert.match(text, /local\/worktree-only/);
      assert.match(text, /logical decisions\/decisions\.md key/);
      assert.match(text, /state tools/);
      assert.match(text, /never commit the active ledger/);
    });

    it(`${path} seeds a canonical empty ledger for local and worktree backends`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for the local\/worktree backend, if \.squad\/decisions\/decisions\.md does not exist, create it with the canonical empty-ledger content below/,
      );
      assert.ok(
        text.includes(normalizeInitText(canonicalEmptyLedger)),
        `${path} should include the canonical empty-ledger header and content`,
      );
      assert.match(text, /do not copy any existing decision entries/);
      assert.match(text, /if the file already exists, preserve it unchanged/);
    });

    it(`${path} seeds and verifies the logical ledger for non-local backends`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for orphan, two-layer, or git-notes, use squad_state_read on decisions\/decisions\.md to determine whether the key already exists/,
      );
      assert.match(
        text,
        /if absent, initialize that logical key with squad_state_write using the same empty-ledger content, then immediately call squad_state_read and require the returned content to match the seed/,
      );
      assert.match(text, /preserve an existing ledger/);
      assert.match(text, /never create, read, or write a checkout snapshot as fallback/);
    });

    it(`${path} limits union merges to verified, tracked archives`, () => {
      const text = readInitSurface(path);

      assert.match(text, /do not generate .gitattributes union rules for mutable or runtime state/);
      assert.match(
        text,
        /artifact verified to be both tracked and a non-runtime append-only archive/,
      );
      assert.match(text, /not a persistence mechanism for backend-owned state/);
      assert.doesNotMatch(text, /\.squad\/[^ ]* merge=union/);
    });
  }
});

describe("Init Mode config reruns", () => {
  it("preserves existing backend, worktree, model, and future settings without changing file contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "stfc-init-config-rerun-"));
    const configPath = join(dir, ".squad", "config.json");
    const existingConfig = {
      version: 1,
      stateBackend: "two-layer",
      worktrees: true,
      defaultModel: "claude-sonnet-5",
      agentModelOverrides: {
        scribe: "claude-haiku-4.5",
      },
      defaultReasoningEffort: "high",
      agentReasoningEffortOverrides: {
        kirk: "xhigh",
      },
      futureSetting: {
        preserve: true,
      },
    };
    const originalText = `${JSON.stringify(existingConfig, null, 2)}\n`;

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, originalText, "utf-8");

      const rerunWithoutSelection = modelInitConfigRerun(configPath);
      assert.equal(rerunWithoutSelection.created, false);
      assert.deepEqual(rerunWithoutSelection.config, existingConfig);
      assert.equal(readFileSync(configPath, "utf-8"), originalText);

      const rerunWithSameSelection = modelInitConfigRerun(configPath, "two-layer");
      assert.equal(rerunWithSameSelection.created, false);
      assert.deepEqual(rerunWithSameSelection.config, existingConfig);
      assert.equal(readFileSync(configPath, "utf-8"), originalText);

      assert.throws(
        () => modelInitConfigRerun(configPath, "local"),
        /Existing stateBackend conflicts; explicit state migration is required/,
      );
      assert.equal(
        readFileSync(configPath, "utf-8"),
        originalText,
        "a conflicting selection must not rewrite the existing config",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a local-default config only when the config path is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "stfc-init-config-absent-"));
    const configPath = join(dir, ".squad", "config.json");

    try {
      assert.equal(existsSync(configPath), false);
      const result = modelInitConfigRerun(configPath);
      assert.equal(result.created, true);
      assert.deepEqual(result.config, { version: 1, stateBackend: "local" });
      assert.deepEqual(JSON.parse(readFileSync(configPath, "utf-8")), {
        version: 1,
        stateBackend: "local",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Init Mode — memory ignore uses wildcard-plus-negation, backend init precedes mutable writes", () => {
  for (const path of initSurfaces) {
    it(`${path} fails closed when the non-local state bridge cannot verify seeding`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for orphan, two-layer, or git-notes, call squad_state_health after reading an existing config or creating an absent config and require a successful response before any mutable-state write; if the tool is unavailable or errors, fail closed before proceeding/,
      );
      assert.match(
        text,
        /if the bridge is unavailable, the write fails, or readback is absent or does not match, fail closed before casting or agent seeding/,
      );
      assert.match(text, /never create, read, or write a checkout snapshot as fallback/);
    });
  }

  for (const path of initSurfaces) {
    it(`${path} initializes the state backend before the first mutable write`, () => {
      const rawText = readFileSync(resolve(process.cwd(), path), "utf-8").replace(
        /\r\n/g,
        "\n",
      );
      const backendIndex = rawText.search(/Initialize state ownership/i);
      const healthIndex = rawText.indexOf("squad_state_health", backendIndex);
      const ledgerIndex = rawText.search(/\*\*Decision ledger initialization:\*\*/i);
      const castingIndex = rawText.search(/Casting state initialization/i);
      const seedingIndex = rawText.search(/\*\*Seeding:\*\*/);

      assert.ok(backendIndex >= 0, `${path} should document state-backend initialization`);
      assert.ok(
        healthIndex > backendIndex,
        `${path} should check non-local backend health after writing the config`,
      );
      assert.ok(
        ledgerIndex > healthIndex,
        `${path} should initialize the decision ledger after the backend handshake`,
      );
      assert.ok(castingIndex >= 0, `${path} should document casting state initialization`);
      assert.ok(seedingIndex >= 0, `${path} should document agent seeding`);
      assert.ok(
        ledgerIndex < castingIndex,
        `${path} should initialize the decision ledger before casting state`,
      );
      assert.ok(
        ledgerIndex < seedingIndex,
        `${path} should initialize the decision ledger before seeding agents`,
      );
    });

    it(`${path} seeds casting and history through state tools for non-local backends`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for every other backend, seed this same data through squad_state_write to the equivalent logical keys/,
      );
      assert.match(
        text,
        /for every other backend, seed it through squad_state_write to the logical agents\/\{name\}\/history\.md key/,
      );
      assert.match(text, /verify the write before proceeding/);
      assert.match(text, /do not create a checkout copy/);
    });
  }
});
