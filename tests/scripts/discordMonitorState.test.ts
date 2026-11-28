import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  persistDiscordMonitorState,
  restoreDiscordMonitorState,
} from "../../scripts/discord-monitor-state.mjs";

const scratchRoot = path.join(process.cwd(), ".test-scratch");
const createdDirs = new Set<string>();

function makeScratchDir(name: string) {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const dir = path.join(
    scratchRoot,
    `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  createdDirs.add(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

afterEach(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.clear();
  try {
    if (fs.existsSync(scratchRoot) && fs.readdirSync(scratchRoot).length === 0) {
      fs.rmdirSync(scratchRoot);
    }
  } catch {
    // Best-effort cleanup only.
  }
});

describe("scripts/discord-monitor-state.mjs", () => {
  it("restores the dead-code cache for reading without persisting monitor changes to it", async () => {
    const restoreRoot = makeScratchDir("discord-monitor-dead-restore");
    const workspaceRoot = makeScratchDir("discord-monitor-dead-workspace");
    const stateRoot = makeScratchDir("discord-monitor-dead-state");
    const relativePath = "data/promo-code-dead.json";

    writeFile(restoreRoot, relativePath, '{"DEADCODE":{"first_seen_outcome":"CODE_INVALID_OR_EXPIRED"}}\n');
    writeFile(stateRoot, relativePath, "original state\n");

    await restoreDiscordMonitorState({ restoreRoot, workspaceRoot });
    assert.equal(
      fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8"),
      '{"DEADCODE":{"first_seen_outcome":"CODE_INVALID_OR_EXPIRED"}}\n',
    );

    writeFile(workspaceRoot, relativePath, "changed workspace\n");
    await persistDiscordMonitorState({ workspaceRoot, stateRoot });
    assert.equal(fs.readFileSync(path.join(stateRoot, relativePath), "utf8"), "original state\n");
  });

  it("rejects a dead-code cache path that is not a file", async () => {
    const restoreRoot = makeScratchDir("discord-monitor-dead-directory");
    const workspaceRoot = makeScratchDir("discord-monitor-dead-workspace");
    fs.mkdirSync(path.join(restoreRoot, "data", "promo-code-dead.json"), { recursive: true });

    await assert.rejects(
      restoreDiscordMonitorState({ restoreRoot, workspaceRoot }),
      /dead-code cache.*not a file/i,
    );
  });

  it("preserves a concurrent /game-state upload when the monitor later persists its own state", async () => {
    const restoreRoot = makeScratchDir("discord-monitor-restore");
    const workspaceRoot = makeScratchDir("discord-monitor-workspace");
    const stateRoot = makeScratchDir("discord-monitor-state");

    writeFile(restoreRoot, "data/discord/cursors.json", '{"channel":"old"}\n');
    writeFile(restoreRoot, "data/discord/candidates.jsonl", '{"value":"OLD"}\n');
    writeFile(restoreRoot, "data/discord/cooldowns.json", '{}\n');
    writeFile(restoreRoot, "data/digests/2026-08-24.md", "old digest\n");
    writeFile(restoreRoot, "promo-codes.txt", "STATECODE\n");
    writeFile(workspaceRoot, "promo-codes.txt", "MAINCODE\n");

    await restoreDiscordMonitorState({
      restoreRoot,
      workspaceRoot,
      mainRef: "a1d97c3",
    });

    fs.cpSync(restoreRoot, stateRoot, { recursive: true, force: true });
    writeFile(
      stateRoot,
      "data/discord/game-state/2026-08-24/124500000-state.png",
      "fresh upload",
    );
    writeFile(
      stateRoot,
      "data/discord/game-state/2026-08-24/_index.json",
      '{ "files": [{ "filename": "124500000-state.png" }] }\n',
    );

    writeFile(workspaceRoot, "data/discord/cursors.json", '{"channel":"new"}\n');
    writeFile(workspaceRoot, "data/discord/tips-seen.jsonl", '{"contentHash":"tip"}\n');
    writeFile(workspaceRoot, "data/digests/2026-08-24.md", "new digest\n");

    await persistDiscordMonitorState({
      workspaceRoot,
      stateRoot,
    });

    assert.equal(
      fs.readFileSync(
        path.join(stateRoot, "data/discord/game-state/2026-08-24/124500000-state.png"),
        "utf8",
      ),
      "fresh upload",
    );
    assert.equal(
      fs.readFileSync(path.join(stateRoot, "data/discord/cursors.json"), "utf8"),
      '{"channel":"new"}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(stateRoot, "data/discord/tips-seen.jsonl"), "utf8"),
      '{"contentHash":"tip"}\n',
    );
    assert.match(
      fs.readFileSync(path.join(stateRoot, "promo-codes.txt"), "utf8"),
      /# --- seeded from main@a1d97c3 ---/,
    );
  });
});
