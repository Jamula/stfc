// Entry-point dispatcher. The ONLY file that calls process.exit. Loads
// accounts, builds the summary writer, picks a skill by argv[2], and
// surfaces infrastructure failures as exit code 1 with a one-section
// summary so the GitHub Actions UI never silently passes.

import { AccountsConfigError, loadAccounts, type Account } from "./lib/accounts.ts";
import { createLogger } from "./lib/logger.ts";
import { redactForLog } from "./lib/redact.ts";
import { createSummaryWriter, heading, type SummaryWriter } from "./lib/summary.ts";
import { runAll } from "./skills/runAll.ts";
import { checkAuth } from "./skills/checkAuth.ts";
import { listGifts } from "./skills/listGifts.ts";
import { claimGifts } from "./skills/claimGifts.ts";
import { redeemCodes } from "./skills/redeemCodes.ts";

const log = createLogger("cli");

const PROMO_CODES_PATH = "promo-codes.txt";

const SKILLS = ["run-all", "check-auth", "list-gifts", "claim-gifts", "redeem-codes"] as const;
type SkillName = (typeof SKILLS)[number];

interface SkillOptions {
  accounts: Account[];
  promoCodesPath?: string;
  summary?: SummaryWriter;
}
type SkillOutput = { result: unknown; exitCode: number };
type SkillFn = (opts: SkillOptions) => Promise<SkillOutput>;

const SKILL_FNS: Record<SkillName, SkillFn> = {
  "run-all": (o) => runAll(o),
  "check-auth": (o) => checkAuth(o),
  "list-gifts": (o) => listGifts(o),
  "claim-gifts": (o) => claimGifts(o),
  "redeem-codes": (o) => redeemCodes(o),
};

async function main(): Promise<number> {
  const skillName = (process.argv[2] ?? "").trim();
  if (!isSkillName(skillName)) {
    printUsage(skillName);
    return 2;
  }

  const summary = createSummaryWriter();

  let accounts: Account[];
  try {
    accounts = loadAccounts();
  } catch (err) {
    if (err instanceof AccountsConfigError) {
      log.error(err.message);
      await safeAppendSummary(summary, renderInfraError("Account configuration error", err.message));
      return 1;
    }
    throw err;
  }

  try {
    const skill = SKILL_FNS[skillName];
    const out = await skill({ accounts, promoCodesPath: PROMO_CODES_PATH, summary });
    return out.exitCode;
  } catch (err) {
    const detail = redactForLog(err);
    log.error(`uncaught failure in skill "${skillName}": ${detail}`);
    await safeAppendSummary(summary, renderInfraError(`Uncaught failure in "${skillName}"`, detail));
    return 1;
  }
}

function isSkillName(s: string): s is SkillName {
  return (SKILLS as readonly string[]).includes(s);
}

function printUsage(attempted: string): void {
  const list = SKILLS.join(", ");
  if (attempted.length === 0) {
    log.error(`Usage: stfc-gift-redeemer <skill>\n  available skills: ${list}`);
  } else {
    log.error(`Unknown skill "${attempted}".\n  available skills: ${list}`);
  }
}

function renderInfraError(title: string, detail: string): string {
  return [
    heading(1, "❌ STFC Gift Redeemer"),
    heading(2, title),
    "",
    "```",
    detail,
    "```",
    "",
  ].join("\n");
}

async function safeAppendSummary(summary: SummaryWriter, markdown: string): Promise<void> {
  try {
    await summary.append(markdown);
  } catch (err) {
    log.warn(`could not write summary: ${redactForLog(err)}`);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log.error(`fatal: ${redactForLog(err)}`);
    process.exit(1);
  },
);
