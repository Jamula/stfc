#!/usr/bin/env node

import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { reconcileAutomationStateAfterPushFailure } from "./automation-state-retry.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DISCORD_API_BASE = "https://discord.com/api/v10";
const GAME_STATE_BASE_DIR = "data/discord/game-state";
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_DAILY_BYTES = 100 * 1024 * 1024;
const MAX_DAILY_FILES = 20;

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("client_payload must be a JSON object");
  }

  const required = ["command", "interaction_token", "application_id"];
  const missing = required.filter((key) => typeof payload[key] !== "string" || payload[key].length === 0);
  if (missing.length > 0) {
    throw new Error(`Missing required client_payload field(s): ${missing.join(", ")}`);
  }

  if (payload.command === "game-state") {
    validateGameStatePayload(payload);
  }
}

export function validateGameStatePayload(payload) {
  const attachment = payload.attachment;
  const missing = [];
  if (!attachment || typeof attachment !== "object") {
    missing.push("attachment");
  } else {
    if (typeof attachment.url !== "string" || attachment.url.length === 0) missing.push("attachment.url");
    if (typeof attachment.filename !== "string" || attachment.filename.length === 0) missing.push("attachment.filename");
    if (!Number.isFinite(Number(attachment.size))) missing.push("attachment.size");
  }
  if (missing.length > 0) {
    throw new Error(`Missing required game-state field(s): ${missing.join(", ")}`);
  }

  const size = Number(attachment.size);
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("attachment.size must be a positive integer");
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error("attachment exceeds 50MB limit");
  }

  validateCdnUrl(attachment.url);
}

