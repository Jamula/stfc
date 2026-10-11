import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// @ts-ignore - untyped .mjs module imported in tests.
const mod = await import("../../scripts/discord-handler.mjs") as {
  runCli: (opts?: {
    env?: Record<string, string | undefined>;
    runGh?: (args: string[]) => Promise<string>;
    runGit?: (args: string[], opts?: { stdin?: string }) => Promise<string>;
    reconcileAutomationStateImpl?: (args: {
      stateDir: string;
      ref: string;
      relativePaths: string[];
    }) => Promise<string>;
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
  updateDailyManifestAtomic: (opts: {
    manifestPath: string;
    entry: { filename: string; r2_bucket?: string; r2_key: string; sha256: string; size_bytes: number };
    readFileImpl: (path: string, enc: string) => Promise<string>;
    writeFileImpl: (path: string, data: string, enc?: string) => Promise<void>;
    renameImpl: (from: string, to: string) => Promise<void>;
  }) => Promise<{ files: Array<{ filename: string; r2_key: string }> }>;
  uploadR2Object: (opts: {
    config: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
    key: string;
    buffer: Buffer;
    contentType?: string;
    fetchImpl: (url: string, init: any) => Promise<any>;
    now: Date;
    timeoutMs?: number;
  }) => Promise<{ bucket: string; key: string; sha256: string; size: number }>;
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
    STFC_STATE_BRANCH: "automation-state",
    GITHUB_SERVER_URL: "https://github.com",
    ALLOWED_GUILD_IDS: "g1,g2",
    CLOUDFLARE_ACCOUNT_ID: "account123",
    CLOUDFLARE_R2_ACCESS_KEY_ID: "r2-access-key",
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: "r2-secret-key",
  };
}

function fsError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function createHeaders(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? values[name] ?? null;
    },
  };
}

function isHost(rawUrl: string, hostname: string): boolean {
  return new URL(rawUrl).hostname === hostname;
}

