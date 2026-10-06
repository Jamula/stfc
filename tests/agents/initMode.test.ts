import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const initSurfaces = [
  ".github/skills/coordinator-init-mode/SKILL.md",
  ".squad/templates/init-mode.md",
  ".squad/reference/init-detail.md",
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
