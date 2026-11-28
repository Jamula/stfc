import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEFAULT_REQUIRED_LABELS, findAlertIssue, resolveDeadTokenAlert } from "./dead-token-alert.ts";

export interface DegradedGiftFailure {
  gift: string;
  giftId?: string;
  streak: number;
}

export type DegradedAlertStatus =
  | "state-failed"
  | "lookup-failed"
  | "create-failed"
  | "update-failed"
  | "already-open"
  | "created"
  | "resolved"
  | "none"
  | "close-failed";

export interface DegradedAlertOptions {
  statePath?: string;
  state?: unknown;
  title?: string;
  labels?: readonly string[];
  requiredLabels?: readonly string[];
  runUrl?: string;
  listIssues?: (title: string) => unknown;
  createIssue?: (title: string, labels: readonly string[], body: string) => void;
  updateIssue?: (number: number, body: string) => void;
  closeIssue?: (number: number, comment: string) => void;
  log?: (line: string) => void;
}

export interface DegradedAlertResult {
  status: DegradedAlertStatus;
  number?: number;
  persistentCount: number;
}

export const PERSISTENT_TRANSIENT_RUNS = 3 as const;
export const DEGRADED_ALERT_TITLE = "STFC redemption degraded — repeated gift claim failures";
export const DEGRADED_ALERT_LABELS: readonly string[] = ["bug", "priority:p2"];
const DEFAULT_STATE_PATH = "data/redeem-degraded-state.json";

export function parseDegradedState(raw: string): DegradedGiftFailure[] {
  const parsed: unknown = JSON.parse(String(raw ?? ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("degraded-gift-alert: invalid state file shape");
  }
  const doc = parsed as Record<string, unknown>;
  const version = doc["version"];
  const accounts = doc["accounts"];
  if (
    (version !== 1 && version !== 2 && version !== 3) ||
    !accounts ||
    typeof accounts !== "object" ||
    Array.isArray(accounts)
  ) {
    throw new Error("degraded-gift-alert: invalid state file shape");
  }

  const failures: DegradedGiftFailure[] = [];
  for (const rawGifts of Object.values(accounts as Record<string, unknown>)) {
    if (!rawGifts || typeof rawGifts !== "object" || Array.isArray(rawGifts)) {
      throw new Error("degraded-gift-alert: account state must be an object");
    }
    for (const [giftId, rawEntry] of Object.entries(rawGifts as Record<string, unknown>)) {
      const entryObj =
        rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)
          ? (rawEntry as Record<string, unknown>)
          : undefined;
      const legacy = version === 1 || entryObj?.["legacy"] === true;
      const streak = version === 1 ? rawEntry : entryObj?.["streak"];
      const gift = version === 1 ? giftId : entryObj?.["title"];
      if (typeof streak !== "number" || !Number.isInteger(streak) || streak < 1) {
        throw new Error("degraded-gift-alert: streaks must be positive integers");
      }
      if (typeof gift !== "string") {
        throw new Error("degraded-gift-alert: gift entries need a title and positive integer streak");
      }
      if (version >= 2 && entryObj?.["legacy"] !== undefined && entryObj["legacy"] !== true) {
        throw new Error("degraded-gift-alert: legacy markers must be true when present");
      }
      if (
        version === 3 &&
        entryObj?.["nextAttemptAt"] !== undefined &&
        (typeof entryObj["nextAttemptAt"] !== "string" || !Number.isFinite(Date.parse(entryObj["nextAttemptAt"])))
      ) {
        throw new Error("degraded-gift-alert: retry times must be valid timestamps");
      }
      if (streak >= PERSISTENT_TRANSIENT_RUNS) {
        failures.push({ gift, ...(legacy ? {} : { giftId }), streak });
      }
    }
  }
  return failures;
}

