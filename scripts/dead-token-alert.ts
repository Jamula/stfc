/**
 * Dead-token alert issue selection, extracted from .github/workflows/redeem.yml
 * so the matching and closing rules can be executed by tests instead of pinned
 * as YAML substrings (#243).
 *
 * Usage from the workflow:
 *   node scripts/dead-token-alert.ts find      # prints the alert number, or nothing
 *   node scripts/dead-token-alert.ts resolve   # closes at most one alert, never fails
 *
 * Env: TITLE (required), REQUIRED_LABELS (comma-separated), RUN_URL (resolve).
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export interface AlertIssue {
  number: number;
  title: string;
  labels?: Array<{ name?: string } | string>;
}

export interface AlertSelectOptions {
  title: string;
  requiredLabels?: readonly string[];
}

export interface AlertLookupOptions extends AlertSelectOptions {
  alertName?: string;
  listIssues?: (title: string) => unknown;
  log?: (line: string) => void;
}

export interface AlertResolveOptions extends AlertLookupOptions {
  runUrl?: string;
  resolutionComment?: string;
  closeIssue?: (number: number, comment: string) => void;
}

export interface AlertLookupResult {
  number: number | undefined;
  matchCount: number;
}

export type AlertResolveStatus = "closed" | "none" | "lookup-failed" | "close-failed";

export interface AlertResolveResult {
  status: AlertResolveStatus;
  number?: number;
  matchCount: number;
}

export const DEFAULT_REQUIRED_LABELS: readonly string[] = ["bug"];
const DEFAULT_ALERT_NAME = "Dead-token alert";

export function parseIssues(raw: string | undefined | null): AlertIssue[] {
  const text = String(raw ?? "").trim();
  if (text === "") {
    throw new Error("dead-token-alert: expected a JSON array from gh issue list, got empty output");
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `dead-token-alert: expected a JSON array from gh issue list, got ${typeof parsed}`,
    );
  }
  return parsed as AlertIssue[];
}

function labelNames(issue: AlertIssue | null | undefined): Set<string> {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return new Set(
    labels
      .map((label) => (typeof label === "string" ? label : label?.name))
      .filter((name): name is string => typeof name === "string"),
  );
}

const PRIORITY_RANK = new Map<string, number>([
  ["priority:p0", 0],
  ["priority:p1", 1],
  ["priority:p2", 2],
  ["priority:p3", 3],
]);

function hasRequiredLabel(names: Set<string>, required: string): boolean {
  if (names.has(required)) return true;
  const requiredRank = PRIORITY_RANK.get(required);
  if (requiredRank === undefined) return false;
  for (const candidate of names) {
    const candidateRank = PRIORITY_RANK.get(candidate);
    if (candidateRank !== undefined && candidateRank <= requiredRank) {
      return true;
    }
  }
  return false;
}

export function selectAlertIssues(issues: unknown, options: AlertSelectOptions): AlertIssue[] {
  const title = options.title;
  if (typeof title !== "string" || title === "") {
    throw new Error("dead-token-alert: a non-empty title is required");
  }
  const requiredLabels = options.requiredLabels ?? DEFAULT_REQUIRED_LABELS;
  if (!Array.isArray(issues)) {
    throw new Error("dead-token-alert: issue list must be an array");
  }

  return (issues as Array<Partial<AlertIssue> | null | undefined>)
    .filter((issue): issue is AlertIssue =>
      Boolean(issue && issue.title === title && typeof issue.number === "number" && Number.isFinite(issue.number)),
    )
    .filter((issue) => {
      const names = labelNames(issue);
      return requiredLabels.every((label) => hasRequiredLabel(names, label));
    })
    .sort((a, b) => a.number - b.number);
}

function ghListIssues(title: string): AlertIssue[] {
  const out = execFileSync(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--search",
      `${title} in:title`,
      "--json",
      "number,title,labels",
      "--limit",
      "100",
    ],
    { encoding: "utf8" },
  );
  return parseIssues(out);
}

function ghCloseIssue(number: number, comment: string): void {
  execFileSync("gh", ["issue", "close", String(number), "--comment", comment], {
    stdio: "inherit",
  });
}

export function findAlertIssue(options: AlertLookupOptions): AlertLookupResult {
  const title = options.title;
  const requiredLabels = options.requiredLabels ?? DEFAULT_REQUIRED_LABELS;
  const alertName = options.alertName ?? DEFAULT_ALERT_NAME;
  const listIssues = options.listIssues ?? ghListIssues;
  const log = options.log ?? ((line: string) => console.error(line));

  const listed = listIssues(title);
  const issues =
    typeof listed === "string" || listed === undefined || listed === null
      ? parseIssues(listed)
      : listed;
  const matches = selectAlertIssues(issues, { title, requiredLabels });
  const oldest = matches[0];
  if (matches.length > 1 && oldest) {
    log(
      `::warning::Found ${matches.length} matching ${alertName.toLowerCase()}s; using oldest #${oldest.number}.`,
    );
  }
  return { number: oldest?.number, matchCount: matches.length };
}

export function resolveDeadTokenAlert(options: AlertResolveOptions): AlertResolveResult {
  const log = options.log ?? ((line: string) => console.error(line));
  const closeIssue = options.closeIssue ?? ghCloseIssue;
  const runUrl = options.runUrl ?? "(unknown run)";
  const alertName = options.alertName ?? DEFAULT_ALERT_NAME;
  const resolutionComment =
    options.resolutionComment ??
    `Token accepted again as of ${runUrl} — closing automatically.`;

  let found: AlertLookupResult;
  try {
    found = findAlertIssue(options);
  } catch (err: unknown) {
    log(`::warning::${alertName} lookup failed: ${errorText(err)}`);
    return { status: "lookup-failed", matchCount: 0 };
  }

  if (found.number === undefined) {
    log(`No open ${alertName.toLowerCase()} — nothing to resolve.`);
    return { status: "none", matchCount: 0 };
  }

  try {
    closeIssue(found.number, resolutionComment);
  } catch (err: unknown) {
    log(`::warning::Failed to close ${alertName.toLowerCase()} #${found.number}: ${errorText(err)}`);
    return { status: "close-failed", number: found.number, matchCount: found.matchCount };
  }

  return { status: "closed", number: found.number, matchCount: found.matchCount };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requiredLabelsFromEnv(): readonly string[] {
  const raw = process.env["REQUIRED_LABELS"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_REQUIRED_LABELS;
  return raw
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
}

function main(argv: string[]): number {
  const command = argv[2];
  const title = process.env["TITLE"] ?? "";
  const requiredLabels = requiredLabelsFromEnv();

  if (command === "find") {
    const { number } = findAlertIssue({ title, requiredLabels });
    if (number !== undefined) process.stdout.write(`${number}\n`);
    return 0;
  }

  if (command === "resolve") {
    resolveDeadTokenAlert({ title, requiredLabels, runUrl: process.env["RUN_URL"] });
    return 0;
  }

  console.error("usage: dead-token-alert.ts <find|resolve>");
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