function createMemFs(initial: Record<string, string> = {}) {
  const files = new Map<string, Buffer | string>();
  for (const [k, v] of Object.entries(initial)) files.set(k, v);

  return {
    files,
    async readFile(path: string, _enc: string) {
      if (!files.has(path)) throw fsError("ENOENT");
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
      if (!files.has(from)) throw fsError("ENOENT");
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
  it("scans staged game-state artifacts before bypassing commit hooks", () => {
    const source = readFileSync("scripts/discord-handler.mjs", "utf8");
    const scanAt = source.indexOf('check-artifact-hygiene.mjs');
    const commitAt = source.indexOf('["commit", "--no-verify"');
    assert.ok(scanAt >= 0);
    assert.ok(commitAt > scanAt);
  });

  it("pins the automation-state push hook bypass in source", () => {
    const source = readFileSync("scripts/discord-handler.mjs", "utf8");
    assert.ok(source.includes('["push", "--no-verify", "origin", `HEAD:${ref}`]'));
  });

  it("redeem-status command reads history and patches Discord", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    let postedBody = "";
    const gitCalls: string[][] = [];

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
      runGit: async (args) => {
        gitCalls.push(args);
        return "";
      },
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
    // Garak (PR #250 review, round 2): /redeem-status may only be exempted
    // from the shared stfc-gift-redeemer writer lock if it never writes
    // automation-state itself — prove it here instead of just asserting it.
    assert.deepEqual(gitCalls, [], "redeem-status must not touch git at all");
  });

  it("trigger-redeem command invokes gh and posts run id/link", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    const ghCalls: string[][] = [];
    const gitCalls: string[][] = [];
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({
        command: "trigger-redeem",
        interaction_token: "tok",
        application_id: "app",
        guild_id: "g1",
      }),
      readFileImpl: async () => "",
      runGit: async (args) => {
        gitCalls.push(args);
        return "";
      },
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
    assert.deepEqual(ghCalls[0]?.slice(-2), ["--ref", "main"]);
    assert.equal(ghCalls[1]?.[0], "run");
    assert.equal(ghCalls[1]?.[1], "list");
    assert.match(postedBody, /Redeem triggered — run ID 123456/);
    assert.match(postedBody, /actions\/runs\/123456/);
    // Garak (PR #250 review, round 2): /trigger-redeem may only be exempted
    // from the shared stfc-gift-redeemer writer lock if it never writes
    // automation-state itself — it only dispatches redeem.yml (which is
    // already serialized under that lock) via gh, not git.
    assert.deepEqual(gitCalls, [], "trigger-redeem must not touch git at all");
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
    let r2Put: { url: string; init: any } | undefined;

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
        if (isHost(url, "cdn.discordapp.com")) {
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
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          r2Put = { url, init };
          return { ok: true, status: 200, text: async () => "" };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(code, 0, stderr.text());
    assert.match(discordPatch, /📁 Saved https:\/\/github.com\/Jamula\/stfc\/blob\/abc123\/data\/discord\/game-state\/2026-06-02\/manifest.json/);
    assert.match(discordPatch, /R2 key: 2026-06-02\/064800000-state.png/);
    assert.equal(r2Put?.url, "https://account123.r2.cloudflarestorage.com/stfc-game-state/2026-06-02/064800000-state.png");
    assert.equal(r2Put?.init.method, "PUT");
    assert.equal(
      r2Put?.init.headers.Authorization,
      "AWS4-HMAC-SHA256 Credential=r2-access-key/20260602/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=fc43e1fe994eeb2aef0c73efdfa716df2e383b0b45aba1630e849e5ae7271cea",
    );
    assert.equal(r2Put?.init.headers["x-amz-date"], "20260602T064800Z");
    assert.equal(
      r2Put?.init.headers["x-amz-content-sha256"],
      "36bbe50ed96841d10443bcb670d6554f0a34b761be67ec9c4a8ad2c0c44ca42c",
    );
    assert.ok(r2Put?.init.signal instanceof AbortSignal);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png"), false);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png.lineage.json"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/_index.json"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/manifest.json"), true);
    const manifest = JSON.parse(await mem.readFile("data/discord/game-state/2026-06-02/manifest.json", "utf8"));
    assert.equal(manifest.bucket, "stfc-game-state");
    assert.equal(manifest.files[0].r2_key, "2026-06-02/064800000-state.png");
    assert.equal(manifest.files[0].sha256, "36bbe50ed96841d10443bcb670d6554f0a34b761be67ec9c4a8ad2c0c44ca42c");
    assert.equal(manifest.files[0].access, "signed-url-required");
    const lineage = JSON.parse(await mem.readFile("data/discord/game-state/2026-06-02/064800000-state.png.lineage.json", "utf8"));
    assert.equal(lineage.r2_key, "2026-06-02/064800000-state.png");
    assert.equal(lineage.sha256, manifest.files[0].sha256);
    assert.equal(
      gitCalls.some((c) => c.args[0] === "add" && c.args[2] === "data/discord/game-state/2026-06-02/064800000-state.png"),
      false,
      "binary blob must not be staged",
    );
    assert.deepEqual(
      gitCalls.filter((c) => c.args[0] === "add").map((c) => c.args[2]).sort(),
      [
        "data/discord/game-state/2026-06-02/064800000-state.png.lineage.json",
        "data/discord/game-state/2026-06-02/_index.json",
        "data/discord/game-state/2026-06-02/manifest.json",
      ],
    );
    const commit = gitCalls.find((c) => c.args[0] === "commit");
    assert.ok(commit?.args.includes("--no-verify"));
    assert.ok(commit?.stdin?.includes("data(game-state): after raid"));
    assert.ok(commit?.stdin?.includes("Manifest: data/discord/game-state/2026-06-02/manifest.json"));
    assert.ok(commit?.stdin?.includes("R2: stfc-game-state/2026-06-02/064800000-state.png"));
    assert.ok(commit?.stdin?.includes("Source: https://discord.com/channels/g1/c1/..."));
    assert.deepEqual(
      gitCalls.find((c) => c.args[0] === "push")?.args,
      ["push", "--no-verify", "origin", "HEAD:automation-state"],
    );
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
          if (isHost(url, "cdn.discordapp.com")) {
            return {
              ok: true,
              status: 200,
              url,
              headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
              arrayBuffer: async () => Buffer.from("abcde"),
              text: async () => "",
            };
          }
          if (isHost(url, "account123.r2.cloudflarestorage.com")) {
            return { ok: true, status: 200, text: async () => "" };
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

    // Binary blobs are not committed locally — R2 keys differ, so no overwrite.
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png"), false);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800001-state.png"), false);

    // Both lineage files exist
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800000-state.png.lineage.json"), true);
    assert.equal(mem.files.has("data/discord/game-state/2026-06-02/064800001-state.png.lineage.json"), true);

    // _index.json accumulates 2 distinct entries
    const indexContent = JSON.parse(await mem.readFile("data/discord/game-state/2026-06-02/_index.json", "utf8"));
    assert.equal(indexContent.files.length, 2);
    const names = indexContent.files.map((f: { filename: string }) => f.filename);
    assert.ok(names.includes("064800000-state.png"), `expected 064800000-state.png in index, got: ${JSON.stringify(names)}`);
    assert.ok(names.includes("064800001-state.png"), `expected 064800001-state.png in index, got: ${JSON.stringify(names)}`);
    const manifestContent = JSON.parse(await mem.readFile("data/discord/game-state/2026-06-02/manifest.json", "utf8"));
    assert.deepEqual(
      manifestContent.files.map((f: { r2_key: string }) => f.r2_key),
      ["2026-06-02/064800000-state.png", "2026-06-02/064800001-state.png"],
    );
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
        if (isHost(url, "cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 0);
    const stagedFile = staged.find((p) => p.endsWith("etcpasswd.lineage.json"));
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

  it("game-state missing R2 secrets rejects before download, upload, or git", async () => {
    const env = baseEnv(gameStatePayload());
    delete env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const gitCalls: string[] = [];
    const fetchedHosts: string[] = [];
    let discordPatch = "";

    const code = await mod.runCli({
      env,
      runGh: async () => "",
      runGit: async (args) => {
        gitCalls.push(args[0]!);
        return "";
      },
      fetchImpl: async (url: string, init: any) => {
        fetchedHosts.push(new URL(url).hostname);
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.deepEqual(gitCalls, []);
    assert.deepEqual(fetchedHosts, ["discord.com"]);
    assert.match(discordPatch, /❌ Missing required R2 env var\(s\): CLOUDFLARE_R2_SECRET_ACCESS_KEY/);
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
        if (isHost(url, "cdn.discordapp.com")) {
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

  it("game-state R2 upload failures reject with follow-up and no commit", async () => {
    const gitCalls: string[] = [];
    let discordPatch = "";

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload()),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      runGh: async () => "",
      runGit: async (args) => {
        gitCalls.push(args[0]!);
        return "";
      },
      fetchImpl: async (url: string, init: any) => {
        if (isHost(url, "cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          return { ok: false, status: 403, text: async () => "forbidden" };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.equal(gitCalls.length, 0);
    assert.match(discordPatch, /❌ R2 upload failed: status 403 forbidden/);
  });

  it("game-state daily caps are checked before downloading or uploading", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const mem = createMemFs({
      [indexPath]: JSON.stringify({
        files: Array.from({ length: 20 }, (_, index) => ({
          filename: `existing-${index}.png`,
          size_bytes: 1,
        })),
      }),
    });
    let r2Requests = 0;
    let discordPatch = "";

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload()),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      readFileImpl: mem.readFile,
      writeFileImpl: mem.writeFile,
      mkdirImpl: mem.mkdir,
      renameImpl: mem.rename,
      rmImpl: mem.rm,
      runGit: async () => "",
      fetchImpl: async (url: string, init: any) => {
        if (isHost(url, "cdn.discordapp.com")) {
          throw new Error("attachment must not be downloaded after cap rejection");
        }
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          r2Requests += 1;
          return { ok: true, status: 200, text: async () => "" };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.equal(r2Requests, 0);
    assert.match(discordPatch, /daily file cap exceeded \(20 files\)/);
  });

  it("game-state removes an uploaded R2 object if metadata persistence fails", async () => {
    const mem = createMemFs();
    const methods: string[] = [];
    let discordPatch = "";
    const gitCalls: string[][] = [];

    const code = await mod.runCli({
      env: baseEnv(gameStatePayload()),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      readFileImpl: mem.readFile,
      writeFileImpl: async (filePath, data) => {
        if (filePath.endsWith(".lineage.json")) {
          throw fsError("EIO", "disk write failed");
        }
        await mem.writeFile(filePath, data);
      },
      mkdirImpl: mem.mkdir,
      renameImpl: mem.rename,
      rmImpl: mem.rm,
      runGit: async (args) => {
        gitCalls.push(args);
        return "";
      },
      fetchImpl: async (url: string, init: any) => {
        if (isHost(url, "cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          methods.push(init.method);
          return { ok: true, status: init.method === "DELETE" ? 204 : 200, text: async () => "" };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.deepEqual(methods, ["PUT", "DELETE"]);
    assert.deepEqual(gitCalls, []);
    assert.match(discordPatch, /❌ disk write failed/);
  });

  it("game-state reports both persistence and R2 cleanup failures", async () => {
    let discordPatch = "";
    const code = await mod.runCli({
      env: baseEnv(gameStatePayload()),
      nowFn: () => new Date("2026-06-02T06:48:00Z"),
      readFileImpl: createMemFs().readFile,
      writeFileImpl: async (filePath) => {
        if (filePath.endsWith(".lineage.json")) throw fsError("EIO", "disk write failed");
      },
      mkdirImpl: async () => {},
      runGit: async () => "",
      fetchImpl: async (url: string, init: any) => {
        if (isHost(url, "cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          return init.method === "DELETE"
            ? { ok: false, status: 403, text: async () => "delete denied" }
            : { ok: true, status: 200, text: async () => "" };
        }
        discordPatch = String(init.body ?? "");
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.match(discordPatch, /disk write failed/);
    assert.match(discordPatch, /R2 cleanup failed: status 403 delete denied/);
  });

  it("game-state R2 uploads time out and abort their network request", async () => {
    await assert.rejects(
      mod.uploadR2Object({
        config: {
          accountId: "account123",
          accessKeyId: "r2-access-key",
          secretAccessKey: "r2-secret-key",
          bucket: "stfc-game-state",
        },
        key: "2026-06-02/state.png",
        buffer: Buffer.from("abcde"),
        contentType: "image/png",
        now: new Date("2026-06-02T06:48:00Z"),
        timeoutMs: 5,
        fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("request aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        }),
      }),
      /R2 upload failed: request timed out/,
    );
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

  it("game-state index starts fresh when the index is missing", async () => {
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];
    let tempContent = "";
    const entry = {
      filename: "064800-state.png",
      captured_at: "2026-06-02T06:48:00Z",
      uploader: "captain",
      note: "test",
      size_bytes: 5,
    };

    const out = await mod.updateDailyIndexAtomic({
      indexPath: "data/discord/game-state/2026-06-02/_index.json",
      entry,
      readFileImpl: async () => {
        throw fsError("ENOENT");
      },
      writeFileImpl: async (path, data) => {
        writes.push(path);
        tempContent = data;
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
      },
    });

    assert.deepEqual(out.files, [entry]);
    assert.deepEqual(writes, ["data/discord/game-state/2026-06-02/_index.json.tmp"]);
    assert.deepEqual(renames, [{
      from: "data/discord/game-state/2026-06-02/_index.json.tmp",
      to: "data/discord/game-state/2026-06-02/_index.json",
    }]);
    assert.deepEqual(JSON.parse(tempContent), { files: [entry] });
  });

  it("game-state manifest starts fresh only when the manifest is missing", async () => {
    let tempContent = "";
    const entry = {
      filename: "064800-state.png",
      r2_bucket: "stfc-game-state",
      r2_key: "2026-06-02/064800-state.png",
      sha256: "abc123",
      size_bytes: 5,
    };
    const out = await mod.updateDailyManifestAtomic({
      manifestPath: "data/discord/game-state/2026-06-02/manifest.json",
      entry,
      readFileImpl: async () => {
        throw fsError("ENOENT");
      },
      writeFileImpl: async (_path, data) => {
        tempContent = data;
      },
      renameImpl: async () => {},
    });

    assert.deepEqual(out.files, [entry]);
    assert.deepEqual(JSON.parse(tempContent), {
      version: 1,
      bucket: "stfc-game-state",
      files: [entry],
    });
  });

  it("game-state manifest preserves malformed content and propagates read errors", async () => {
    const manifestPath = "data/discord/game-state/2026-06-02/manifest.json";
    const original = "{ malformed";
    const writes: string[] = [];
    const renames: string[] = [];
    const entry = {
      filename: "064800-state.png",
      r2_bucket: "stfc-game-state",
      r2_key: "2026-06-02/064800-state.png",
      sha256: "abc123",
      size_bytes: 5,
    };

    await assert.rejects(mod.updateDailyManifestAtomic({
      manifestPath,
      entry,
      readFileImpl: async () => original,
      writeFileImpl: async (filePath) => {
        writes.push(filePath);
      },
      renameImpl: async (from, to) => {
        renames.push(`${from}:${to}`);
      },
    }), SyntaxError);
    await assert.rejects(mod.updateDailyManifestAtomic({
      manifestPath,
      entry,
      readFileImpl: async () => {
        throw fsError("EIO", "manifest read failed");
      },
      writeFileImpl: async (filePath) => {
        writes.push(filePath);
      },
      renameImpl: async (from, to) => {
        renames.push(`${from}:${to}`);
      },
    }), /manifest read failed/);

    assert.deepEqual(writes, []);
    assert.deepEqual(renames, []);
  });

  it("game-state manifest rejects a document without a files array", async () => {
    const writes: string[] = [];
    await assert.rejects(mod.updateDailyManifestAtomic({
      manifestPath: "data/discord/game-state/2026-06-02/manifest.json",
      entry: {
        filename: "064800-state.png",
        r2_bucket: "stfc-game-state",
        r2_key: "2026-06-02/064800-state.png",
        sha256: "abc123",
        size_bytes: 5,
      },
      readFileImpl: async () => JSON.stringify({ entries: [] }),
      writeFileImpl: async (filePath) => {
        writes.push(filePath);
      },
      renameImpl: async () => {},
    }), /daily manifest is malformed: expected a files array/);

    assert.deepEqual(writes, []);
  });

  it("game-state index preserves malformed JSON without writing", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const original = "{ malformed";
    const mem = createMemFs({ [indexPath]: original });
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    await assert.rejects(mod.updateDailyIndexAtomic({
      indexPath,
      entry: {
        filename: "064800-state.png",
        captured_at: "2026-06-02T06:48:00Z",
        uploader: "captain",
        note: "test",
        size_bytes: 5,
      },
      readFileImpl: mem.readFile,
      writeFileImpl: async (path) => {
        writes.push(path);
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
      },
    }), SyntaxError);

    assert.equal(mem.files.get(indexPath), original);
    assert.deepEqual(writes, []);
    assert.deepEqual(renames, []);
  });

  it("game-state index preserves existing data when reading fails for a reason other than ENOENT", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const original = JSON.stringify({ files: [{ filename: "existing.png", size_bytes: 5 }] });
    const mem = createMemFs({ [indexPath]: original });
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    await assert.rejects(mod.updateDailyIndexAtomic({
      indexPath,
      entry: {
        filename: "064800-state.png",
        captured_at: "2026-06-02T06:48:00Z",
        uploader: "captain",
        note: "test",
        size_bytes: 5,
      },
      readFileImpl: async () => {
        throw fsError("EIO", "disk read failed");
      },
      writeFileImpl: async (path) => {
        writes.push(path);
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
      },
    }), /disk read failed/);

    assert.equal(mem.files.get(indexPath), original);
    assert.deepEqual(writes, []);
    assert.deepEqual(renames, []);
  });

  it("game-state index rejects a valid JSON document without a files array", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const original = JSON.stringify({ entries: [] });
    const mem = createMemFs({ [indexPath]: original });
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    await assert.rejects(mod.updateDailyIndexAtomic({
      indexPath,
      entry: {
        filename: "064800-state.png",
        captured_at: "2026-06-02T06:48:00Z",
        uploader: "captain",
        note: "test",
        size_bytes: 5,
      },
      readFileImpl: mem.readFile,
      writeFileImpl: async (path) => {
        writes.push(path);
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
      },
    }), /daily index is malformed: expected a files array/);

    assert.equal(mem.files.get(indexPath), original);
    assert.deepEqual(writes, []);
    assert.deepEqual(renames, []);
  });

  it("game-state index file cap uses the existing manifest", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const existingFiles = Array.from({ length: 20 }, (_, index) => ({
      filename: `existing-${index}.png`,
      size_bytes: 1,
    }));
    const original = JSON.stringify({ files: existingFiles });
    const mem = createMemFs({ [indexPath]: original });
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    await assert.rejects(mod.updateDailyIndexAtomic({
      indexPath,
      entry: {
        filename: "064800-state.png",
        captured_at: "2026-06-02T06:48:00Z",
        uploader: "captain",
        note: "test",
        size_bytes: 5,
      },
      readFileImpl: mem.readFile,
      writeFileImpl: async (path) => {
        writes.push(path);
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
      },
    }), /daily file cap exceeded \(20 files\)/);

    assert.equal(mem.files.get(indexPath), original);
    assert.deepEqual(writes, []);
    assert.deepEqual(renames, []);
  });

  it("game-state index byte cap uses the existing manifest", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const original = JSON.stringify({
      files: [{ filename: "existing.png", size_bytes: 100 * 1024 * 1024 }],
    });
    const mem = createMemFs({ [indexPath]: original });
    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    await assert.rejects(mod.updateDailyIndexAtomic({
      indexPath,
      entry: {
        filename: "064800-state.png",
        captured_at: "2026-06-02T06:48:00Z",
        uploader: "captain",
        note: "test",
        size_bytes: 1,
      },
      readFileImpl: mem.readFile,
      writeFileImpl: async (path) => {
        writes.push(path);
      },
      renameImpl: async (from, to) => {
        renames.push({ from, to });
      },
    }), /daily byte cap exceeded \(104857600 bytes\)/);

    assert.equal(mem.files.get(indexPath), original);
    assert.deepEqual(writes, []);
    assert.deepEqual(renames, []);
  });

  it("game-state index rejects entries that cannot be counted safely", async () => {
    const indexPath = "data/discord/game-state/2026-06-02/_index.json";
    const malformedManifests = [
      {
        name: "null entries",
        raw: JSON.stringify({ files: Array.from({ length: 20 }, () => null) }),
      },
      {
        name: "missing size_bytes",
        raw: JSON.stringify({ files: [{ filename: "missing-size.png" }] }),
      },
      {
        name: "string size_bytes",
        raw: JSON.stringify({ files: [{ filename: "string-size.png", size_bytes: "5" }] }),
      },
      {
        name: "non-finite size_bytes",
        raw: '{"files":[{"filename":"infinite-size.png","size_bytes":1e400}]}',
      },
      {
        name: "negative size_bytes",
        raw: JSON.stringify({ files: [{ filename: "negative-size.png", size_bytes: -1 }] }),
      },
    ];

    for (const malformed of malformedManifests) {
      const mem = createMemFs({ [indexPath]: malformed.raw });
      const writes: string[] = [];
      const renames: Array<{ from: string; to: string }> = [];

      await assert.rejects(mod.updateDailyIndexAtomic({
        indexPath,
        entry: {
          filename: "064800-state.png",
          captured_at: "2026-06-02T06:48:00Z",
          uploader: "captain",
          note: "test",
          size_bytes: 5,
        },
        readFileImpl: mem.readFile,
        writeFileImpl: async (path) => {
          writes.push(path);
        },
        renameImpl: async (from, to) => {
          renames.push({ from, to });
        },
      }), /daily index is malformed: invalid file entry/);

      assert.equal(mem.files.get(indexPath), malformed.raw, malformed.name);
      assert.deepEqual(writes, [], malformed.name);
      assert.deepEqual(renames, [], malformed.name);
    }
  });

  it("game-state push race retries and preserves the upload commit", async () => {
    const mem = createMemFs();
    const calls: string[][] = [];
    let pushAttempts = 0;
    const reconcileCalls: Array<{ stateDir: string; ref: string; relativePaths: string[] }> = [];

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
      reconcileAutomationStateImpl: async (args) => {
        reconcileCalls.push(args);
        return "replayed";
      },
      fetchImpl: async (url: string) => {
        if (isHost(url, "cdn.discordapp.com")) {
          return {
            ok: true,
            status: 200,
            url,
            headers: createHeaders({ "content-length": "5", "content-type": "image/png" }),
            arrayBuffer: async () => Buffer.from("abcde"),
            text: async () => "",
          };
        }
        if (isHost(url, "account123.r2.cloudflarestorage.com")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => "{}" };
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });

    assert.equal(code, 0);
    assert.equal(pushAttempts, 2);
    assert.equal(reconcileCalls.length, 1);
    assert.equal(reconcileCalls[0]?.ref, "automation-state");
    assert.deepEqual(reconcileCalls[0]?.relativePaths.sort(), [
      "data/discord/game-state/2026-06-02/064800000-state.png.lineage.json",
      "data/discord/game-state/2026-06-02/_index.json",
      "data/discord/game-state/2026-06-02/manifest.json",
    ]);
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

  it("case-variant game-state over-serializes on the writer lock but still cannot write", async () => {
    // GitHub's `==` and its concurrency group names are case-insensitive, so
    // `GAME-STATE` resolves to the shared stfc-gift-redeemer group (it
    // over-serializes rather than escaping the lock). The handler dispatches
    // on exact lower-case strings, so it must refuse to write for it —
    // that is what makes the over-serialization harmless (Garak, PR #266).
    const stdout = makeStdout();
    const stderr = makeStdout();
    const gitCalls: string[][] = [];
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({ ...gameStatePayload(), command: "GAME-STATE" }),
      readFileImpl: async () => "",
      runGh: async () => {
        throw new Error("should not call gh for an unknown command");
      },
      runGit: async (args) => {
        gitCalls.push(args);
        return "";
      },
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
    assert.match(postedBody, /Unknown command: GAME-STATE/);
    assert.deepEqual(gitCalls, [], "a case-variant command must never reach git");
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
