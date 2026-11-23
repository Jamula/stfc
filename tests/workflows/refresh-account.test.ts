import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeAvailableRefreshedAccounts,
  mergeRefreshedAccount,
  mergeRefreshedAccounts,
  runGithubSecretCommand,
  verifyGiftAccess,
} from "../../scripts/refresh-account.mjs";
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
  assert.match((options?.headers as Record<string, string>).Authorization ?? "", /^Bearer header\./);
  assert.equal(options?.redirect, "error");
  if (String(_url).endsWith("/auth/me")) {
    return new Response('{"payload":{"accountId":"one"}}', {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  assert.equal(_url, "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/offers/gifts?available=true");
  return new Response("[]", { headers: { "content-type": "application/json" } });
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
        async () => new Response(body, { headers: { "content-type": "application/json" } })));
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
      if (String(_url).endsWith("/offers/gifts?available=true")) {
        return new Response("[]", { headers: { "content-type": "application/json" } });
      }
      const id = JSON.parse(Buffer.from(credential.split(".")[1]!, "base64url").toString()).accountId;
      return new Response(JSON.stringify({ payload: { accountId: id } }), {
        headers: { "content-type": "application/json" },
      });
    };
    const one = JSON.stringify({ token: updatedOne });
    const two = JSON.stringify({ token: updatedTwo });
    assert.deepEqual(await mergeRefreshedAccounts(JSON.stringify(original), [one, two], identify), [
      { name: "main", token: updatedOne }, { name: "alt", token: updatedTwo },
    ]);
    await assert.rejects(mergeRefreshedAccounts(JSON.stringify(original), [one, one], identify), /inventory was not changed/);
  });

  it("uses the production gift-list response contract for refresh validation", async () => {
    for (const body of [
      "[]",
      '{"items":[{"bundle_id":7,"title":"gift"}]}',
      '{"data":[]}',
      '{"gifts":[]}',
    ]) {
      await verifyGiftAccess(fresh, async () => new Response(body, {
        headers: { "content-type": "application/json" },
      }));
    }

    for (const response of [
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      new Response("{", { headers: { "content-type": "application/json" } }),
      new Response("{}", { headers: { "content-type": "application/json" } }),
      new Response('{"items":[null]}', { headers: { "content-type": "application/json" } }),
      new Response("[]", { status: 302, headers: { "content-type": "application/json" } }),
      new Response("[]", { status: 401, headers: { "content-type": "application/json" } }),
      new Response("[]", { status: 503, headers: { "content-type": "application/json" } }),
    ]) {
      await assert.rejects(verifyGiftAccess(fresh, async (url, options) => {
        assert.equal(url, "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/offers/gifts?available=true");
        assert.equal(options?.redirect, "error");
        return response.clone();
      }));
    }
    const redirected = new Response("[]", { headers: { "content-type": "application/json" } });
    Object.defineProperty(redirected, "redirected", { value: true });
    await assert.rejects(verifyGiftAccess(fresh, async () => redirected));
  });

  it("pins GitHub secret commands to github.com regardless of GH_HOST", () => {
    for (const args of [
      ["secret", "list", "--json", "name"],
      ["secret", "set", "STFC_ACCOUNT_REFRESH_TEST"],
    ]) {
      let actual: { command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } } | undefined;
      const result = runGithubSecretCommand(args, {}, (command, childArgs, options) => {
        actual = { command, args: childArgs, options };
        return { status: 0, stdout: "[]", stderr: "" };
      });
      assert.equal(result.status, 0);
      assert.equal(actual?.command, "gh");
      assert.deepEqual(actual?.args, [...args, "--repo", "github.com/Jamula/stfc"]);
      assert.equal(actual?.options.env?.GH_HOST, "github.com");
    }
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
        if (url.endsWith("/auth/me")) return new Response('{"payload":{"accountId":"one"}}', {
          headers: {"content-type": "application/json"}
        });
        if (url.endsWith("/offers/gifts?available=true")) return new Response("[]", {
          status: ${giftStatus}, headers: {"content-type": "application/json"}
        });
        throw new Error("unexpected endpoint");
      };`;
      const result: { status: number | null; stdout: string; stderr: string } = spawnSync(process.execPath, ["--input-type=module", "-e", `${stub}\n${script}`], {
        encoding: "utf8",
        env: {
          ...process.env, STFC_ACCOUNTS: JSON.stringify([original[0]]), STFC_ACCOUNT_REFRESH: "",
          STFC_ACCOUNT_REFRESH_RECOVERY: JSON.stringify({ token: fresh }), REPOSITORY_VARIABLES: "{}",
        },
      });
      assert.equal(result.status, expectedStatus, result.stderr);
      if (giftStatus === 401) assert.match(result.stderr, /could not be verified/);
      else assert.match(result.stdout, /1\/1 accounts accepted/);
    }
  });

  it("fails recovery verification when the required fresh override is absent", () => {
    const workflow = parse(readFileSync(".github/workflows/check-recovery-auth.yml", "utf8"));
    const run: string = workflow.jobs.check.steps.at(-1).run;
    const script = run.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
    assert.ok(script);
    const stub = `globalThis.fetch = async () => new Response('{"payload":{"accountId":"one"}}', {
      headers: {"content-type": "application/json"}
    });`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `${stub}\n${script}`], {
      encoding: "utf8",
      env: {
        ...process.env, STFC_ACCOUNTS: JSON.stringify([original[0]]), STFC_ACCOUNT_REFRESH: "",
        STFC_ACCOUNT_REFRESH_RECOVERY: "", REPOSITORY_VARIABLES: "{}",
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Required fresh recovery override is missing/);
  });

  it("keeps scheduled redemption on the preserved inventory when overrides fail validation", () => {
    const updatedOne = token("one") + "new";
    const updatedTwo = token("two") + "new";
    const stub = `globalThis.fetch = async (url, opts) => {
      if (url.endsWith("/auth/me")) {
        const token = opts.headers.Authorization.slice(7);
        const accountId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).accountId;
        return new Response(JSON.stringify({payload: {accountId}}), {
          headers: {"content-type": "application/json"}
        });
      }
      if (url.endsWith("/offers/gifts?available=true")) {
        const token = opts.headers.Authorization.slice(7);
        const accountId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).accountId;
        return new Response("[]", {
          status: process.env.REJECT_GIFT_ACCOUNT === accountId ? 403 : 200,
          headers: {"content-type": "application/json"}
        });
      }
      throw new Error("unexpected endpoint");
    };`;
    const workflow = parse(readFileSync(".github/workflows/redeem.yml", "utf8"));
    const step = workflow.jobs.redeem.steps.find((item: { name?: string }) => item.name === "Load legacy account tokens");
    const script = step.run.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
    assert.ok(script);
    const directory = mkdtempSync(join(tmpdir(), "stfc-override-test-"));
    const output = join(directory, "stfc-accounts.json");
    const summary = join(directory, "summary.md");
    try {
      for (const mode of ["valid", "duplicate", "mismatched", "gift-denied"] as const) {
        const recovery = mode === "valid" ? updatedTwo : mode === "duplicate" ? updatedOne : token("unmatched") + "new";
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `${stub}\n${script}`], {
          encoding: "utf8",
          env: {
            ...process.env, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: summary, REPOSITORY_VARIABLES: "{}",
            REJECT_GIFT_ACCOUNT: mode === "gift-denied" ? "two" : "",
            STFC_ACCOUNTS: JSON.stringify(original), STFC_ACCOUNT_REFRESH: JSON.stringify({ token: updatedOne }),
            STFC_ACCOUNT_REFRESH_RECOVERY: JSON.stringify({
              token: mode === "gift-denied" ? updatedTwo : recovery,
            }),
          },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(existsSync(output), true);
        if (mode === "valid") {
          assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
            { name: "main", token: updatedOne }, { name: "alt", token: updatedTwo },
          ]);
        } else {
          assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
            { name: "main", token: updatedOne }, original[1],
          ]);
          assert.match(result.stderr, /1 refresh override\(s\) were rejected/);
          assert.match(readFileSync(summary, "utf8"), /Verified overrides and the preserved `STFC_ACCOUNTS` inventory remain in use/);
        }
        rmSync(output);
        rmSync(summary, { force: true });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
