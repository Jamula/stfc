import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TokenAccountStore,
  TokenAccountStoreError,
  type AccountSnapshot,
  type ConditionalAccountBlob,
} from "../../shared/token-accounts.ts";

const TOKEN_1 = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature";
const TOKEN_2 = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIyIn0.signature";

class MemoryBlob implements ConditionalAccountBlob {
  etag = '"v1"';
  content = JSON.stringify([{ name: "main", token: TOKEN_1 }]);

  async read(): Promise<AccountSnapshot> {
    return { content: this.content, etag: this.etag };
  }

  async writeIfMatch(content: string, etag: string): Promise<void> {
    if (etag !== this.etag) throw new TokenAccountStoreError("Concurrent update.", 409);
    this.content = content;
    this.etag = '"v2"';
  }
}

describe("conditional STFC token account store", () => {
  it("updates one account without returning or exposing token values", async () => {
    const blob = new MemoryBlob();
    const store = new TokenAccountStore(blob, () => new Date("2026-11-14T00:00:00.000Z"));

    const receipt = await store.replace("main", TOKEN_2);

    assert.deepEqual(receipt, {
      accountName: "main",
      added: false,
      updatedAt: "2026-11-14T00:00:00.000Z",
    });
    assert.equal(JSON.stringify(receipt).includes(TOKEN_2), false);
    assert.deepEqual(JSON.parse(blob.content), [{ name: "main", token: TOKEN_2 }]);
  });

  it("adds a named account while preserving existing accounts", async () => {
    const blob = new MemoryBlob();
    const store = new TokenAccountStore(blob);

    const receipt = await store.replace("alt-1", TOKEN_2);

    assert.equal(receipt.added, true);
    assert.deepEqual(JSON.parse(blob.content), [
      { name: "main", token: TOKEN_1 },
      { name: "alt-1", token: TOKEN_2 },
    ]);
  });

  it("refuses to write when the ETag has changed", async () => {
    const blob = new MemoryBlob();
    const stale = await blob.read();
    blob.etag = '"v2"';
    const store = new TokenAccountStore({
      read: async () => stale,
      writeIfMatch: (content, etag) => blob.writeIfMatch(content, etag),
    });

    await assert.rejects(store.replace("main", TOKEN_2), TokenAccountStoreError);
    assert.deepEqual(JSON.parse(blob.content), [{ name: "main", token: TOKEN_1 }]);
  });

  it("rejects malformed or duplicate stored entries before changing the blob", async () => {
    for (const content of [
      "not-json",
      "[]",
      JSON.stringify([{ name: "main", token: TOKEN_1 }, { name: "main", token: TOKEN_2 }]),
      JSON.stringify([{ name: "main", token: "not-a-jwt", extra: true }]),
      JSON.stringify([{ name: "invalid/name", token: TOKEN_1 }]),
      JSON.stringify([{ name: "main", token: TOKEN_1, extra: true }]),
    ]) {
      const blob = new MemoryBlob();
      blob.content = content;
      const store = new TokenAccountStore(blob);
      await assert.rejects(store.replace("main", TOKEN_2), TokenAccountStoreError);
      assert.equal(blob.content, content);
    }
  });
});