export function sanitizeFilename(input) {
  let value = typeof input === "string" ? input : "";
  value = value.normalize("NFKC");
  value = value.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
  value = value.replace(/[\/\\]/g, "");
  value = value.replace(/\.\./g, "");
  value = value.replace(/\0/g, "");
  value = value.replace(/[;&|`$()<>*?\[\]{}'"\n\r\t]/g, "");
  value = value.replace(/\.{2,}/g, ".");
  value = value.replace(/[^A-Za-z0-9._-]/g, "");
  value = value.slice(0, 100);

  if (value.length === 0) {
    value = "upload.bin";
  }

  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error("sanitized filename contained illegal characters");
  }

  return value;
}

export function sanitizeLine(input, fallback = "unknown") {
  const raw = typeof input === "string" ? input : "";
  const clean = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[@`$<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean.length > 0 ? clean : fallback;
}

export function parseAllowedGuildIds(raw) {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function assertGuildAllowed(payload, allowedGuildIds) {
  if (!["game-state", "trigger-redeem"].includes(payload.command)) return;

  if (!payload.guild_id || typeof payload.guild_id !== "string") {
    throw new Error(`${payload.command} requires guild_id`);
  }
  if (!Array.isArray(allowedGuildIds) || allowedGuildIds.length === 0) {
    throw new Error(`ALLOWED_GUILD_IDS is required for ${payload.command}`);
  }
  if (!allowedGuildIds.includes(payload.guild_id)) {
    throw new Error(`guild is not allowlisted for ${payload.command}`);
  }
}

export function validateCdnUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("attachment.url must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("attachment.url must use https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("attachment.url must not include credentials");
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowed = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
  if (!allowed.has(hostname)) {
    throw new Error("attachment.url must use Discord CDN hostname");
  }
  if (net.isIP(hostname) !== 0 || hostname === "localhost") {
    throw new Error("attachment.url hostname is not allowed");
  }

  const canonical = parsed.toString();
  if (!(canonical.startsWith("https://cdn.discordapp.com/") || canonical.startsWith("https://media.discordapp.net/"))) {
    throw new Error("attachment.url must start with allowed Discord CDN prefix");
  }

  return parsed;
}

export function formatRedeemStatus(historyContent, maxLines = 10) {
  const lines = historyContent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "No redemption history is available yet.";
  }

  const tableStart = lines.findIndex((line) => line.startsWith("|") && line.endsWith("|"));
  const tableDivider = tableStart >= 0 ? lines[tableStart + 1] : undefined;
  const selected = tableStart >= 0 && tableDivider?.startsWith("|")
    ? [
        lines[tableStart],
        tableDivider,
        ...lines.slice(tableStart + 2).filter((line) => line.startsWith("|")).slice(0, maxLines),
      ]
    : lines.slice(0, maxLines);

  return [
    "Latest redeem history:",
    "```text",
    ...selected,
    "```",
  ].join("\n");
}

export async function triggerRedeemWorkflow({
  runGh = defaultRunGh,
  repo,
  ref,
  serverUrl = "https://github.com",
  nowFn = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const dispatchedAt = nowFn().getTime();
  await runGh(["workflow", "run", "redeem.yml", "--repo", repo, "--ref", ref]);

  for (let attempt = 0; attempt < 5; attempt++) {
    const out = await runGh([
      "run",
      "list",
      "--workflow",
      "redeem.yml",
      "--event",
      "workflow_dispatch",
      "--branch",
      ref,
      "--limit",
      "5",
      "--json",
      "databaseId,url,createdAt,headBranch",
      "--repo",
      repo,
    ]);
    const runs = JSON.parse(out || "[]");
    const run = Array.isArray(runs)
      ? runs.find((candidate) => {
          const createdAt = Date.parse(candidate?.createdAt ?? "");
          return candidate?.databaseId &&
            candidate?.headBranch === ref &&
            Number.isFinite(createdAt) &&
            createdAt >= dispatchedAt - 5_000;
        })
      : undefined;
    if (run) {
      const runId = String(run.databaseId);
      const runUrl = typeof run.url === "string" && run.url.length > 0
        ? run.url
        : `${serverUrl}/${repo}/actions/runs/${runId}`;
      return { runId, runUrl };
    }
    await sleep(1200);
  }

  throw new Error("Redeem workflow dispatch succeeded, but run ID was not discoverable yet");
}

export async function postDiscordFollowup({
  applicationId,
  interactionToken,
  content,
  botToken,
  fetchImpl = fetch,
  allowedMentions,
}) {
  const url = `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const response = await fetchImpl(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, ...(allowedMentions ? { allowed_mentions: allowedMentions } : {}) }),
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

export async function downloadDiscordAttachment({ attachment, fetchImpl = fetch, timeoutMs = 30_000 }) {
  validateCdnUrl(attachment.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(attachment.url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "stfc-discord-handler/1.0",
        Accept: "*/*",
      },
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error("download failed: redirects are not allowed");
    }
    if (!response.ok) {
      throw new Error(`download failed: status ${response.status}`);
    }

    if (typeof response.url === "string" && response.url.length > 0) {
      validateCdnUrl(response.url);
    }

    const contentLengthHeader = response.headers?.get?.("content-length");
    const declaredLength = Number(contentLengthHeader);
    if (!contentLengthHeader || !Number.isFinite(declaredLength) || !Number.isInteger(declaredLength)) {
      throw new Error("download failed: missing or invalid Content-Length");
    }

    const expectedSize = Number(attachment.size);
    if (declaredLength !== expectedSize) {
      throw new Error("download failed: Content-Length does not match attachment.size");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength !== expectedSize) {
      throw new Error("download failed: body size does not match attachment.size");
    }

    return {
      buffer,
      responseContentType: response.headers?.get?.("content-type") || "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("download failed: request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function updateDailyIndexAtomic({
  indexPath,
  entry,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  renameImpl = rename,
}) {
  let doc = { files: [] };
  try {
    const raw = await readFileImpl(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.files)) {
      doc = { files: parsed.files };
    }
  } catch {
    doc = { files: [] };
  }

  const existingFiles = doc.files.filter((f) => f && typeof f === "object");
  const existingBytes = existingFiles.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0);

  if (existingFiles.length >= MAX_DAILY_FILES) {
    throw new Error(`daily file cap exceeded (${MAX_DAILY_FILES} files)`);
  }
  if (existingBytes + Number(entry.size_bytes) > MAX_DAILY_BYTES) {
    throw new Error(`daily byte cap exceeded (${MAX_DAILY_BYTES} bytes)`);
  }

  doc.files.push(entry);

  const tempPath = `${indexPath}.tmp`;
  await writeFileImpl(tempPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await renameImpl(tempPath, indexPath);

  return doc;
}

export async function handleGameStateCommand({
  payload,
  repo,
  ref,
  serverUrl,
  fetchImpl = fetch,
  runGit = defaultRunGit,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  mkdirImpl = mkdir,
  renameImpl = rename,
  rmImpl = rm,
  nowFn = () => new Date(),
  reconcileAutomationStateImpl = reconcileAutomationStateAfterPushFailure,
}) {
  validateGameStatePayload(payload);

  const attachment = payload.attachment;
  const now = nowFn();
  const capturedAtUtc = now.toISOString();
  const today = capturedAtUtc.slice(0, 10);
  const hhmmss = capturedAtUtc.slice(11, 19).replace(/:/g, "");

  const ms = capturedAtUtc.slice(20, 23); // 3-digit milliseconds from ISO string

  const cleanName = sanitizeFilename(attachment.filename);
  const outDir = `${GAME_STATE_BASE_DIR}/${today}`;
  const outFile = `${outDir}/${hhmmss}${ms}-${cleanName}`;

  const baseDirAbs = path.resolve(GAME_STATE_BASE_DIR);
  const outFileAbs = path.resolve(outFile);
  if (!(outFileAbs === baseDirAbs || outFileAbs.startsWith(`${baseDirAbs}${path.sep}`))) {
    throw new Error("resolved output path escapes data/discord/game-state");
  }

  const { buffer, responseContentType } = await downloadDiscordAttachment({ attachment, fetchImpl });

  await mkdirImpl(outDir, { recursive: true });
  const partFile = `${outFile}.part`;
  try {
    await writeFileImpl(partFile, buffer);
    await renameImpl(partFile, outFile);
  } catch (error) {
    await rmImpl(partFile, { force: true }).catch(() => {});
    throw error;
  }

  const safeNote = sanitizeLine(payload.note, "no note");
  const safeUploaderHandle = sanitizeLine(payload.uploader_handle || payload.member || "unknown", "unknown");
  const safeUploader = sanitizeLine(payload.uploader || payload.member || "unknown", "unknown");

  const sourceUrl = typeof payload.jumplink === "string" && payload.jumplink.length > 0
    ? payload.jumplink
    : `https://discord.com/channels/${payload.guild_id || "@me"}/${payload.channel_id || "unknown"}/${payload.discord_message_id || "..."}`;

  const lineage = {
    discord_message_id: payload.discord_message_id ?? null,
    channel_id: payload.channel_id ?? null,
    guild_id: payload.guild_id ?? null,
    uploader: safeUploader,
    uploader_handle: safeUploaderHandle,
    captured_at_utc: capturedAtUtc,
    note: safeNote,
    source_url: sourceUrl,
    content_type: typeof attachment.content_type === "string" && attachment.content_type.length > 0
      ? attachment.content_type
      : responseContentType,
    size_bytes: Number(attachment.size),
    filename_original: String(attachment.filename),
    filename_stored: cleanName,
  };

  const lineagePath = `${outFile}.lineage.json`;
  await writeFileImpl(lineagePath, `${JSON.stringify(lineage, null, 2)}\n`, "utf8");

  const indexPath = `${outDir}/_index.json`;
  await updateDailyIndexAtomic({
    indexPath,
    entry: {
      filename: path.basename(outFile),
      captured_at: capturedAtUtc,
      uploader: safeUploaderHandle,
      note: safeNote,
      size_bytes: Number(attachment.size),
    },
    readFileImpl,
    writeFileImpl,
    renameImpl,
  });

  await runGit(["config", "user.email", "actions@github.com"]);
  await runGit(["config", "user.name", "github-actions[bot]"]);
  await runGit(["add", "--", outFile]);
  await runGit(["add", "--", lineagePath]);
  await runGit(["add", "--", indexPath]);
  await runCommand(
    process.execPath,
    [path.join(SCRIPT_DIR, "check-artifact-hygiene.mjs"), "--staged"],
  );

  const commitMessage = [
    `data(game-state): ${safeNote || "no note"}`,
    "",
    `File: ${outFile}`,
    `Uploader: ${safeUploaderHandle}`,
    `Source: ${sourceUrl}`,
  ].join("\n");
  await runGit(["commit", "--no-verify", "-F", "-"], { stdin: `${commitMessage}\n` });

  const doPush = async () => {
    await runGit(["push", "origin", `HEAD:${ref}`]);
  };

  try {
    await doPush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/non-fast-forward|fetch first|rejected/i.test(message)) {
      await reconcileAutomationStateImpl({
        stateDir: process.cwd(),
        ref,
        relativePaths: [outFile, lineagePath, indexPath],
      });
      await doPush();
    } else {
      throw error;
    }
  }

  const sha = (await runGit(["rev-parse", "HEAD"])) .trim();
  const fileUrl = `${serverUrl}/${repo}/blob/${sha}/${outFile}`;

  return {
    responseText: `📁 Saved ${fileUrl}`,
    outFile,
    fileUrl,
  };
}

export async function resolveResponseText({ payload, repo, workflowRef, stateRef, serverUrl, historyPath, runGh, runGit, readFileImpl, writeFileImpl, mkdirImpl, renameImpl, rmImpl, fetchImpl, nowFn, reconcileAutomationStateImpl }) {
  const command = payload.command;

  if (command === "redeem-status") {
    const history = await readFileImpl(historyPath, "utf8");
    return formatRedeemStatus(history);
  }

  if (command === "trigger-redeem") {
    const { runId, runUrl } = await triggerRedeemWorkflow({
      runGh,
      repo,
      ref: workflowRef,
      serverUrl,
      nowFn,
    });
    return `Redeem triggered — run ID ${runId}\n${runUrl}`;
  }

  if (command === "game-state") {
    const { responseText } = await handleGameStateCommand({
      payload,
      repo,
      ref: stateRef,
      serverUrl,
      fetchImpl,
      runGit,
      readFileImpl,
      writeFileImpl,
      mkdirImpl,
      renameImpl,
      rmImpl,
      nowFn,
      reconcileAutomationStateImpl,
    });
    return responseText;
  }

  return `Unknown command: ${command}`;
}

export async function runCli({
  env = process.env,
  runGh = defaultRunGh,
  runGit = defaultRunGit,
  fetchImpl = fetch,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  mkdirImpl = mkdir,
  renameImpl = rename,
  rmImpl = rm,
  nowFn = () => new Date(),
  reconcileAutomationStateImpl = reconcileAutomationStateAfterPushFailure,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let payload;
  try {
    if (!env.DISCORD_BOT_TOKEN) {
      throw new Error("DISCORD_BOT_TOKEN env var not set");
    }
    if (!env.DISCORD_CLIENT_PAYLOAD) {
      throw new Error("DISCORD_CLIENT_PAYLOAD env var not set");
    }

    payload = JSON.parse(env.DISCORD_CLIENT_PAYLOAD);
    validatePayload(payload);
    assertGuildAllowed(payload, parseAllowedGuildIds(env.ALLOWED_GUILD_IDS));

    const repo = env.GITHUB_REPOSITORY;
    if (!repo) throw new Error("GITHUB_REPOSITORY env var not set");

    const workflowRef = env.GITHUB_REF_NAME || "main";
    const stateRef = env.STFC_STATE_BRANCH || "automation-state";
    const serverUrl = env.GITHUB_SERVER_URL || "https://github.com";
    const historyPath = env.REDEEM_HISTORY_PATH || "docs/redeem-history.md";

    const responseText = await resolveResponseText({
      payload,
      repo,
      workflowRef,
      stateRef,
      serverUrl,
      historyPath,
      runGh,
      runGit,
      fetchImpl,
      readFileImpl,
      writeFileImpl,
      mkdirImpl,
      renameImpl,
      rmImpl,
      nowFn,
      reconcileAutomationStateImpl,
    });

    await postDiscordFollowup({
      applicationId: payload.application_id,
      interactionToken: payload.interaction_token,
      content: responseText,
      botToken: env.DISCORD_BOT_TOKEN,
      fetchImpl,
      allowedMentions: { parse: [] },
    });

    stdout.write(`Handled command: ${payload.command}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);

    if (payload && env.DISCORD_BOT_TOKEN && payload.application_id && payload.interaction_token) {
      try {
        await postDiscordFollowup({
          applicationId: payload.application_id,
          interactionToken: payload.interaction_token,
          content: `❌ ${sanitizeLine(message, "command failed")}`,
          botToken: env.DISCORD_BOT_TOKEN,
          fetchImpl,
          allowedMentions: { parse: [] },
        });
      } catch {
        // best effort follow-up only
      }
    }

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

async function defaultRunGit(args, { stdin } = {}) {
  return runCommand("git", args, { stdin });
}

function runCommand(command, args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`${command} ${args.join(" ")} failed${suffix}`));
      }
    });

    if (typeof stdin === "string") {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("discord-handler.mjs");
if (isMain) {
  runCli().then((code) => process.exit(code));
}
