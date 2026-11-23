import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRefreshedAccount, mergeRefreshedAccounts } from "../../scripts/refresh-account.mjs";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

  it("preserves separate overrides and rejects two overrides for the same identity", async () => {
    const updatedOne = token("one") + "new";
    const updatedTwo = token("two") + "new";
    const identify: typeof fetch = async (_url, options) => {
      const credential = String((options?.headers as Record<string, string>).Authorization).slice(7);
      const id = JSON.parse(Buffer.from(credential.split(".")[1]!, "base64url").toString()).accountId;
      return new Response(JSON.stringify({ payload: { accountId: id } }));
    };
    const one = JSON.stringify({ token: updatedOne });
    const two = JSON.stringify({ token: updatedTwo });
    assert.deepEqual(await mergeRefreshedAccounts(JSON.stringify(original), [one, two], identify), [
      { name: "main", token: updatedOne }, { name: "alt", token: updatedTwo },
    ]);
    await assert.rejects(mergeRefreshedAccounts(JSON.stringify(original), [one, one], identify), /inventory was not changed/);
  });

  it("keeps recovery verification manual, read-only, and on the shared queue", () => {
    const workflow = parse(readFileSync(".github/workflows/check-recovery-auth.yml", "utf8"));
    assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.equal(workflow.concurrency.group, "stfc-gift-redeemer");
    const run = workflow.jobs.check.steps.at(-1).run;
    assert.match(run, /mergeRefreshedAccounts/);
    assert.match(run, /verifiedIdentity\(account\.token\)/);
    assert.match(run, /verifyGiftAccess\(account\.token\)/);
    assert.doesNotMatch(run, /skill:run-all|claim-gifts|redeem-codes|secret.*set/);
  });

  it("fails the actual workflow when identity succeeds but the gift list rejects the token", () => {
    const workflow = parse(readFileSync(".github/workflows/check-recovery-auth.yml", "utf8"));
    const run: string = workflow.jobs.check.steps.at(-1).run;
    const script = run.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
    assert.ok(script);
    for (const [giftStatus, expectedStatus] of [[401, 1], [200, 0]] as const) {
      const stub = `globalThis.fetch = async (url, opts) => {
        if (opts.headers.Authorization !== ${JSON.stringify(`Bearer ${fresh}`)}) throw new Error("wrong token");
        if (url.endsWith("/auth/me")) return new Response('{"payload":{"accountId":"one"}}');
        if (url.endsWith("/offers/gifts?available=true")) return new Response("{}", {status: ${giftStatus}});
        throw new Error("unexpected endpoint");
      };`;
      const result: { status: number | null; stdout: string; stderr: string } = spawnSync(process.execPath, ["--input-type=module", "-e", `${stub}\n${script}`], {
        encoding: "utf8",
        env: { ...process.env, STFC_ACCOUNTS: JSON.stringify([original[0]]), STFC_ACCOUNT_REFRESH: "", STFC_ACCOUNT_REFRESH_RECOVERY: "", REPOSITORY_VARIABLES: "{}" },
      });
      assert.equal(result.status, expectedStatus, result.stderr);
      assert.match(result.stdout, giftStatus === 401 ? /0\/1 accounts accepted/ : /1\/1 accounts accepted/);
    }
  });

  it("applies both overrides in each workflow and refuses duplicate identities", () => {
    const updatedOne = token("one") + "new";
    const updatedTwo = token("two") + "new";
    const stub = `globalThis.fetch = async (url, opts) => {
      if (url.endsWith("/auth/me")) {
        const token = opts.headers.Authorization.slice(7);
        const accountId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).accountId;
        return new Response(JSON.stringify({payload: {accountId}}));
      }
      if (url.endsWith("/offers/gifts?available=true")) return new Response("{}");
      throw new Error("unexpected endpoint");
    };`;
    for (const [file, job, stepName] of [
      [".github/workflows/redeem.yml", "redeem", "Load legacy account tokens"],
      [".github/workflows/check-recovery-auth.yml", "check", "Verify legacy inventory and refresh without redemption"],
    ] as const) {
      const workflow = parse(readFileSync(file, "utf8"));
      const step = workflow.jobs[job].steps.find((item: { name?: string }) => item.name === stepName);
      const script = step.run.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
      assert.ok(script, file);
      const directory = mkdtempSync(join(tmpdir(), "stfc-override-test-"));
      const output = join(directory, "stfc-accounts.json");
      try {
        for (const duplicate of [false, true]) {
          const result = spawnSync(process.execPath, ["--input-type=module", "-e", `${stub}\n${script}`], {
            encoding: "utf8",
            env: {
              ...process.env, RUNNER_TEMP: directory, REPOSITORY_VARIABLES: "{}",
              STFC_ACCOUNTS: JSON.stringify(original), STFC_ACCOUNT_REFRESH: JSON.stringify({ token: updatedOne }),
              STFC_ACCOUNT_REFRESH_RECOVERY: JSON.stringify({ token: duplicate ? updatedOne : updatedTwo }),
            },
          });
          assert.equal(result.status, duplicate ? 1 : 0, `${file}: ${result.stderr}`);
          if (job === "redeem") {
            assert.equal(existsSync(output), !duplicate);
            if (!duplicate) {
              assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
                { name: "main", token: updatedOne }, { name: "alt", token: updatedTwo },
              ]);
              rmSync(output);
            }
          } else {
            assert.match(duplicate ? result.stderr : result.stdout,
              duplicate ? /could not be verified/ : /2\/2 accounts accepted/);
          }
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("handles capture during pending navigation without hiding genuine navigation errors", () => {
    const script = `
      import { EventEmitter } from "node:events";
      import assert from "node:assert/strict";
      import { captureFromPage } from "./scripts/refresh-account.mjs";
      const token = ${JSON.stringify(fresh)};
      const context = new EventEmitter();
      let rejectNavigation;
      const page = { goto() { return new Promise((_, reject) => { rejectNavigation = reject; }); } };
      const browser = { async close() { rejectNavigation?.(new Error("Target page, context or browser has been closed")); } };
      const captured = captureFromPage(browser, context, page);
      context.emit("request", {
        url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me",
        headers: () => ({ authorization: "Bearer " + token }),
      });
      assert.equal((await captured).token, token);
      const failingContext = new EventEmitter();
      const failed = captureFromPage({ close: async () => {} }, failingContext,
        { goto: async () => { throw new Error("navigation failed"); } });
      await assert.rejects(failed, /navigation failed/);
      assert.equal(failingContext.listenerCount("request"), 0);
      const simultaneousContext = new EventEmitter();
      let rejectSimultaneous;
      const simultaneous = captureFromPage(
        { async close() { rejectSimultaneous?.(new Error("net::ERR_CONNECTION_RESET")); } },
        simultaneousContext,
        { goto() { return new Promise((_, reject) => { rejectSimultaneous = reject; }); } },
      );
      simultaneousContext.emit("request", {
        url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me",
        headers: () => ({ authorization: "Bearer " + token }),
      });
      await assert.rejects(simultaneous, /net::ERR_CONNECTION_RESET/);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });

  it("refuses publishing outside an interactive terminal", () => {
    const result = spawnSync(process.execPath, ["scripts/refresh-account.mjs", "--publish"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Secure account refresh failed/);
  });

  it("references the same one-time secret in both workflows and the publisher", () => {
    const name = "STFC_ACCOUNT_REFRESH_61690F065F04521CBA2CAE742A6BEC0DB2606A8E38A2FF74AEA5E1CB58D4E854";
    const script = readFileSync("scripts/refresh-account.mjs", "utf8");
    assert.match(script, new RegExp(`const REFRESH_SECRET = '${name}'`));
    for (const file of [".github/workflows/redeem.yml", ".github/workflows/check-recovery-auth.yml"]) {
      const workflow = parse(readFileSync(file, "utf8"));
      const job = file.includes("redeem.yml") ? "redeem" : "check";
      const step = workflow.jobs[job].steps.find(
        (item: { env?: Record<string, string> }) => item.env?.STFC_ACCOUNT_REFRESH_RECOVERY,
      );
      assert.equal(step.env.STFC_ACCOUNT_REFRESH_RECOVERY, `\${{ secrets.${name} }}`);
    }
  });
});
