import { describe, it } from "node:test";
import assert from "node:assert/strict";

// @ts-ignore - untyped .mjs module imported in tests.
const mod = await import("../../scripts/discord-handler.mjs") as {
  runCli: (opts?: {
    env?: Record<string, string | undefined>;
    runGh?: (args: string[]) => Promise<string>;
    runGit?: (args: string[], opts?: { stdin?: string }) => Promise<string>;
    fetchImpl?: (url: string, init?: any) => Promise<any>;
    readFileImpl?: (path: string, enc: string) => Promise<string>;
    writeFileImpl?: (path: string, data: any, enc?: string) => Promise<void>;
    mkdirImpl?: (path: string, opts?: any) => Promise<void>;
    renameImpl?: (from: string, to: string) => Promise<void>;
    rmImpl?: (path: string, opts?: any) => Promise<void>;
    nowFn?: () => Date;
    stdout?: { write: (s: string) => void };
    stderr?: { write: (s: string) => void };
  }) => Promise<number>;
  sanitizeFilename: (s: string) => string;
  updateDailyIndexAtomic: (opts: {
    indexPath: string;
    entry: { filename: string; captured_at: string; uploader: string; note: string; size_bytes: number };
    readFileImpl: (path: string, enc: string) => Promise<string>;
    writeFileImpl: (path: string, data: string, enc?: string) => Promise<void>;
    renameImpl: (from: string, to: string) => Promise<void>;
  }) => Promise<{ files: Array<{ filename: string }> }>;
};

function makeStdout() {
  const chunks: string[] = [];
  return {
    stream: { write: (s: string) => void chunks.push(s) },
    text: () => chunks.join(""),
  };
}

function baseEnv(payload: Record<string, unknown>): Record<string, string> {
  return {
    DISCORD_BOT_TOKEN: "test-token",
    DISCORD_CLIENT_PAYLOAD: JSON.stringify(payload),
    GITHUB_REPOSITORY: "Jamula/stfc",
    GITHUB_REF_NAME: "main",
    GITHUB_SERVER_URL: "https://github.com",
    ALLOWED_GUILD_IDS: "g1,g2",
  };
}

function createHeaders(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? values[name] ?? null;
    },
  };
}

function createMemFs(initial: Record<string, string> = {}) {
  const files = new Map<string, Buffer | string>();
  for (const [k, v] of Object.entries(initial)) files.set(k, v);

  return {
    files,
    async readFile(path: string, _enc: string) {
      if (!files.has(path)) throw new Error("ENOENT");
      const value = files.get(path)!;
      return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    },
    async writeFile(path: string, data: any) {
      files.set(path, Buffer.isBuffer(data) ? data : String(data));
    },
    async mkdir(_path: string, _opts?: any) {
      return;
    },
    async rename(from: string, to: string) {
      if (!files.has(from)) throw new Error("ENOENT");
      const value = files.get(from)!;
      files.delete(from);
      files.set(to, value);
    },
    async rm(path: string, _opts?: any) {
      files.delete(path);
    },
  };
}

function gameStatePayload(overrides: Record<string, unknown> = {}) {
  return {
    command: "game-state",
    interaction_token: "tok",
    application_id: "app",
    guild_id: "g1",
    channel_id: "c1",
    uploader: "12345",
    uploader_handle: "captain@enterprise",
    note: "after raid",
    attachment: {
      url: "https://cdn.discordapp.com/attachments/1/2/test.png",
      filename: "state.png",
      size: 5,
      content_type: "image/png",
    },
    ...overrides,
  };
}

