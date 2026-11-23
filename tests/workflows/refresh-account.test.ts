import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRefreshedAccount } from "../../scripts/refresh-account.mjs";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

function token(id: string) {
  return `header.${Buffer.from(JSON.stringify({ accountId: id })).toString("base64url")}.signature`;
}
const fresh = token("one");
const original = [
  { name: "main", token: token("one") },
  { name: "alt", token: token("two") },
];
const reply: typeof fetch = async (_url, options) => {
  assert.equal(_url, "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me");
  assert.equal(options?.redirect, "error");
  return new Response('{"payload":{"accountId":"one"}}', { status: 200 });
};

describe("manual refresh inventory safety", () => {
  it("replaces exactly the verified identity, preserving labels and every other account", async () => {
    const refreshed = `${fresh.slice(0, -9)}newsignature`;
    const merged = await mergeRefreshedAccount(JSON.stringify(original), JSON.stringify({ token: refreshed }), reply);
    assert.deepEqual(merged, [{ name: "main", token: refreshed }, original[1]]);
    assert.equal(original[0]!.token, fresh);
  });

  it("rejects mismatched, ambiguous and missing identities without revealing credential data", async () => {
    const cases = [
      [original[1]],
      [original[0], { name: "duplicate-identity", token: fresh }],
      [{ name: "main", token: "header.e30.signature" }],
    ];
    for (const accounts of cases) {
      await assert.rejects(
        mergeRefreshedAccount(JSON.stringify(accounts), JSON.stringify({ token: fresh }), reply),
        (error: Error) => error.message.includes("inventory was not changed") && !error.message.includes(fresh),
      );
    }
    for (const body of [
      '{"payload":{"accountId":"one","accountId":"two"}}',
      '{"payload":{"accountId":1.5}}',
      '{"payload":{}}',
    ]) {
      await assert.rejects(mergeRefreshedAccount(JSON.stringify(original), JSON.stringify({ token: fresh }),
        async () => new Response(body)));
    }
    await assert.rejects(mergeRefreshedAccount(JSON.stringify(original), JSON.stringify({ token: fresh }),
      async () => { throw new Error(fresh); }), /inventory was not changed/);
    await assert.rejects(mergeRefreshedAccount(JSON.stringify(original), JSON.stringify({ token: fresh }),
      async () => new Response(fresh, { status: 401 })), /inventory was not changed/);
  });

  it("keeps recovery verification manual, read-only, and on the shared queue", () => {
    const workflow = parse(readFileSync(".github/workflows/check-recovery-auth.yml", "utf8"));
    assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.equal(workflow.concurrency.group, "stfc-gift-redeemer");
    const run = workflow.jobs.check.steps.at(-1).run;
    assert.match(run, /mergeRefreshedAccount/);
    assert.match(run, /verifiedIdentity\(account\.token\)/);
    assert.doesNotMatch(run, /skill:run-all|claim-gifts|redeem-codes|secret.*set/);
  });
});
