export function verifiedIdentity(token: string, fetchImpl?: typeof fetch): Promise<string>;
export function mergeRefreshedAccount(raw: string, refreshed: string, fetchImpl?: typeof fetch): Promise<Array<{ name: string; token: string }>>;
