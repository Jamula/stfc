import type { CommandChannelAllowlistEntry, DiscordMessage } from "./schemas.ts";

const PREFIX = "!crew";
const WINDOW_MS = 60_000;
const CHANNEL_LIMIT = 10;
const USER_LIMIT = 5;

export interface CrewCommand {
  subcommand: string;
  args: Record<string, string>;
  raw: string;
  message: DiscordMessage;
}

export interface CrewCommandResponder {
  postMessage(channelId: string, content: string): Promise<unknown>;
}

export interface CrewCommandProcessStats {
  seen: number;
  ignored: number;
  processed: number;
  rateLimited: number;
}

export interface CrewCommandRateLimitResult {
  allowed: boolean;
  scope?: "channel" | "user";
  key?: string;
}

export class CrewCommandRateLimiter {
  private readonly channelWindows = new Map<string, number[]>();
  private readonly userWindows = new Map<string, number[]>();

  check(command: CrewCommand, now: Date = new Date()): CrewCommandRateLimitResult {
    const nowMs = now.getTime();
    const channelKey = command.message.channel_id;
    const userKey = command.message.author.id;

    const channelHits = pruneWindow(this.channelWindows, channelKey, nowMs);
    if (channelHits.length >= CHANNEL_LIMIT) {
      return { allowed: false, scope: "channel", key: channelKey };
    }

    const userHits = pruneWindow(this.userWindows, userKey, nowMs);
    if (userHits.length >= USER_LIMIT) {
      return { allowed: false, scope: "user", key: userKey };
    }

    channelHits.push(nowMs);
    userHits.push(nowMs);
    return { allowed: true };
  }
}

export const CREW_COMMAND_HELP = [
  "**STFC crew commands**",
  "- `!crew best <task> [--account X]` — coming in #92",
  "- `!crew status [--account X]` — coming in #92",
  "- `!crew progression [--account X]` — coming in #92",
  "- `!crew explain <officer>` — coming in #92",
  "- `!crew synergy <group>` — coming in #92",
  "- `!crew tasks` — coming in #92",
  "- `!crew officers [--owned]` — coming in #92",
  "- `!crew roster show [--account X]` — coming in #92",
  "- `!crew knowledge <q>` — coming in #93",
  "- `!crew help` — this command",
  "",
  "Full operator guide: `docs/CREW-OPTIMIZER.md`",
].join("\n");

export function isCrewCommandPrefix(content: string): boolean {
  if (!content.startsWith(PREFIX)) return false;
  const next = content.at(PREFIX.length);
  return next === undefined || /\s/.test(next);
}

export function parseCrewCommand(
  message: DiscordMessage,
  allowlist: CommandChannelAllowlistEntry[],
): CrewCommand | undefined {
  if (allowlist.length === 0) return undefined;
  if (!isCommandChannelAllowed(message, allowlist)) return undefined;
  if (!isCrewCommandPrefix(message.content)) return undefined;

  const rest = message.content.slice(PREFIX.length).trim();
  const tokens = tokenizeArgs(rest);
  const subcommand = tokens.shift() ?? "help";
  return {
    subcommand,
    args: parseArgs(tokens),
    raw: message.content,
    message,
  };
}

export function handleCrewCommand(command: CrewCommand): string {
  if (command.subcommand.toLowerCase() === "help") return CREW_COMMAND_HELP;
  return `Subcommand '${command.subcommand}' not yet implemented. See \`!crew help\` for what's coming.`;
}

export async function processCrewCommands(
  messages: DiscordMessage[],
  allowlist: CommandChannelAllowlistEntry[],
  responder: CrewCommandResponder,
  options: {
    now?: Date | (() => Date);
    rateLimiter?: CrewCommandRateLimiter;
    logger?: (message: string) => void;
  } = {},
): Promise<CrewCommandProcessStats> {
  const rateLimiter = options.rateLimiter ?? new CrewCommandRateLimiter();
  const stats: CrewCommandProcessStats = {
    seen: 0,
    ignored: 0,
    processed: 0,
    rateLimited: 0,
  };

  for (const message of messages) {
    const command = parseCrewCommand(message, allowlist);
    if (command === undefined) {
      stats.ignored++;
      continue;
    }
    stats.seen++;

    const now = typeof options.now === "function" ? options.now() : options.now ?? new Date();
    const limit = rateLimiter.check(command, now);
    if (!limit.allowed) {
      stats.rateLimited++;
      options.logger?.(
        `rate-limited !crew command in ${limit.scope ?? "unknown"} ${limit.key ?? "unknown"}`,
      );
      continue;
    }

    await responder.postMessage(message.channel_id, handleCrewCommand(command));
    stats.processed++;
  }

  return stats;
}

export function isCommandChannelAllowed(
  message: DiscordMessage,
  allowlist: CommandChannelAllowlistEntry[],
): boolean {
  const guildId = message.guild_id;
  return allowlist.some((entry) =>
    entry.channel_id === message.channel_id &&
    (guildId === undefined || entry.guild_id === guildId),
  );
}

export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (quote !== null && ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += "\\";
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function parseArgs(tokens: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.startsWith("--") && token.length > 2) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next !== undefined && !(next.startsWith("--") && next.length > 2)) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
      continue;
    }
    positional.push(token);
  }

  positional.forEach((value, index) => {
    args[`_${index}`] = value;
  });
  if (positional.length > 0) args._ = positional.join(" ");
  return args;
}

function pruneWindow(map: Map<string, number[]>, key: string, nowMs: number): number[] {
  const cutoff = nowMs - WINDOW_MS;
  const hits = (map.get(key) ?? []).filter((ts) => ts > cutoff);
  map.set(key, hits);
  return hits;
}
