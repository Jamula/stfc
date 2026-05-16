// MINIMAL digest writer — Phase 3 placeholder.
//
// The full implementation (templating, idempotent re-render, byte-compare,
// excerpt truncation, moderation filter) lands at T034 in Phase 4 per
// `specs/001-discord-monitor/plan.md` § Sequence step 9 and the
// `digest-writer.contract.md`.
//
// This stub exists so the orchestrator (T026) can wire in step 9 without
// breaking the contract: it writes a *minimal* but well-formed Markdown file
// containing the codes section and a one-line health note, so daily-digest
// path coverage in the integration test isn't blocked. T034 will replace the
// renderer wholesale.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { DailyDigest } from "../discord/schemas.ts";

export const DEFAULT_DIGESTS_DIR = "data/digests";

export interface WriteDigestOptions {
  digestsDir?: string;
}

export async function writeDigest(
  digest: DailyDigest,
  opts: WriteDigestOptions = {},
): Promise<string> {
  const dir = opts.digestsDir ?? DEFAULT_DIGESTS_DIR;
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${digest.date}.md`);
  await fs.writeFile(file, renderMinimal(digest), "utf8");
  return file;
}

function renderMinimal(digest: DailyDigest): string {
  const lines: string[] = [];
  lines.push(`# STFC Discord digest — ${digest.date}`);
  lines.push("");
  lines.push(
    `_window: ${digest.windowStart} → ${digest.windowEnd}_ (runs: ${digest.runIds.length})`,
  );
  lines.push("");

  lines.push("## Codes");
  lines.push("");
  if (digest.codes.redeemed.length === 0) {
    lines.push("- _no codes redeemed in window_");
  } else {
    for (const r of digest.codes.redeemed) {
      lines.push(
        `- **${r.code}** — redeemed by ${r.accounts.join(", ")} ([source](${r.source.jumpLink}))`,
      );
    }
  }
  for (const f of digest.codes.failed) {
    lines.push(`- ${f.code} — ${f.outcome} ([source](${f.source.jumpLink}))`);
  }
  for (const k of digest.codes.alreadyKnown) {
    lines.push(`- ${k.code} — already-known ([source](${k.source.jumpLink}))`);
  }
  for (const d of digest.codes.deferredCap) {
    lines.push(`- ${d.code} — deferred-cap ([source](${d.source.jumpLink}))`);
  }
  lines.push("");

  lines.push("## Health");
  lines.push("");
  if (digest.health.channelsConfigured === 0) {
    lines.push("- 0 channels configured");
  } else {
    lines.push(
      `- channels: ${digest.health.channelsRead}/${digest.health.channelsConfigured} read, ${digest.health.channelsErrored.length} errored`,
    );
  }
  lines.push(`- messages scanned: ${digest.health.messagesScanned}`);
  lines.push(
    `- candidates: extracted=${digest.health.candidatesExtracted} submitted=${digest.health.candidatesSubmitted} suppressed-dedup=${digest.health.candidatesSuppressedDedup} suppressed-cooldown=${digest.health.candidatesSuppressedCooldown} deferred-cap=${digest.health.candidatesDeferredCap}`,
  );
  lines.push("");

  return lines.join("\n");
}
