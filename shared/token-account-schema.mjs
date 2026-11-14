const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isTokenAccounts(value) {
  if (!Array.isArray(value) || value.length === 0) return false;

  const seen = new Set();
  return value.every((entry) => {
    if (
      typeof entry !== "object" || entry === null || Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      typeof entry.name !== "string" || !ACCOUNT_NAME.test(entry.name) ||
      typeof entry.token !== "string" || !JWT_SHAPE.test(entry.token) ||
      seen.has(entry.name)
    ) {
      return false;
    }
    seen.add(entry.name);
    return true;
  });
}
