#!/usr/bin/env node

import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import path from "node:path";
import net from "node:net";
import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isAutomationStateCommitPublished, reconcileAutomationStateAfterPushFailure } from "./automation-state-retry.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DISCORD_API_BASE = "https://discord.com/api/v10";
const GAME_STATE_BASE_DIR = "data/discord/game-state";
const GAME_STATE_R2_BUCKET = "stfc-game-state";
const R2_ENV_NAMES = {
  accountId: "CLOUDFLARE_ACCOUNT_ID",
  accessKeyId: "CLOUDFLARE_R2_ACCESS_KEY_ID",
  secretAccessKey: "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
};
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_DAILY_BYTES = 100 * 1024 * 1024;
const MAX_DAILY_FILES = 20;
const R2_REQUEST_TIMEOUT_MS = 30_000;

class R2UploadFailureError extends Error {}

function validatePayload(payload) {
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

function validateGameStatePayload(payload) {
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

function sanitizeLine(input, fallback = "unknown", maxLength = 120) {
  const raw = typeof input === "string" ? input : "";
  const clean = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[@`$<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return clean.length > 0 ? clean : fallback;
}

function parseAllowedGuildIds(raw) {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function assertGuildAllowed(payload, allowedGuildIds) {
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

function validateCdnUrl(rawUrl) {
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

function formatRedeemStatus(historyContent, maxLines = 10) {
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

async function triggerRedeemWorkflow({
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

async function postDiscordFollowup({
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

async function downloadDiscordAttachment({ attachment, fetchImpl = fetch, timeoutMs = 30_000 }) {
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

async function readDailyIndex(indexPath, readFileImpl) {
  let doc;
  try {
    const raw = await readFileImpl(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.files)) {
      throw new Error("daily index is malformed: expected a files array");
    }
    doc = { files: parsed.files };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    doc = { files: [] };
  }

  const existingFiles = doc.files;
  if (existingFiles.some((file) =>
    !file
    || typeof file !== "object"
    || Array.isArray(file)
    || typeof file.filename !== "string"
    || !Number.isSafeInteger(file.size_bytes)
    || file.size_bytes < 0
  )) {
    throw new Error("daily index is malformed: invalid file entry");
  }
  return doc;
}

function appendDailyIndexEntry(doc, entry) {
  if (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes <= 0) {
    throw new Error("daily index entry has an invalid size_bytes value");
  }
  const existingBytes = doc.files.reduce((sum, file) => sum + file.size_bytes, 0);
  if (doc.files.length >= MAX_DAILY_FILES) {
    throw new Error(`daily file cap exceeded (${MAX_DAILY_FILES} files)`);
  }
  if (existingBytes + Number(entry.size_bytes) > MAX_DAILY_BYTES) {
    throw new Error(`daily byte cap exceeded (${MAX_DAILY_BYTES} bytes)`);
  }

  doc.files.push(entry);
  return doc;
}

async function writeDailyJsonAtomic(filePath, doc, writeFileImpl, renameImpl) {
  const tempPath = `${filePath}.tmp`;
  await writeFileImpl(tempPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await renameImpl(tempPath, filePath);
}

export async function updateDailyIndexAtomic({
  indexPath,
  entry,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  renameImpl = rename,
}) {
  const doc = appendDailyIndexEntry(
    await readDailyIndex(indexPath, readFileImpl),
    entry,
  );
  await writeDailyJsonAtomic(indexPath, doc, writeFileImpl, renameImpl);
  return doc;
}

async function readDailyManifest(manifestPath, readFileImpl, bucket) {
  if (typeof bucket !== "string" || bucket.length === 0) {
    throw new Error("daily manifest requires a non-empty bucket");
  }
  let raw;
  try {
    raw = await readFileImpl(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 1, bucket, files: [] };
    }
    throw error;
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.files)) {
    throw new Error("daily manifest is malformed: expected a files array");
  }
  if (parsed.files.some((file) =>
    !file
    || typeof file !== "object"
    || Array.isArray(file)
    || typeof file.filename !== "string"
    || typeof file.r2_bucket !== "string"
    || typeof file.r2_key !== "string"
  )) {
    throw new Error("daily manifest is malformed: invalid file entry");
  }
  if (parsed.version !== undefined && (!Number.isSafeInteger(parsed.version) || parsed.version < 1)) {
    throw new Error("daily manifest is malformed: invalid version");
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new Error(`daily manifest version ${parsed.version} is unsupported; supported version is 1`);
  }
  if (parsed.bucket !== undefined && typeof parsed.bucket !== "string") {
    throw new Error("daily manifest is malformed: invalid bucket");
  }
  const manifestBucket = parsed.bucket ?? parsed.files[0]?.r2_bucket ?? bucket;
  if (manifestBucket !== bucket || parsed.files.some((file) => file.r2_bucket !== manifestBucket)) {
    throw new Error("daily manifest bucket mismatch: keep the existing bucket for this day; migrate objects explicitly before changing it");
  }
  return {
    ...parsed,
    version: parsed.version ?? 1,
    bucket: manifestBucket,
    files: parsed.files,
  };
}

export async function updateDailyManifestAtomic({
  manifestPath,
  entry,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  renameImpl = rename,
}) {
  const doc = await readDailyManifest(manifestPath, readFileImpl, entry.r2_bucket);
  doc.files.push(entry);
  await writeDailyJsonAtomic(manifestPath, doc, writeFileImpl, renameImpl);
  return doc;
}

function r2ConfigFromEnv(env) {
  const config = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    bucket: env.STFC_GAME_STATE_R2_BUCKET || GAME_STATE_R2_BUCKET,
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "bucket" && (typeof value !== "string" || value.length === 0))
    .map(([key]) => R2_ENV_NAMES[key] || key);
  if (missing.length > 0) {
    throw new Error(`Missing required R2 env var(s): ${missing.join(", ")}`);
  }
  return config;
}

async function signedR2Request({
  config,
  method,
  key,
  buffer = Buffer.alloc(0),
  contentType,
  fetchImpl = fetch,
  now = new Date(),
  timeoutMs = R2_REQUEST_TIMEOUT_MS,
}) {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const pathname = `/${config.bucket}/${encodedKey}`;
  const url = `https://${host}${pathname}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(buffer);
  const credentialScope = `${shortDate}/auto/s3/aws4_request`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    method,
    pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(config.secretAccessKey, shortDate, "auto", "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = [
    "AWS4-HMAC-SHA256 ",
    `Credential=${config.accessKeyId}/${credentialScope}, `,
    `SignedHeaders=${signedHeaders}, `,
    `Signature=${signature}`,
  ].join("");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: authorization,
          ...(contentType ? { "Content-Type": contentType } : {}),
          "User-Agent": "stfc-discord-handler/1.0",
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
        },
        body: method === "PUT" ? buffer : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const action = method === "PUT" ? "upload" : "cleanup";
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        const failure = `R2 ${action} failed: request timed out`;
        if (method === "PUT") {
          throw new R2UploadFailureError(
            `${failure}; outcome uncertain; possible object at ${config.bucket}/${key}`,
            { cause: error },
          );
        }
        throw new Error(failure, { cause: error });
      }
      if (method === "PUT") {
        const reason = error instanceof Error ? error.message : String(error);
        throw new R2UploadFailureError(
          `R2 upload failed: ${reason}; outcome uncertain; possible object at ${config.bucket}/${key}`,
          { cause: error },
        );
      }
      throw error;
    }

    if (response.status === 404 && method === "DELETE") {
      return { bucket: config.bucket, key, sha256: payloadHash, size: 0 };
    }
    if (!response.ok) {
      const body = typeof response.text === "function" ? await response.text() : "";
      const action = method === "PUT" ? "upload" : "cleanup";
      const failure = `R2 ${action} failed: status ${response.status}${body ? ` ${body.slice(0, 200)}` : ""}`;
      if (method === "PUT") {
        const location = response.status >= 500
          ? `outcome uncertain; possible object at ${config.bucket}/${key}`
          : `object location: ${config.bucket}/${key}`;
        throw new R2UploadFailureError(`${failure}; ${location}`);
      }
      throw new Error(failure);
    }

    return { bucket: config.bucket, key, sha256: payloadHash, size: buffer.byteLength };
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadR2Object(options) {
  return signedR2Request({ ...options, method: "PUT" });
}

async function deleteR2Object(options) {
  return signedR2Request({ ...options, method: "DELETE" });
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getSignatureKey(secretAccessKey, dateStamp, regionName, serviceName) {
  const kDate = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(regionName).digest();
  const kService = createHmac("sha256", kRegion).update(serviceName).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

async function handleGameStateCommand({
  payload,
  repo,
  ref,
  serverUrl,
  r2Config,
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
  if (!r2Config) {
    throw new Error("R2 config is required for game-state uploads");
  }

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

  const safeNote = sanitizeLine(payload.note, "no note");
  const safeUploaderHandle = sanitizeLine(payload.uploader_handle || payload.member || "unknown", "unknown");
  const safeUploader = sanitizeLine(payload.uploader || payload.member || "unknown", "unknown");
  const r2Key = `${today}/${path.basename(outFile)}`;
  const lineagePath = `${outFile}.lineage.json`;
  const indexPath = `${outDir}/_index.json`;
  const manifestPath = `${outDir}/manifest.json`;
  const indexDoc = appendDailyIndexEntry(
    await readDailyIndex(indexPath, readFileImpl),
    {
      filename: path.basename(outFile),
      captured_at: capturedAtUtc,
      uploader: safeUploaderHandle,
      note: safeNote,
      size_bytes: Number(attachment.size),
    },
  );
  const manifestDoc = await readDailyManifest(manifestPath, readFileImpl, r2Config.bucket);

  await mkdirImpl(outDir, { recursive: true });
  const { buffer, responseContentType } = await downloadDiscordAttachment({ attachment, fetchImpl });
  const contentType = typeof attachment.content_type === "string" && attachment.content_type.length > 0
    ? attachment.content_type
    : responseContentType;
  const upload = await uploadR2Object({
    config: r2Config,
    key: r2Key,
    buffer,
    contentType,
    fetchImpl,
    now,
  });

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
    content_type: contentType,
    size_bytes: Number(attachment.size),
    sha256: upload.sha256,
    r2_bucket: upload.bucket,
    r2_key: upload.key,
    filename_original: String(attachment.filename),
    filename_stored: cleanName,
  };

  let commitPushed = false;
  let publicationUncertain = false;
  try {
    await writeFileImpl(lineagePath, `${JSON.stringify(lineage, null, 2)}\n`, "utf8");
    await writeDailyJsonAtomic(indexPath, indexDoc, writeFileImpl, renameImpl);
    manifestDoc.files.push({
      filename: path.basename(outFile),
      r2_bucket: upload.bucket,
      r2_key: upload.key,
      sha256: upload.sha256,
      size_bytes: upload.size,
      content_type: contentType,
      captured_at: capturedAtUtc,
      uploader: safeUploaderHandle,
      note: safeNote,
      access: "signed-url-required",
      retention: "forever",
    });
    await writeDailyJsonAtomic(manifestPath, manifestDoc, writeFileImpl, renameImpl);

    await runGit(["config", "user.email", "actions@github.com"]);
    await runGit(["config", "user.name", "github-actions[bot]"]);
    await runGit(["add", "--", lineagePath]);
    await runGit(["add", "--", indexPath]);
    await runGit(["add", "--", manifestPath]);
    await runCommand(
      process.execPath,
      [path.join(SCRIPT_DIR, "check-artifact-hygiene.mjs"), "--staged"],
    );

    const commitMessage = [
      `data(game-state): ${safeNote || "no note"}`,
      "",
      `Manifest: ${manifestPath}`,
      `R2: ${upload.bucket}/${upload.key}`,
      `Uploader: ${safeUploaderHandle}`,
      `Source: ${sourceUrl}`,
    ].join("\n");
    await runGit(["commit", "--no-verify", "-F", "-"], { stdin: `${commitMessage}\n` });

    const doPush = async () => {
      const commit = (await runGit(["rev-parse", "HEAD"])).trim();
      try {
        await runGit(["push", "--no-verify", "origin", `HEAD:${ref}`]);
      } catch (error) {
        try {
          commitPushed = await isAutomationStateCommitPublished({
            stateDir: process.cwd(),
            ref,
            commit,
            runGitImpl: runGit === defaultRunGit ? undefined : runGit,
          });
        } catch (confirmationError) {
          publicationUncertain = true;
          throw new Error(
            `Game-state publication uncertain; preserved R2 object ${upload.bucket}/${upload.key}: ${confirmationError instanceof Error ? confirmationError.message : String(confirmationError)}`,
            { cause: new AggregateError([error, confirmationError]) },
          );
        }
        if (!commitPushed) throw error;
      }
    };

    try {
      await doPush();
    } catch (error) {
      if (publicationUncertain) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/non-fast-forward|fetch first|rejected/i.test(message)) {
        await reconcileAutomationStateImpl({
          stateDir: process.cwd(),
          ref,
          relativePaths: [lineagePath, indexPath, manifestPath],
        });
        await doPush();
      } else {
        throw error;
      }
    }
    commitPushed = true;
  } catch (error) {
    if (!commitPushed && !publicationUncertain) {
      try {
        await deleteR2Object({ config: r2Config, key: r2Key, fetchImpl, now: nowFn() });
      } catch (cleanupError) {
        const failure = error instanceof Error ? error.message : String(error);
        const cleanupFailure = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(
          `Game-state save failed (${failure}); R2 object cleanup also failed (${cleanupFailure})`,
          { cause: new AggregateError([error, cleanupError]) },
        );
      }
    }
    throw error;
  }

  const sha = (await runGit(["rev-parse", "HEAD"])) .trim();
  const manifestUrl = `${serverUrl}/${repo}/blob/${sha}/${manifestPath}`;

  return {
    responseText: `📁 Saved ${manifestUrl} (R2 key: ${upload.key})`,
    outFile: manifestPath,
    fileUrl: manifestUrl,
  };
}

export async function resolveResponseText({ payload, repo, workflowRef, stateRef, serverUrl, historyPath, r2Config, runGh, runGit, readFileImpl = readFile, writeFileImpl, mkdirImpl, renameImpl, rmImpl, fetchImpl, nowFn, reconcileAutomationStateImpl }) {
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
      r2Config,
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
    const r2Config = payload.command === "game-state" ? r2ConfigFromEnv(env) : undefined;

    const responseText = await resolveResponseText({
      payload,
      repo,
      workflowRef,
      stateRef,
      serverUrl,
      historyPath,
      r2Config,
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
          content: `❌ ${sanitizeLine(
            message,
            "command failed",
            error instanceof R2UploadFailureError ? 1800 : 120,
          )}`,
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
        reject(Object.assign(new Error(`${command} ${args.join(" ")} failed${suffix}`), { code }));
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
