export function verifiedIdentity(token: string, fetchImpl?: typeof fetch): Promise<string>;
export function verifyGiftAccess(token: string, fetchImpl?: typeof fetch): Promise<void>;
export function mergeRefreshedAccount(raw: string, refreshed: string, fetchImpl?: typeof fetch): Promise<Array<{ name: string; token: string }>>;
export function mergeRefreshedAccounts(raw: string, overrides: string[], fetchImpl?: typeof fetch): Promise<Array<{ name: string; token: string }>>;
export function captureFromPage(browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page): Promise<{ token: string | null; source: string }>;
