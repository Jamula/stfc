/** Type declarations for scripts/discord-ops/set-discord-app-metadata.mjs */

export const DISCORD_API_BASE: string;

export function redactString(input: unknown, token?: string): string;

export interface ParsedDiscordMetadataArgs {
  icon: string | undefined;
  description: string | undefined;
  username: string | undefined;
  dryRun: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedDiscordMetadataArgs;

export type SupportedDiscordImageMime = "image/png" | "image/jpeg" | "image/gif";

export function detectImageMime(buf: Buffer): SupportedDiscordImageMime;

export function probeImageDimensions(
  buf: Buffer,
  mime: string,
): { width: number; height: number } | null;

export interface LoadedDiscordIcon {
  dataUri: string;
  mime: SupportedDiscordImageMime;
  byteLength: number;
  dimensions: { width: number; height: number } | null;
  warnings: string[];
}

export function loadIconAsDataUri(input: string): Promise<LoadedDiscordIcon>;

export function validateDescription(text: unknown): void;

export function validateUsername(name: unknown): void;

export class DiscordApiError extends Error {
  status: number | undefined;
  code: number | undefined;
  constructor(message: string, options?: { status?: number; code?: number });
}

export function discordPatch(options: {
  path: string;
  body: Record<string, unknown>;
  token: string;
  fetchImpl?: (url: string, init?: any) => Promise<any>;
  baseUrl?: string;
}): Promise<unknown>;

export function runCli(options?: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: (url: string, init?: any) => Promise<any>;
  stdout?: { write: (chunk: string) => unknown };
  stderr?: { write: (chunk: string) => unknown };
}): Promise<number>;