export function syncDegradedGiftAlert(options: DegradedAlertOptions = {}): DegradedAlertResult {
  const log = options.log ?? ((line: string) => console.error(line));
  const title = options.title ?? DEGRADED_ALERT_TITLE;
  const labels = options.labels ?? DEGRADED_ALERT_LABELS;
  const requiredLabels = options.requiredLabels ?? DEFAULT_REQUIRED_LABELS;
  const runUrl = options.runUrl ?? "(unknown run)";
  let persistentFailures: DegradedGiftFailure[];
  try {
    const raw =
      options.state !== undefined
        ? JSON.stringify(options.state)
        : readFileSync(options.statePath ?? DEFAULT_STATE_PATH, "utf8");
    persistentFailures = parseDegradedState(raw);
  } catch (err: unknown) {
    log(`::warning::Persistent degraded-gift state could not be read: ${errorText(err)}`);
    return { status: "state-failed", persistentCount: 0 };
  }

  if (persistentFailures.length === 0) {
    const result = resolveDeadTokenAlert({
      title,
      requiredLabels,
      alertName: "Persistent degraded-gift alert",
      listIssues: options.listIssues,
      closeIssue: options.closeIssue,
      runUrl,
      resolutionComment: `No gift claim failure has persisted for ${PERSISTENT_TRANSIENT_RUNS} consecutive runs as of ${runUrl} — closing automatically.`,
      log,
    });
    return { status: result.status === "closed" ? "resolved" : result.status, persistentCount: 0 };
  }

  let found;
  try {
    found = findAlertIssue({
      title,
      requiredLabels,
      alertName: "Persistent degraded-gift alert",
      listIssues: options.listIssues,
      log,
    });
  } catch (err: unknown) {
    log(`::warning::Persistent degraded-gift alert lookup failed: ${errorText(err)}`);
    return { status: "lookup-failed", persistentCount: persistentFailures.length };
  }

  if (found.number !== undefined) {
    try {
      (options.updateIssue ?? ghUpdateIssue)(
        found.number,
        formatIssueBody(persistentFailures, runUrl),
      );
    } catch (err: unknown) {
      log(`::warning::Persistent degraded-gift alert could not be updated: ${errorText(err)}`);
      return {
        status: "update-failed",
        number: found.number,
        persistentCount: persistentFailures.length,
      };
    }
    return { status: "already-open", number: found.number, persistentCount: persistentFailures.length };
  }

  try {
    (options.createIssue ?? ghCreateIssue)(title, labels, formatIssueBody(persistentFailures, runUrl));
  } catch (err: unknown) {
    log(`::warning::Persistent degraded-gift alert could not be created: ${errorText(err)}`);
    return { status: "create-failed", persistentCount: persistentFailures.length };
  }
  log(
    `::warning::${persistentFailures.length} gift claim failure(s) have persisted for at least ${PERSISTENT_TRANSIENT_RUNS} consecutive runs; opened a tracking issue.`,
  );
  return { status: "created", persistentCount: persistentFailures.length };
}

function formatIssueBody(failures: DegradedGiftFailure[], runUrl: string): string {
  const rows = failures
    .map(({ gift, giftId, streak }) => {
      const label = giftId === undefined ? gift : `${gift} (bundle ${giftId})`;
      return `- ${escapeMarkdown(label)} — ${streak} consecutive runs`;
    })
    .join("\n");
  return [
    "The redeem workflow has observed the following gifts returning `TRANSIENT` on at least three consecutive runs.",
    "",
    rows,
    "",
    `Latest run: ${escapeMarkdown(runUrl)}`,
    "",
    "This alert is automatically closed after a later run observes recovery for these gifts.",
  ].join("\n");
}

function escapeMarkdown(value: unknown): string {
  return String(value).replace(/[\r\n]+/g, " ").replace(/[\\`|]/g, "\\$&");
}

function ghCreateIssue(title: string, labels: readonly string[], body: string): void {
  execFileSync("gh", ["issue", "create", "--title", title, "--label", labels.join(","), "--body", body], {
    stdio: "inherit",
  });
}

function ghUpdateIssue(number: number, body: string): void {
  execFileSync("gh", ["issue", "edit", String(number), "--body", body], {
    stdio: "inherit",
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function main(argv: string[]): number {
  if (argv[2] !== "sync") {
    console.error("usage: degraded-gift-alert.ts sync");
    return 1;
  }
  syncDegradedGiftAlert({
    statePath: process.env["STATE_FILE"],
    runUrl: process.env["RUN_URL"],
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
