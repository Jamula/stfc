import type { CommandChannelAllowlistEntry, DiscordMessage } from "./schemas.ts";
import {
  handleBest,
  handleExplain,
  handleOfficers,
  handleProgression,
  handleRosterShow,
  handleStatus,
  handleSynergy,
  handleTasks,
} from "../crew/handlers/index.ts";
import { formatHandlerError } from "../crew/handlers/shared.ts";

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

export type CrewCommandHandler = (command: CrewCommand) => Promise<string>;
export type CrewCommandHandlerKey =
  | "best"
  | "status"
  | "progression"
  | "explain"
  | "synergy"
  | "tasks"
  | "officers"
  | "rosterShow";
export type CrewCommandHandlerMap = Record<CrewCommandHandlerKey, CrewCommandHandler>;

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
  "- `!crew best <task> --account X [--top N]` — recommend a crew for a task",
  "- `!crew status --account X` — roster health summary",
  "- `!crew progression --account X` — progression gaps and next actions",
  "- `!crew explain <officer> --account X` — officer detail lookup",
  "- `!crew synergy <group> --account X` — synergy group membership",
  "- `!crew tasks --account X` — known optimization tasks",
  "- `!crew officers --account X [--owned] [--faction X]` — officer inventory",
  "- `!crew roster show --account X` — roster inventory",
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

const DEFAULT_CREW_COMMAND_HANDLERS: CrewCommandHandlerMap = {
  best: handleBest,
  status: handleStatus,
  progression: handleProgression,
  explain: handleExplain,
  synergy: handleSynergy,
  tasks: handleTasks,
  officers: handleOfficers,
  rosterShow: handleRosterShow,
};

export async function handleCrewCommand(
  command: CrewCommand,
  handlers: CrewCommandHandlerMap = DEFAULT_CREW_COMMAND_HANDLERS,
): Promise<string> {
  if (command.subcommand.toLowerCase() === "help") return CREW_COMMAND_HELP;
  const handler = resolveCrewCommandHandler(command, handlers);
  if (!handler) return "Unknown command. Try !crew help.";

  try {
    return await handler(command);
  } catch (err) {
    return `Error: ${formatHandlerError(err)}`;
  }
}

export async function processCrewCommands(
  messages: DiscordMessage[],
  allowlist: CommandChannelAllowlistEntry[],
  responder: CrewCommandResponder,
  options: {
    now?: Date | (() => Date);
    rateLimiter?: CrewCommandRateLimiter;
    logger?: (message: string) => void;
    handlers?: CrewCommandHandlerMap;
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

    const output = await handleCrewCommand(command, options.handlers);
    await responder.postMessage(message.channel_id, output);
    stats.processed++;
  }

  return stats;
}

function resolveCrewCommandHandler(
  command: CrewCommand,
  handlers: CrewCommandHandlerMap,
): CrewCommandHandler | undefined {
  switch (command.subcommand.toLowerCase()) {
    case "best":
      return handlers.best;
    case "status":
      return handlers.status;
    case "progression":
      return handlers.progression;
    case "explain":
      return handlers.explain;
    case "synergy":
      return handlers.synergy;
    case "tasks":
      return handlers.tasks;
    case "officers":
      return handlers.officers;
    case "roster":
      return command.args._0?.toLowerCase() === "show" ? handlers.rosterShow : undefined;
    default:
      return undefined;
  }
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
