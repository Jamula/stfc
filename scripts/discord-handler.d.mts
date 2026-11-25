/** Type declarations for scripts/discord-handler.mjs */

export interface DiscordAttachment {
  url: string;
  filename: string;
  size: number;
  content_type?: string;
}

export interface ValidatedDiscordPayload {
  command: string;
  interaction_token: string;
  application_id: string;
  [key: string]: unknown;
}

export interface DiscordClientPayload extends ValidatedDiscordPayload {
  guild_id?: string;
  channel_id?: string;
  discord_message_id?: string;
  jumplink?: string;
  uploader?: string;
  uploader_handle?: string;
  member?: string;
  note?: string;
  attachment?: DiscordAttachment;
}

export interface PersistedDailyIndexEntry {
  filename: string;
  size_bytes: number;
  [key: string]: unknown;
}

export interface DailyIndexEntry extends PersistedDailyIndexEntry {
  captured_at: string;
  uploader: string;
  note: string;
}

export interface PersistedDailyManifestEntry {
  filename: string;
  r2_bucket: string;
  r2_key: string;
  [key: string]: unknown;
}

export interface DailyManifestEntry extends PersistedDailyManifestEntry {
  sha256: string;
  size_bytes?: number;
  content_type?: string;
  captured_at?: string;
  uploader?: string;
  note?: string;
  access?: string;
  retention?: string;
}

export interface DailyManifest {
  version: number;
  bucket: string;
  files: PersistedDailyManifestEntry[];
  [key: string]: unknown;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export type DiscordFetchImpl = (url: string, init?: any) => Promise<any>;

export type SignedR2FetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: Buffer;
    signal: AbortSignal;
  },
) => Promise<any>;

export interface SignedR2RequestOptions {
  config: R2Config;
  key: string;
  buffer?: Buffer;
  contentType?: string;
  fetchImpl?: SignedR2FetchImpl;
  now?: Date;
  timeoutMs?: number;
}

export type ReadFileLike = (path: string, enc: string) => Promise<string>;
export type WriteFileLike = (path: string, data: any, enc?: string) => Promise<void>;
export type MkdirLike = (path: string, opts?: any) => Promise<unknown>;
export type RenameLike = (from: string, to: string) => Promise<void>;
export type RmLike = (path: string, opts?: any) => Promise<void>;
export type RunGhLike = (args: string[]) => Promise<string>;
export type RunGitLike = (args: string[], opts?: { stdin?: string }) => Promise<string>;
export type ReconcileAutomationStateLike = (args: {
  stateDir: string;
  ref: string;
  relativePaths: string[];
}) => Promise<string>;

export interface HandleGameStateOptions {
  payload: DiscordClientPayload;
  repo: string;
  ref: string;
  serverUrl: string;
  r2Config: R2Config;
  fetchImpl?: DiscordFetchImpl;
  runGit?: RunGitLike;
  readFileImpl?: ReadFileLike;
  writeFileImpl?: WriteFileLike;
  mkdirImpl?: MkdirLike;
  renameImpl?: RenameLike;
  rmImpl?: RmLike;
  nowFn?: () => Date;
  reconcileAutomationStateImpl?: ReconcileAutomationStateLike;
}

export interface ResolveResponseTextOptions {
  payload: DiscordClientPayload;
  repo: string;
  workflowRef: string;
  stateRef: string;
  serverUrl: string;
  historyPath: string;
  r2Config?: R2Config;
  runGh?: RunGhLike;
  runGit?: RunGitLike;
  readFileImpl?: ReadFileLike;
  writeFileImpl?: WriteFileLike;
  mkdirImpl?: MkdirLike;
  renameImpl?: RenameLike;
  rmImpl?: RmLike;
  fetchImpl?: DiscordFetchImpl;
  nowFn?: () => Date;
  reconcileAutomationStateImpl?: ReconcileAutomationStateLike;
}

export interface RunCliOptions {
  env?: Record<string, string | undefined>;
  runGh?: RunGhLike;
  runGit?: RunGitLike;
  fetchImpl?: DiscordFetchImpl;
  readFileImpl?: ReadFileLike;
  writeFileImpl?: WriteFileLike;
  mkdirImpl?: MkdirLike;
  renameImpl?: RenameLike;
  rmImpl?: RmLike;
  nowFn?: () => Date;
  reconcileAutomationStateImpl?: ReconcileAutomationStateLike;
  stdout?: { write: (chunk: string) => unknown };
  stderr?: { write: (chunk: string) => unknown };
}

export function validatePayload(payload: unknown): asserts payload is ValidatedDiscordPayload;

export function validateGameStatePayload(payload: DiscordClientPayload): void;

export function sanitizeFilename(input: unknown): string;

export function sanitizeLine(input: unknown, fallback?: string, maxLength?: number): string;

export function parseAllowedGuildIds(raw: unknown): string[];

export function assertGuildAllowed(payload: DiscordClientPayload, allowedGuildIds: readonly string[]): void;

export function validateCdnUrl(rawUrl: string): URL;

export function formatRedeemStatus(historyContent: string, maxLines?: number): string;

export function triggerRedeemWorkflow(options: {
  runGh?: RunGhLike;
  repo: string;
  ref: string;
  serverUrl?: string;
  nowFn?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ runId: string; runUrl: string }>;

export function postDiscordFollowup(options: {
  applicationId: string;
  interactionToken: string;
  content: string;
  botToken: string;
  fetchImpl?: DiscordFetchImpl;
  allowedMentions?: Record<string, unknown>;
}): Promise<unknown>;

export function downloadDiscordAttachment(options: {
  attachment: DiscordAttachment;
  fetchImpl?: DiscordFetchImpl;
  timeoutMs?: number;
}): Promise<{ buffer: Buffer; responseContentType: string }>;

export function updateDailyIndexAtomic(options: {
  indexPath: string;
  entry: DailyIndexEntry;
  readFileImpl?: ReadFileLike;
  writeFileImpl?: (path: string, data: string, enc?: string) => Promise<void>;
  renameImpl?: RenameLike;
}): Promise<{ files: PersistedDailyIndexEntry[] }>;

export function updateDailyManifestAtomic(options: {
  manifestPath: string;
  entry: DailyManifestEntry;
  readFileImpl?: ReadFileLike;
  writeFileImpl?: (path: string, data: string, enc?: string) => Promise<void>;
  renameImpl?: RenameLike;
}): Promise<DailyManifest>;

export function r2ConfigFromEnv(env: Record<string, string | undefined>): R2Config;

export function uploadR2Object(options: SignedR2RequestOptions): Promise<{
  bucket: string;
  key: string;
  sha256: string;
  size: number;
}>;

export function deleteR2Object(options: SignedR2RequestOptions): Promise<{
  bucket: string;
  key: string;
  sha256: string;
  size: number;
}>;

export function handleGameStateCommand(options: HandleGameStateOptions): Promise<{
  responseText: string;
  outFile: string;
  fileUrl: string;
}>;

export function resolveResponseText(options: ResolveResponseTextOptions): Promise<string>;

export function runCli(options?: RunCliOptions): Promise<number>;
