import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

export interface SkillOutput {
  result: unknown;
  exitCode: number;
}

export interface Writer {
  log: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
}

export interface AccountRosterFile {
  account: string;
  filePath: string;
}

export function parseFlags(args: string[]): { values: Record<string, string>; bools: Record<string, boolean> } {
  const values: Record<string, string> = {};
  const bools: Record<string, boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "all") {
      bools.all = true;
      continue;
    }

    const directEq = key.indexOf("=");
    if (directEq >= 0) {
      values[key.slice(0, directEq)] = key.slice(directEq + 1);
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
      continue;
    }
    values[key] = "";
  }
  return { values, bools };
}

export function parseSelector(args: string[]): { ok: true; account?: string } | { ok: false; error: string } {
  const parsed = parseFlags(args);
  const account = parsed.values.account?.trim();
  const all = parsed.bools.all ?? false;
  if (account && all) {
    return { ok: false, error: "Use either --account X or --all, not both." };
  }
  return { ok: true, account: account || undefined };
}

export async function resolveRosterFiles(rosterDir: string, account?: string): Promise<AccountRosterFile[]> {
  if (account) {
    return [{ account, filePath: path.join(rosterDir, `${account}.yaml`) }];
  }

  let entries: string[];
  try {
    entries = await fs.readdir(rosterDir);
  } catch (err) {
    throw new Error(`Could not read roster directory ${rosterDir}: ${(err as Error).message}`);
  }

  return entries
    .filter((name) => name.endsWith(".yaml"))
    .filter((name) => name !== "demo.yaml")
    .sort()
    .map((name) => ({
      account: path.basename(name, ".yaml"),
      filePath: path.join(rosterDir, name),
    }));
}

export function renderTextTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]) =>
    cells.map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  return [format(headers), divider, ...rows.map((row) => format(row))].join("\n");
}

export async function appendWorkflowSummary(markdown: string): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await fs.appendFile(summaryPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
}

export async function computeCrewInputHash(
  officerDatabasePath: string,
  taskDirectory: string,
  rosterPath: string,
): Promise<string> {
  const [officerRaw, rosterRaw] = await Promise.all([
    fs.readFile(officerDatabasePath, "utf8"),
    fs.readFile(rosterPath, "utf8"),
  ]);

  let taskFiles: string[];
  try {
    taskFiles = (await fs.readdir(taskDirectory)).filter((name) => name.endsWith(".yaml")).sort();
  } catch (err) {
    throw new Error(`Could not read task directory ${taskDirectory}: ${(err as Error).message}`);
  }

  const taskContents = await Promise.all(
    taskFiles.map(async (fileName) => {
      const raw = await fs.readFile(path.join(taskDirectory, fileName), "utf8");
      return `${fileName}\n${raw}`;
    }),
  );

  return createHash("sha256")
    .update(officerRaw)
    .update("\n---\n")
    .update(taskContents.join("\n---\n"))
    .update("\n---\n")
    .update(rosterRaw)
    .digest("hex");
}

export async function writeCrewDocIfChanged(args: {
  docsDir: string;
  account: string;
  inputHash: string;
  markdownBody: string;
}): Promise<"written" | "skipped"> {
  const filePath = path.join(args.docsDir, `${args.account}.md`);
  const existingHash = await readExistingInputHash(filePath);
  if (existingHash === args.inputHash) {
    return "skipped";
  }

  await fs.mkdir(args.docsDir, { recursive: true });
  const content = `<!-- input-hash: ${args.inputHash} -->\n${args.markdownBody}`;
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return "written";
}

async function readExistingInputHash(filePath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  const match = /^<!--\s*input-hash:\s*([a-f0-9]{64})\s*-->$/.exec(firstLine.trim());
  return match ? match[1]! : null;
}

export function determineExitCode(args: { infraErrors: string[]; accountStatuses: Array<"ok" | "degraded"> }): number {
  if (args.infraErrors.length > 0) return 1;
  const hasAccounts = args.accountStatuses.length > 0;
  const allDegraded = hasAccounts && args.accountStatuses.every((status) => status === "degraded");
  return allDegraded ? 2 : 0;
}
