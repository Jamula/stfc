export const AZURE_TOKEN_CONFIG_KEYS = [
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_SUBSCRIPTION_ID",
  "AZURE_TOKEN_STORAGE_ACCOUNT",
  "AZURE_TOKEN_CONTAINER",
  "AZURE_TOKEN_BLOB",
] as const;

type AzureTokenConfigKey = (typeof AZURE_TOKEN_CONFIG_KEYS)[number];

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const SYSTEM_CONTAINERS = new Set(["$root", "$web", "$logs", "$blobchangefeed"]);

function isTenant(value: string): boolean {
  if (GUID.test(value)) return true;
  const labels = value.split(".");
  return value.length <= 253 && labels.length > 1 &&
    labels.every((label) => label.length <= 63 && DOMAIN_LABEL.test(label));
}

function isContainer(value: string): boolean {
  return SYSTEM_CONTAINERS.has(value) ||
    (value.length >= 3 && value.length <= 63 &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value));
}

const validators: Record<AzureTokenConfigKey, (value: string) => boolean> = {
  AZURE_CLIENT_ID: (value) => GUID.test(value),
  AZURE_TENANT_ID: isTenant,
  AZURE_SUBSCRIPTION_ID: (value) => GUID.test(value),
  AZURE_TOKEN_STORAGE_ACCOUNT: (value) => /^[a-z0-9]{3,24}$/.test(value),
  AZURE_TOKEN_CONTAINER: isContainer,
  AZURE_TOKEN_BLOB: (value) => Array.from(value).length <= 1024 && !/[\u0000-\u001f\u0081]/u.test(value),
};

/** Return variable names only; format checks do not prove Azure access. */
export function validateAzureTokenConfig(env: Record<string, string | undefined>): {
  missing: AzureTokenConfigKey[];
  invalid: AzureTokenConfigKey[];
} {
  const missing: AzureTokenConfigKey[] = [];
  const invalid: AzureTokenConfigKey[] = [];
  for (const key of AZURE_TOKEN_CONFIG_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.trim() === "") {
      missing.push(key);
    } else if (!validators[key](value)) {
      invalid.push(key);
    }
  }
  return { missing, invalid };
}
