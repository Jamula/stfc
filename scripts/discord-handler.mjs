#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const execFileAsync = promisify(execFile);
const DISCORD_API_BASE = "https://discord.com/api/v10";

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("client_payload must be a JSON object");
  }

  const required = ["command", "interaction_token", "application_id"];
  const missing = required.filter((key) => typeof payload[key] !== "string" || payload[key].length === 0);
  if (missing.length > 0) {
    throw new Error(`Missing required client_payload field(s): ${missing.join(", ")}`);
  }
}

export function formatRedeemStatus(historyContent, maxLines = 10) {
  const lines = historyContent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-maxLines);

  if (lines.length === 0) {
    return "No redemption history is available yet.";
  }

  return [
    "Latest redeem history:",
    "```text",
    ...lines,
    "```",
  ].join("\n");
}

export async function triggerRedeemWorkflow({ runGh = defaultRunGh, repo, ref, serverUrl = "https://github.com" }) {
  await runGh(["workflow", "run", "redeem.yml", "--repo", repo, "--ref", ref]);

  for (let attempt = 0; attempt < 5; attempt++) {
    const out = await runGh([
      "run",
      "list",
      "--workflow",
      "redeem.yml",
      "--event",
      "workflow_dispatch",
      "--limit",
      "1",
      "--json",
      "databaseId,url",
      "--repo",
      repo,
    ]);
    const runs = JSON.parse(out || "[]");
    if (Array.isArray(runs) && runs[0]?.databaseId) {
      const runId = String(runs[0].databaseId);
      const runUrl = typeof runs[0].url === "string" && runs[0].url.length > 0
        ? runs[0].url
        : `${serverUrl}/${repo}/actions/runs/${runId}`;
      return { runId, runUrl };
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error("Redeem workflow dispatch succeeded, but run ID was not discoverable yet");
}

export async function postDiscordFollowup({ applicationId, interactionToken, content, botToken, fetchImpl = fetch }) {
  const url = `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const response = await fetchImpl(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  const bodyText = await response.text();
  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = parsed && typeof parsed.message === "string" ? parsed.message : bodyText;
    const code = parsed && typeof parsed.code !== "undefined" ? ` code=${parsed.code}` : "";
    throw new Error(`Discord PATCH failed: status=${response.status}${code} message=${String(message).slice(0, 300)}`);
  }

  return parsed;
}

export async function resolveResponseText({ payload, repo, ref, serverUrl, historyPath, runGh, readFileImpl }) {
  const command = payload.command;

  if (command === "redeem-status") {
    const history = await readFileImpl(historyPath, "utf8");
    return formatRedeemStatus(history);
  }

  if (command === "trigger-redeem") {
    const { runId, runUrl } = await triggerRedeemWorkflow({ runGh, repo, ref, serverUrl });
    return `Redeem triggered — run ID ${runId}\n${runUrl}`;
  }

  return `Unknown command: ${command}`;
}

export async function runCli({
  env = process.env,
  runGh = defaultRunGh,
  fetchImpl = fetch,
  readFileImpl = readFile,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    if (!env.DISCORD_BOT_TOKEN) {
      throw new Error("DISCORD_BOT_TOKEN env var not set");
    }
    if (!env.DISCORD_CLIENT_PAYLOAD) {
      throw new Error("DISCORD_CLIENT_PAYLOAD env var not set");
    }

    const payload = JSON.parse(env.DISCORD_CLIENT_PAYLOAD);
    validatePayload(payload);

    const repo = env.GITHUB_REPOSITORY;
    if (!repo) throw new Error("GITHUB_REPOSITORY env var not set");

    const ref = env.GITHUB_REF_NAME || "main";
    const serverUrl = env.GITHUB_SERVER_URL || "https://github.com";
    const historyPath = env.REDEEM_HISTORY_PATH || "docs/redeem-history.md";

    const responseText = await resolveResponseText({
      payload,
      repo,
      ref,
      serverUrl,
      historyPath,
      runGh,
      readFileImpl,
    });

    await postDiscordFollowup({
      applicationId: payload.application_id,
      interactionToken: payload.interaction_token,
      content: responseText,
      botToken: env.DISCORD_BOT_TOKEN,
      fetchImpl,
    });

    stdout.write(`Handled command: ${payload.command}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

async function defaultRunGh(args) {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    const suffix = stderr.length > 0 ? `: ${stderr}` : "";
    throw new Error(`gh ${args.join(" ")} failed${suffix}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("discord-handler.mjs");
if (isMain) {
  runCli().then((code) => process.exit(code));
}
