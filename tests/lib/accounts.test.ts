import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAccounts, AccountsConfigError } from "../../src/lib/accounts.ts";

function b64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(payload: object = {}): string {
  const h = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  return `${h}.${p}.signaturePartZZZ`;
}

describe("loadAccounts", () => {
  it("loads a single valid account", () => {
    const jwt = makeJwt({ exp: 9999999999 });
    const envValue = JSON.stringify([{ name: "main", token: jwt }]);
    const accounts = loadAccounts({ envValue });
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]!.name, "main");
    assert.equal(accounts[0]!.token, jwt);
  });

  it("loads multiple accounts", () => {
    const a = makeJwt({ a: 1 });
    const b = makeJwt({ b: 2 });
    const envValue = JSON.stringify([
      { name: "main", token: a },
      { name: "alt", token: b },
    ]);
    const accounts = loadAccounts({ envValue });
    assert.equal(accounts.length, 2);
    assert.equal(accounts[1]!.name, "alt");
    assert.equal(accounts[1]!.token, b);
  });

  it("loads accounts from the private token-store file path", () => {
    const jwt = makeJwt({ stored: true });
    const directory = mkdtempSync(join(tmpdir(), "stfc-accounts-test-"));
    const filePath = join(directory, "accounts.json");
    try {
      writeFileSync(filePath, JSON.stringify([{ name: "main", token: jwt }]), "utf8");
      assert.deepEqual(loadAccounts({ filePath }), [{ name: "main", token: jwt }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous env and file sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "stfc-accounts-test-"));
    const filePath = join(directory, "accounts.json");
    try {
      writeFileSync(filePath, "[]", "utf8");
      assert.throws(
        () => loadAccounts({ envValue: "[]", filePath }),
        (err: unknown) =>
          err instanceof AccountsConfigError && /Set only one/.test(err.message),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("missing envValue throws", () => {
    assert.throws(
      () => loadAccounts({ envValue: undefined }),
      (err: unknown) =>
        err instanceof AccountsConfigError &&
        /Neither STFC_ACCOUNTS nor STFC_ACCOUNTS_FILE is set/.test((err as Error).message),
      // also covers process.env.STFC_ACCOUNTS being unset; if it's set in CI we still get an error if invalid
    );
  });

  it("empty envValue throws", () => {
    assert.throws(
      () => loadAccounts({ envValue: "" }),
      (err: unknown) =>
        err instanceof AccountsConfigError &&
        /Neither STFC_ACCOUNTS nor STFC_ACCOUNTS_FILE is set/.test((err as Error).message),
    );
  });

  it("non-JSON throws", () => {
    assert.throws(
      () => loadAccounts({ envValue: "foo" }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /is not valid JSON/.test((err as Error).message),
    );
  });

  it("not an array throws", () => {
    assert.throws(
      () => loadAccounts({ envValue: '{"name":"x","token":"y"}' }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /structure is invalid/.test((err as Error).message),
    );
  });

  it("empty array throws", () => {
    assert.throws(
      () => loadAccounts({ envValue: "[]" }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /at least one account/.test((err as Error).message),
    );
  });

  it("missing name throws", () => {
    const envValue = JSON.stringify([{ token: makeJwt() }]);
    assert.throws(
      () => loadAccounts({ envValue }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /structure is invalid/.test((err as Error).message),
    );
  });

  it("missing token throws", () => {
    const envValue = JSON.stringify([{ name: "main" }]);
    assert.throws(
      () => loadAccounts({ envValue }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /structure is invalid/.test((err as Error).message),
    );
  });

  it("empty token throws", () => {
    const envValue = JSON.stringify([{ name: "main", token: "" }]);
    assert.throws(
      () => loadAccounts({ envValue }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /structure is invalid/.test((err as Error).message),
    );
  });

  it("duplicate names throw", () => {
    const jwt = makeJwt();
    const envValue = JSON.stringify([
      { name: "main", token: jwt },
      { name: "main", token: jwt },
    ]);
    assert.throws(
      () => loadAccounts({ envValue }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /duplicate account name/.test((err as Error).message),
    );
  });

  it("non-JWT-shaped token throws", () => {
    const envValue = JSON.stringify([{ name: "main", token: "not-a-jwt" }]);
    assert.throws(
      () => loadAccounts({ envValue }),
      (err: unknown) =>
        err instanceof AccountsConfigError && /not JWT-shaped/.test((err as Error).message),
    );
  });
});
