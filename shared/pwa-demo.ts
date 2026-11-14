export type DemoAccount = 'alpha' | 'beta';
export const DEMO_OTP = '123456';
export const DEMO_EMAILS: Record<DemoAccount, string> = {
  alpha: 'alpha@example.invalid',
  beta: 'beta@example.invalid',
};

export interface DemoReceipt {
  account: DemoAccount;
  email: string;
  revision: number;
}

/** Synthetic, process-local store. Never used by the redemption workflow. */
export class DemoTokenStore {
  private readonly records = new Map<DemoAccount, { token: string; revision: number }>();

  revision(account: DemoAccount): number {
    return this.records.get(account)?.revision ?? 0;
  }

  capture(account: DemoAccount, verifiedAccount: string, expectedRevision: number): DemoReceipt {
    if (verifiedAccount !== account) throw new Error('Account binding mismatch');
    if (expectedRevision !== this.revision(account)) throw new Error('Stale account revision; start again');
    const revision = expectedRevision + 1;
    this.records.set(account, { token: `synthetic-only:${account}:${revision}`, revision });
    return { account, email: DEMO_EMAILS[account], revision };
  }
}
