import { describe, it } from "node:test";
import assert from "node:assert/strict";

// @ts-ignore - untyped .mjs module imported in tests.
const mod = await import("../../scripts/discord-handler.mjs") as {
  runCli: (opts?: {
    env?: Record<string, string | undefined>;
    runGh?: (args: string[]) => Promise<string>;
    fetchImpl?: (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
    readFileImpl?: (path: string, enc: string) => Promise<string>;
    stdout?: { write: (s: string) => void };
    stderr?: { write: (s: string) => void };
  }) => Promise<number>;
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
  };
}

describe("scripts/discord-handler.mjs", () => {
  it("redeem-status command reads history and patches Discord", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({ command: "redeem-status", interaction_token: "tok", application_id: "app" }),
      readFileImpl: async () => "line1\nline2\nline3\n",
      runGh: async () => "",
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
    assert.match(postedBody, /line3/);
  });

  it("trigger-redeem command invokes gh and posts run id/link", async () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    const ghCalls: string[][] = [];
    let postedBody = "";

    const code = await mod.runCli({
      env: baseEnv({ command: "trigger-redeem", interaction_token: "tok", application_id: "app" }),
      readFileImpl: async () => "",
      runGh: async (args) => {
        ghCalls.push(args);
        if (args[0] === "workflow") return "";
        return JSON.stringify([{ databaseId: 123456, url: "https://github.com/Jamula/stfc/actions/runs/123456" }]);
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
    assert.equal(ghCalls.length, 2, `expected workflow run + run list, got ${ghCalls.length}`);
    assert.equal(ghCalls[0]?.[0], "workflow");
    assert.equal(ghCalls[0]?.[1], "run");
    assert.equal(ghCalls[1]?.[0], "run");
    assert.equal(ghCalls[1]?.[1], "list");
    assert.match(postedBody, /Redeem triggered — run ID 123456/);
    assert.match(postedBody, /actions\/runs\/123456/);
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
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
      stdout: { write: () => {} },
      stderr: stderr.stream,
    });

    assert.equal(code, 1);
    assert.match(stderr.text(), /Missing required client_payload field\(s\): application_id/);
  });
});
