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

function readInitSurface(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8")
    .replace(/\r\n/g, "\n")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
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
      assert.match(text, /\.squad\/memory\//);
      assert.match(text, /\.squad\/sessions\//);
      assert.match(text, /\.squad\/\.scratch\//);
      assert.match(text, /\.squad\/\.cache\//);
      assert.match(text, /\.squad\/\.watch-pids/);
      assert.match(text, /\.squad\/ralph-circuit-breaker\.json/);
      assert.match(text, /\.squad\/\*\/audit-trail\.md/);
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
  const scopedSurfaces = [
    ".squad/templates/init-mode.md",
    ".squad/reference/init-detail.md",
  ];

  for (const path of scopedSurfaces) {
    it(`${path} ignores runtime memory with wildcard-plus-negation while keeping config.json tracked`, () => {
      const text = readInitSurface(path);

      assert.match(text, /\.squad\/memory\/\*/);
      assert.match(text, /!\.squad\/memory\/config\.json/);
      assert.match(
        text,
        /config\.json is a static, constitution-tracked policy file and must stay tracked/,
      );
    });

    it(`${path} initializes the state backend before the first mutable write`, () => {
      const rawText = readFileSync(resolve(process.cwd(), path), "utf-8").replace(
        /\r\n/g,
        "\n",
      );
      const backendIndex = rawText.search(/Initialize state ownership/i);
      const castingIndex = rawText.search(/Casting state initialization/i);
      const seedingIndex = rawText.search(/\*\*Seeding:\*\*/);

      assert.ok(backendIndex >= 0, `${path} should document state-backend initialization`);
      assert.ok(castingIndex >= 0, `${path} should document casting state initialization`);
      assert.ok(seedingIndex >= 0, `${path} should document agent seeding`);
      assert.ok(
        backendIndex < castingIndex,
        `${path} should initialize the state backend before casting state`,
      );
      assert.ok(
        backendIndex < seedingIndex,
        `${path} should initialize the state backend before seeding agents`,
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
