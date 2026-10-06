import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const coordinatorSurfaces = [
  ".github/agents/squad.agent.md",
  ".squad/templates/squad.agent.md.template",
];
const castingMigrationSurfaces = [
  ...coordinatorSurfaces,
  ".squad/reference/casting.md",
  ".squad/templates/casting-reference.md",
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

    it(`${path} keeps casting policy and registry static and routes only history by backend`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for every backend, initialize the authoritative static casting files in the checkout/,
      );
      assert.match(
        text,
        /if \.squad\/casting\/policy\.json is absent, copy \.squad\/templates\/casting-policy\.json/,
      );
      assert.match(
        text,
        /create or update \.squad\/casting\/registry\.json as a static file while preserving existing persistent-name assignments/,
      );
      assert.match(
        text,
        /never send casting\/policy\.json or casting\/registry\.json through state tools/,
      );
      assert.match(
        text,
        /the assignment history\.json is mutable state: for local\/worktree, create or append \.squad\/casting\/history\.json on the local state filesystem/,
      );
      assert.match(
        text,
        /for orphan, two-layer, or git-notes, seed only logical key casting\/history\.json with squad_state_write and verify it with squad_state_read/,
      );
      assert.doesNotMatch(
        text,
        /squad_state_write.{0,100}casting\/(?:policy|registry)\.json/i,
        "static casting policy and registry must not use mutable-state writes",
      );
      assert.match(text, /do not create a checkout copy/);
      assert.match(
        text,
        /if the bridge is unavailable, the write fails, or readback does not confirm the write, fail closed/,
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

describe("Coordinator casting policy and registry are static across state backends", () => {
  for (const path of coordinatorSurfaces) {
    it(`${path} protects only mutable casting history and keeps policy/registry on disk`, () => {
      const text = readInitSurface(path);
      const handshakeStart = text.indexOf("for all backends except");
      const handshakeEnd = text.indexOf("the squad_state_* and memory.* tools", handshakeStart);
      assert.ok(
        handshakeStart >= 0 && handshakeEnd > handshakeStart,
        `${path} should define a state-backend handshake`,
      );
      const handshake = text.slice(handshakeStart, handshakeEnd);
      const hardRuleStart = text.indexOf("hard rule — backend contract enforcement");
      const hardRuleEnd = text.indexOf("for state_backend ∈", hardRuleStart);
      assert.ok(
        hardRuleStart >= 0 && hardRuleEnd > hardRuleStart,
        `${path} should define the non-local backend contract`,
      );
      const hardRule = text.slice(hardRuleStart, hardRuleEnd);

      assert.match(
        handshake,
        /\.squad\/casting\/history\.json/,
        `${path} should protect mutable casting history under non-local backends`,
      );
      assert.doesNotMatch(
        handshake,
        /\.squad\/casting\/\*\.json/,
        `${path} must not ban static casting files with a wildcard`,
      );
      assert.match(
        handshake,
        /\.squad\/casting\/policy\.json and \.squad\/casting\/registry\.json are authoritative static files that remain on disk for every backend/,
        `${path} should permit static casting policy and registry files on disk`,
      );
      assert.match(
        handshake,
        /read\/write them with file tools and never route them through state tools/,
        `${path} should keep static casting files out of state tools`,
      );
      assert.match(
        hardRule,
        /- \.squad\/casting\/history\.json/,
        `${path} should prohibit direct writes to mutable casting history`,
      );
      assert.deepEqual(
        hardRule.match(/- \.squad\/casting\/[^\s]+/g),
        ["- .squad/casting/history.json"],
        `${path} should prohibit only direct writes to mutable casting history`,
      );
      assert.doesNotMatch(
        hardRule,
        /- \.squad\/casting\/(?:\*\.json|policy\.json|registry\.json)/,
        `${path} must not prohibit static casting files`,
      );
      assert.match(
        hardRule,
        /\.squad\/casting\/policy\.json and \.squad\/casting\/registry\.json are static tracked files, not runtime state; they remain writable with file tools even when the state bridge is unavailable/,
        `${path} should keep static casting files writable without the state bridge`,
      );
      assert.match(
        hardRule,
        /\.squad\/casting\/history\.json remains runtime-managed and prohibited from direct file writes on non-local backends/,
        `${path} should keep mutable casting history runtime-managed`,
      );
      assert.match(
        text,
        /for every backend, create or update the authoritative static \.squad\/casting\/registry\.json in the checkout/,
        `${path} should maintain the static registry in the checkout`,
      );
      assert.match(
        text,
        /for orphan, two-layer, or git-notes, use only logical key casting\/history\.json with squad_state_write, then verify it with squad_state_read/,
        `${path} should route only mutable casting history through non-local state tools`,
      );
    });
  }

  it("keeps the coordinator and template backend contracts in sync", () => {
    const contracts = coordinatorSurfaces.map((path) => {
      const text = readInitSurface(path);
      const handshakeStart = text.indexOf("for all backends except");
      const handshakeEnd = text.indexOf("the squad_state_* and memory.* tools", handshakeStart);
      const hardRuleStart = text.indexOf("hard rule — backend contract enforcement");
      const hardRuleEnd = text.indexOf("for state_backend ∈", hardRuleStart);
      assert.ok(handshakeStart >= 0 && handshakeEnd > handshakeStart);
      assert.ok(hardRuleStart >= 0 && hardRuleEnd > hardRuleStart);
      return `${text.slice(handshakeStart, handshakeEnd)}\n${text.slice(
        hardRuleStart,
        hardRuleEnd,
      )}`;
    });
    assert.equal(
      contracts[0],
      contracts[1],
      "the coordinator and template should have matching casting backend guidance",
    );
  });
});

describe("Casting history follows the configured state backend", () => {
  const allocationSurfaces = [
    ...coordinatorSurfaces,
    ".squad/reference/members.md",
  ];
  const castingReferenceSurfaces = [
    ".squad/reference/casting.md",
    ".squad/templates/casting-reference.md",
  ];

  function memberAllocationInstruction(path: string): string {
    const text = readInitSurface(path);
    const start = text.indexOf("1. **allocate a name**");
    const end = text.indexOf("2. **check plugin marketplaces.**", start);
    assert.ok(start >= 0 && end > start, `${path} should describe name allocation`);
    return text.slice(start, end);
  }

  function castingHistoryBackendContract(path: string): string {
    const text = readInitSurface(path);
    const contract = text.match(
      /before lru scoring or recording an assignment snapshot, read and update history through the configured backend: .*?it may be stale\./,
    );
    assert.ok(contract, `${path} should define casting-history backend ownership`);
    return contract[0];
  }

  it("reads allocation history from the configured backend and fails closed without stale fallback", () => {
    for (const path of allocationSurfaces) {
      const instruction = memberAllocationInstruction(path);

      assert.match(
        instruction,
        /for "local"\/"worktree", read the physical \.squad\/casting\/history\.json/,
        `${path} should read the physical history file only for local/worktree`,
      );
      assert.match(
        instruction,
        /for "orphan", "two-layer", or "git-notes", use squad_state_read for logical key casting\/history\.json/,
        `${path} should read non-local history through its logical key`,
      );
      assert.match(
        instruction,
        /if the bridge is unavailable or the read fails, report the error and fail closed; never fall back to a stale checkout copy/,
        `${path} should fail closed instead of reading stale checkout state`,
      );
    }
  });

  it("keeps allocation instructions identical across coordinator prompts and the members reference", () => {
    const instructions = allocationSurfaces.map(memberAllocationInstruction);
    assert.equal(instructions[0], instructions[1]);
    assert.equal(instructions[0], instructions[2]);
  });

  it("keeps casting-reference backend reads and writes consistent", () => {
    const contracts = castingReferenceSurfaces.map(castingHistoryBackendContract);
    const contract = contracts[0]!;

    assert.match(
      contract,
      /for "local"\/"worktree", read and update the physical \.squad\/casting\/history\.json file on the local state filesystem/,
    );
    assert.match(
      contract,
      /for "orphan", "two-layer", or "git-notes", read logical key casting\/history\.json with squad_state_read, write updates with squad_state_write, then verify with squad_state_read/,
    );
    assert.match(
      contract,
      /if the bridge is unavailable or any state call fails, report the error and fail closed\. never read or write a checkout copy for a non-local backend; it may be stale\./,
    );
    assert.equal(
      contracts[0],
      contracts[1],
      "the casting reference and its template should describe identical history ownership",
    );
  });

  function castingMigrationSection(path: string): string {
    const text = readInitSurface(path);
    const start = text.indexOf("### migration — already-squadified repos");
    const end = text.indexOf("---", start);
    assert.ok(start >= 0 && end > start, `${path} should define an existing-squad migration`);
    return text.slice(start, end).trim();
  }

  it("keeps existing-squad migration semantics aligned across active, generated, and reference surfaces", () => {
    const sections = castingMigrationSurfaces.map(castingMigrationSection);
    assert.ok(sections.every((section) => section === sections[0]));
    const migration = sections[0]!;

    assert.match(
      migration,
      /when \.squad\/team\.md exists and either static casting file is missing from the checkout or history is absent from the configured backend/,
    );
    assert.match(
      migration,
      /for every backend, keep \.squad\/casting\/policy\.json and \.squad\/casting\/registry\.json as authoritative static checkout files/,
    );
    assert.match(
      migration,
      /preserve existing static files and mappings; never send either file through state tools/,
    );
    assert.match(
      migration,
      /for local\/worktree, preserve an existing \.squad\/casting\/history\.json\. if it is absent, create the physical file from the tracked \.squad\/templates\/casting-history-migration\.json and verify the resulting snapshot content and record counts against the seed/,
    );
    assert.match(
      migration,
      /this migration-only seed is for existing squads; fresh new-team initialization must continue using the empty \.squad\/templates\/casting-history\.json/,
    );
    assert.match(
      migration,
      /for orphan, two-layer, or git-notes, first read logical key casting\/history\.json with squad_state_read and preserve it when present/,
    );
    assert.match(
      migration,
      /treat only the exact response state key not found: casting\/history\.json as absence\. only then read the tracked \.squad\/templates\/casting-history-migration\.json, initialize the logical key with squad_state_write, and immediately read it back with squad_state_read\. verify the full snapshot content and the universe_usage_history entry count and assignment_cast_snapshots key count against the seed/i,
    );
    assert.match(
      migration,
      /if the seed cannot be read, the bridge is unavailable, any other state read fails, the write fails, or readback content\/counts do not match, fail closed/,
    );
    assert.match(
      migration,
      /never create, read, or write a checkout history copy for a non-local backend/,
    );
    assert.doesNotMatch(
      migration,
      /squad_state_write.{0,120}casting\/(?:policy|registry)\.json/i,
      "static policy and registry files must never be initialized through state tools",
    );
  });

  it("preserves the tracked legacy history as an existing-squad-only seed and keeps the fresh seed empty", () => {
    const migrationSeedText = readFileSync(
      resolve(process.cwd(), ".squad/templates/casting-history-migration.json"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    const migrationSeed = JSON.parse(migrationSeedText) as {
      universe_usage_history: unknown[];
      assignment_cast_snapshots: Record<string, unknown>;
    };
    assert.equal(
      createHash("sha256").update(migrationSeedText).digest("hex"),
      "848d8bb5286a367c5e2be730967b3d7f6a81842794548a544f95e383c1c56c50",
      "migration seed must remain byte-for-byte equivalent to the tracked legacy history",
    );
    assert.equal(migrationSeed.universe_usage_history.length, 6);
    assert.deepEqual(Object.keys(migrationSeed.assignment_cast_snapshots), [
      "stfc-gift-redeemer-initial-2026-05-08",
    ]);

    const freshSeedText = readFileSync(
      resolve(process.cwd(), ".squad/templates/casting-history.json"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    assert.deepEqual(JSON.parse(freshSeedText), {
      universe_usage_history: [],
      assignment_cast_snapshots: {},
    });
    assert.notEqual(
      createHash("sha256").update(migrationSeedText).digest("hex"),
      createHash("sha256").update(freshSeedText).digest("hex"),
      "the one-time migration history must not replace the empty fresh-team seed",
    );
  });

  it("routes startup checks through the existing-squad migration for both coordinator prompts", () => {
    for (const path of coordinatorSurfaces) {
      const text = readInitSurface(path);
      assert.match(
        text,
        /\*{0,2}casting migration check:\*{0,2} if \.squad\/team\.md exists, check that the static \.squad\/casting\/policy\.json and \.squad\/casting\/registry\.json exist in the checkout and that history\.json exists in the configured backend/,
        `${path} should route existing squads through the migration check`,
      );
      assert.match(
        text,
        /for non-local backends, check history only with squad_state_read on casting\/history\.json; never inspect a checkout history file/,
        `${path} must not let startup inspect a stale non-local history file`,
      );
    }
  });
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

  }
});