describe("scripts/discord-handler.mjs", () => {
  it("redeem-status command reads history and patches Discord", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({ command: "redeem-status", interaction_token: "tok", application_id: "app" }),
      readFileImpl: async () => [
        "# Redeem history",
        "| Date | Gift |",
        "| --- | --- |",
        "| newest | chest |",
        "| older | chest |",
        "| oldest | chest |",
      ].join("\n"),
      runGh: async () => "",
      runGit: async () => "",
      fetchImpl: async (_url, init: any) => {
        postedBody = String(init.body ?? "");
        return {
          ok: true,
          status: 200,
          text: async () => "{}",
        };
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(code, 0, stderr.text());
    assert.match(postedBody, /Latest redeem history:/);
    assert.match(postedBody, /newest/);
    assert.ok(postedBody.indexOf("newest") < postedBody.indexOf("oldest"));
  });

  it("trigger-redeem command invokes gh and posts run id/link", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    const ghCalls: string[][] = [];
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({
        command: "trigger-redeem",
        interaction_token: "tok",
        application_id: "app",
        guild_id: "g1",
      }),
      readFileImpl: async () => "",
      runGit: async () => "",
      runGh: async (args) => {
        ghCalls.push(args);
        if (args[0] === "workflow") return "";
        return JSON.stringify([
          {
            databaseId: 111111,
            url: "https://github.com/Jamula/stfc/actions/runs/111111",
            createdAt: "2026-06-01T00:00:00Z",
            headBranch: "main",
          },
          {
            databaseId: 123456,
            url: "https://github.com/Jamula/stfc/actions/runs/123456",
            createdAt: "2026-06-02T06:48:00Z",
            headBranch: "main",
          },
        ]);
      },
      fetchImpl: async (_url, init: any) => {
        postedBody = String(init.body ?? "");
        return {
          ok: true,
          status: 200,
          text: async () => "{}",
        };
      },
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(code, 0, stderr.text());
    assert.equal(ghCalls.length, 2, `expected workflow run + run list, got ${ghCalls.length}`);
    assert.equal(ghCalls[0]?.[0], "workflow");
    assert.equal(ghCalls[0]?.[1], "run");
    assert.equal(ghCalls[1]?.[0], "run");
    assert.equal(ghCalls[1]?.[1], "list");
    assert.match(postedBody, /Redeem triggered — run ID 123456/);
    assert.match(postedBody, /actions\/runs\/123456/);
  });

  it("trigger-redeem rejects non-allowlisted guilds before invoking gh", async () => {
    let ghCalled = false;
    const code = await mod.runCli({
      env: baseEnv({
        command: "trigger-redeem",
        interaction_token: "tok",
        application_id: "app",
        guild_id: "attacker-guild",
      }),
      runGh: async () => {
        ghCalled = true;
        return "";
      },
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
      stdout: makeStdout().stream,
      stderr: makeStdout().stream,
    });

    assert.equal(code, 1);
    assert.equal(ghCalled, false);
  });

  it("game-state happy path downloads, commits, and follows up with link", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    const mem = createMemFs();
    const gitCalls: Array<{ args: string[]; stdin?: string }> = [];
    let discordPatch = "";

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload()),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      readFileImpl: mem.readFile,
      writeFileImpl: mem.writeFile,
      mkdirImpl: mem.mkdir,
      renameImpl: mem.rename,
      rmImpl: mem.rm,
      runGh: async () => "",
      runGit: async (args, opts) => {
        gitCalls.push({ args, stdin: opts?.stdin });
        if (args[0] === "rev-parse") return "abc123\n";
        return "";
      },
      fetchImpl: async (url: string, init: any) => {
        if (url.includes("cdn.discordapp.com")) {
          assert.equal(init.redirect, "manual");
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(code, 0, stderr.text());
    assert.match(discordPatch, /📁 Saved https:\/\/github.com\/Jamula\/stfc\/blob\/abc123\/data\/discord\/game-state\/2026-06-02\/064800000-state.png/);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png.lineage.json"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/_index.json"), true);
    const commit = gitCalls.find((c) => c.args[0] === "commit");
    assert.ok(commit?.args.includes("--no-verify"));
    assert.ok(commit?.stdin?.includes("data(game-state): after raid"));
    assert.ok(commit?.stdin?.includes("Source: https://discord.com/channels/g1/c1/..."));
  });

  it("game-state same-second same-name uploads get unique filenames — no collision", async () => {
    const mem = createMemFs();
    const times = [
      new Date("2026-06-02T06:48:00.000Z"),
      new Date("2026-06-02T06:48:00.001Z"),
    ];
    let callIdx = 0;

    const makeUpload = () =>
      mod.runCli({
        env: baseEnv(gameStatePayload()),
        nowFn: () => times[callIdx++]!,
        readFileImpl: mem.readFile,
        writeFileImpl: mem.writeFile,
        mkdirImpl: mem.mkdir,
        renameImpl: mem.rename,
        rmImpl: mem.rm,
        runGh: async () => "",
        runGit: async (args) => {
          if (args[0] === "rev-parse") return "abc123\n";
          return "";
        },
        fetchImpl: async (url: string) => {
          if (url.includes("cdn.discordapp.com")) {
            return {
              ok: true,
              status: 200,
              url,
              headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
              arrayBuffer: async () => Buffer.from("abcde"),
              text: async () => "",
            };
          }
          return { ok: true, status: 200, text: async () => "{}" };
        },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

    // Run sequentially — shared in-memory FS to test _index accumulation
    const code1 = await makeUpload();
    const code2 = await makeUpload();

    assert.equal(code1, 0);
    assert.equal(code2, 0);

    // Both blob files exist — no overwrite
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800001-state.png"), true);

    // Both lineage files exist
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png.lineage.json"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800001-state.png.lineage.json"), true);

    // _index.json accumulates 2 distinct entries
    const indexContent = JSON.parse(await mem.readFile("data/discord/game-state/2026-06-02/_index.json", "utf8"));
    assert.equal(indexContent.files.length, 2);
    const names = indexContent.files.map((f: { filename: string }) => f.filename);
    assert.ok(names.includes("064800000-state.png"), `expected 064800000-state.png in index, got: ${JSON.stringify(names)}`);
    assert.ok(names.includes("064800001-state.png"), `expected 064800001-state.png in index, got: ${JSON.stringify(names)}`);
  });

  it("game-state path traversal filename is sanitized and stays under target folder", async () => {
    const mem = createMemFs();
    const staged: string[] = [];

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload({ attachment: { url: "https://cdn.discordapp.com/a", filename: "../../etc/passwd", size: 5 } })),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      readFileImpl: mem.readFile,
      writeFileImpl: mem.writeFile,
      mkdirImpl: mem.mkdir,
      renameImpl: mem.rename,
      rmImpl: mem.rm,
      runGh: async () => "",
      runGit: async (args) => {
        if (args[0] === "add") staged.push(args[2]!);
        if (args[0] === "rev-parse") return "abc123\n";
        return "";
      },
      fetchImpl: async (url: string) => {
        if (url.includes("cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 0);
    const stagedFile = staged.find((p) => p.endsWith("etcpasswd"));
    assert.ok(stagedFile && stagedFile.startsWith("data/discord/game-state/"));
    assert.equal(staged.some((p) => p.includes("..")), false);
  });

  it("game-state shell metachar filename falls back safely", async () => {
    const clean = mod.sanitizeFilename("';$()<>|\n\r\t");
    assert.equal(clean, "upload.bin");
  });

  it("game-state oversized attachment rejects and does not commit", async () => {
    const gitCalls: string[] = [];
    let discordPatch = "";

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload({ attachment: { url: "https://cdn.discordapp.com/a", filename: "x.png", size: 60 * 1024 * 1024 } })),
      runGh: async () => "",
      runGit: async (args) => {
        gitCalls.push(args[0]!);
        return "";
      },
      fetchImpl: async (_url: string, init: any) => {
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.equal(gitCalls.length, 0);
    assert.match(discordPatch, /❌ attachment exceeds 50MB limit/);
  });

  it("game-state mismatched Content-Length rejects with follow-up and no commit", async () => {
    const gitCalls: string[] = [];
    let discordPatch = "";

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload({ attachment: { url: "https://cdn.discordapp.com/a", filename: "x.png", size: 5 } })),
      runGh: async () => "",
      runGit: async (args) => {
        gitCalls.push(args[0]!);
        return "";
      },
      fetchImpl: async (url: string, init: any) => {
        if (url.includes("cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "4", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcd"),
            text: async () => "",
          };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.equal(gitCalls.length, 0);
    assert.match(discordPatch, /❌ download failed: Content-Length does not match attachment.size/);
  });

  it("game-state rejects non-Discord CDN URL", async () => {
    let discordPatch = "";

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload({ attachment: { url: "https://evil.example.com/a.png", filename: "x.png", size: 5 } })),
      runGh: async () => "",
      runGit: async () => "",
      fetchImpl: async (_url: string, init: any) => {
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.match(discordPatch, /❌ attachment.url must use Discord CDN hostname/);
  });

  it("game-state rejects guilds outside ALLOWED_GUILD_IDS", async () => {
    let discordPatch = "";

    const env = baseEnv(gameStatePayload({ guild_id: "g9" }));
    env.ALLOWED_GUILD_IDS = "g1,g2";

    const code = await mod.runCli({
      env,
      runGh: async () => "",
      runGit: async () => "",
      fetchImpl: async (_url: string, init: any) => {
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.match(discordPatch, /❌ guild is not allowlisted for game-state/);
  });

  it("game-state index update is atomic via temp-file rename", async () => {
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];
    const mem = createMemFs({
      "data/discord/game-state/2026-06-02/_index.json": JSON.stringify({ files: [] }),
    });

    const out = await mod.updateDailyIndexAtomic({
      indexPath: "data/discord/game-state/2026-06-02/_index.json",
      entry: {
        filename: "064800-state.png",
        captured_at: "2026-06-02T06:48:00Z",
        uploader: "captain",
        note: "test",
        size_bytes: 5,
      },
      readFileImpl: mem.readFile,
      writeFileImpl: async (p, d) => {
        writes.push(p);
        await mem.writeFile(p, d);
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
        await mem.rename(from, to);
      },
    });

    assert.equal(writes.some((p) => p.endsWith("_index.json.tmp")), true);
    assert.deepEqual(renames, [{ from: "data/discord/game-state/2026-06-02/_index.json.tmp", to: "data/discord/game-state/2026-06-02/_index.json" }]);
    assert.equal(out.files.length, 1);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/_index.json.tmp"), false);
  });

  it("game-state push race retries with fetch+rebase once", async () => {
    const mem = createMemFs();
    const calls: string[][] = [];
    let pushAttempts = 0;

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload()),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      readFileImpl: mem.readFile,
      writeFileImpl: mem.writeFile,
      mkdirImpl: mem.mkdir,
      renameImpl: mem.rename,
      rmImpl: mem.rm,
      runGh: async () => "",
      runGit: async (args) => {
        calls.push(args);
        if (args[0] === "push") {
          pushAttempts += 1;
          if (pushAttempts === 1) throw new Error("git push failed: non-fast-forward");
        }
        if (args[0] === "rev-parse") return "abc123\n";
        return "";
      },
      fetchImpl: async (url: string) => {
        if (url.includes("cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 0);
    assert.equal(pushAttempts, 2);
    assert.equal(calls.some((a) => a[0] === "fetch" && a[2] === "main"), true);
    assert.equal(calls.some((a) => a[0] === "rebase" && a[1] === "origin/main"), true);
  });

  it("unknown command returns a helpful unknown message", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({ command: "not-a-real-command", interaction_token: "tok", application_id: "app" }),
      readFileImpl: async () => "",
      runGh: async () => {
        throw new Error("should not call gh for unknown command");
      },
      runGit: async () => "",
      fetchImpl: async (_url, init: any) => {
        postedBody = String(init.body ?? "");
        return {
          ok: true,
          status: 200,
          text: async () => "{}",
        };
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(code, 0, stderr.text());
    assert.match(postedBody, /Unknown command: not-a-real-command/);
  });

  it("Discord PATCH 5xx causes non-zero exit", async () => {
    const code = await mod.runCli({
      env: baseEnv({ command: "redeem-status", interaction_token: "tok", application_id: "app" }),
      readFileImpl: async () => "line1",
      runGh: async () => "",
      runGit: async () => "",
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: "Internal error", code: 50013 }),
      }),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
  });

  it("missing payload fields fail clearly", async () => {
    const stderr = makeStdout();

    const code = await mod.runCli({
      env: baseEnv({ command: "redeem-status", interaction_token: "tok" }),
      readFileImpl: async () => "",
      runGh: async () => "",
      runGit: async () => "",
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
      stdout: { write: () => {} },
      stderr: stderr.stream,
    });

    assert.equal(code, 1);
    assert.match(stderr.text(), /Missing required client_payload field\(s\): application_id/);
  });
});
