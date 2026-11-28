import { isTokenAccounts } from "./token-account-schema.ts";

export interface TokenAccount {
  name: string;
  token: string;
}

export interface AccountSnapshot {
  content: string;
  etag: string;
}

export interface ConditionalAccountBlob {
  read(): Promise<AccountSnapshot>;
  writeIfMatch(content: string, etag: string): Promise<void>;
}

export interface TokenUpdateReceipt {
  accountName: string;
  added: boolean;
  updatedAt: string;
}

export class TokenAccountStoreError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 503,
  ) {
    super(message);
    this.name = "TokenAccountStoreError";
  }
}

function parseAccounts(content: string): TokenAccount[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new TokenAccountStoreError("Stored account data is invalid.", 503);
  }
  if (!isTokenAccounts(value)) {
    throw new TokenAccountStoreError("Stored account data is invalid.", 503);
  }
  return value;
}

export class TokenAccountStore {
  constructor(
    private readonly blob: ConditionalAccountBlob,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listNames(): Promise<string[]> {
    const snapshot = await this.blob.read();
    return parseAccounts(snapshot.content).map(({ name }) => name);
  }

  async replace(name: string, token: string): Promise<TokenUpdateReceipt> {
    if (!isTokenAccounts([{ name, token }])) {
      throw new TokenAccountStoreError("Invalid account update.", 503);
    }

    const snapshot = await this.blob.read();
    const accounts = parseAccounts(snapshot.content);
    const index = accounts.findIndex((account) => account.name === name);
    const added = index === -1;
    if (added) accounts.push({ name, token });
    else accounts[index] = { name, token };

    await this.blob.writeIfMatch(JSON.stringify(accounts), snapshot.etag);
    return { accountName: name, added, updatedAt: this.now().toISOString() };
  }
}
