export interface TokenAccountRecord {
  name: string;
  token: string;
}

const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isTokenAccounts(value: unknown): value is TokenAccountRecord[] {
  if (!Array.isArray(value) || value.length === 0) return false;

  const seen = new Set<string>();
  return value.every((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    const name = record["name"];
    const token = record["token"];
    if (
      Object.keys(record).length !== 2 ||
      typeof name !== "string" ||
      !ACCOUNT_NAME.test(name) ||
      typeof token !== "string" ||
      !JWT_SHAPE.test(token) ||
      seen.has(name)
    ) {
      return false;
    }
    seen.add(name);
    return true;
  });
}
