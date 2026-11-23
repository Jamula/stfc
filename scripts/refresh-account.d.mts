export interface GithubSecretCommandOptions {
  encoding?: BufferEncoding;
  input?: string;
  stdio?: NodeJS.StdioOptions[];
  env?: NodeJS.ProcessEnv;
}
export interface GithubSecretCommandResult {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
}
export type GithubSecretCommandRunner = (
  command: string,
  args: string[],
  options: GithubSecretCommandOptions,
) => GithubSecretCommandResult;
export function runGithubSecretCommand(
  args: string[],
  options?: GithubSecretCommandOptions,
  run?: GithubSecretCommandRunner,
): GithubSecretCommandResult;
export function verifiedIdentity(token: string, fetchImpl?: typeof fetch): Promise<string>;
export function verifyGiftAccess(token: string, fetchImpl?: typeof fetch): Promise<void>;
export function mergeRefreshedAccount(raw: string, refreshed: string, fetchImpl?: typeof fetch): Promise<Array<{ name: string; token: string }>>;
export function mergeRefreshedAccounts(raw: string, overrides: string[], fetchImpl?: typeof fetch): Promise<Array<{ name: string; token: string }>>;
export function mergeAvailableRefreshedAccounts(
  raw: string,
  overrides: string[],
  fetchImpl?: typeof fetch,
): Promise<{ accounts: Array<{ name: string; token: string }>; rejectedCount: number }>;
export function captureFromPage(browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page): Promise<{ token: string | null; source: string }>;
