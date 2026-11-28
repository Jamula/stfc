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
  it("preserves a concurrent /game-state upload when the monitor later persists its own state", async () => {
    const restoreRoot = makeScratchDir("discord-monitor-restore");
    const workspaceRoot = makeScratchDir("discord-monitor-workspace");
    const stateRoot = makeScratchDir("discord-monitor-state");

    writeFile(restoreRoot, "data/discord/cursors.json", '{"channel":"old"}\n');
    writeFile(restoreRoot, "data/discord/candidates.jsonl", '{"value":"OLD"}\n');
    writeFile(restoreRoot, "data/discord/cooldowns.json", '{}\n');
    writeFile(restoreRoot, "data/discord/command-acks.json", '{"channel":["message"]}\n');
    writeFile(restoreRoot, "data/digests/2026-08-24.md", "old digest\n");
    writeFile(restoreRoot, "promo-codes.txt", "STATECODE\n");
    writeFile(workspaceRoot, "promo-codes.txt", "MAINCODE\n");

    await restoreDiscordMonitorState({
      restoreRoot,
      workspaceRoot,
      mainRef: "a1d97c3",
    });
    assert.equal(
      fs.readFileSync(path.join(workspaceRoot, "data/discord/command-acks.json"), "utf8"),
      '{"channel":["message"]}\n',
    );

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
    writeFile(workspaceRoot, "data/discord/command-acks.json", '{"channel":["next"]}\n');
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
    assert.equal(
      fs.readFileSync(path.join(stateRoot, "data/discord/command-acks.json"), "utf8"),
      '{"channel":["next"]}\n',
    );
    assert.match(
      fs.readFileSync(path.join(stateRoot, "promo-codes.txt"), "utf8"),
      /# --- seeded from main@a1d97c3 ---/,
    );
  });
});
