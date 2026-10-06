import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("Init Mode state ownership guidance", () => {
  for (const path of initSurfaces) {
    it(`${path} initializes backend config and ignores mutable state`, () => {
      const text = readInitSurface(path);

      assert.match(text, /\.squad\/config\.json/);
      assert.match(text, /statebackend/);
      assert.match(text, /explicitly selected backend/);
      assert.match(text, /default statebackend to local/);
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

describe("Init Mode — memory ignore uses wildcard-plus-negation, backend init precedes mutable writes", () => {
  for (const path of initSurfaces) {
    it(`${path} fails closed when the non-local state bridge cannot verify seeding`, () => {
      const text = readInitSurface(path);

      assert.match(
        text,
        /for orphan, two-layer, or git-notes, call squad_state_health after writing the config and require a successful response before any mutable-state write; if the tool is unavailable or errors, fail closed before proceeding/,
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
