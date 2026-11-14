export interface TokenAccountRecord {
  name: string;
  token: string;
}

export function isTokenAccounts(value: unknown): value is TokenAccountRecord[];
