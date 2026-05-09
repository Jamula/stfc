// GitHub Actions step-summary writer. When GITHUB_STEP_SUMMARY is set, we
// append rendered Markdown to that file; otherwise this is a no-op (so
// running locally doesn't crash on a missing env var).

import { promises as fs } from "node:fs";

export interface SummaryWriter {
  append(markdown: string): Promise<void>;
  // For tests / local runs: returns the path that would be written, or null.
  readonly path: string | null;
}

export function createSummaryWriter(envValue?: string | undefined): SummaryWriter {
  const target = (envValue ?? process.env.GITHUB_STEP_SUMMARY) || null;
  return {
    path: target,
    async append(markdown: string): Promise<void> {
      if (!target) return;
      await fs.appendFile(target, markdown.endsWith("\n") ? markdown : markdown + "\n", "utf8");
    },
  };
}

// Render helpers — small enough to inline rather than depend on a Markdown lib.

export function table(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";
  const sep = headers.map(() => "---").join(" | ");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep} |`,
    ...rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`),
  ];
  return lines.join("\n") + "\n";
}

export function heading(level: 1 | 2 | 3, text: string): string {
  return `${"#".repeat(level)} ${text}\n`;
}

export function bullet(text: string): string {
  return `- ${text}\n`;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
