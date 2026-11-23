import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeRefreshedAccount,
  mergeRefreshedAccounts,
  publishFromPage,
  runGithubSecretCommand,
  verifiedIdentity,
  verifyGiftAccess,
} from "../../scripts/refresh-account.mjs";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { parse } from "yaml";
import { SchemaMismatchError, TransientError } from "../../src/api/client.ts";

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

function unreadableBodyResponse() {
  const response = new Response(null, {
    status: 200, headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "text", {
    value: async () => { throw new DOMException("The operation timed out", "TimeoutError"); },
  });
  return response;
}

describe("manual refresh inventory safety", () => {
  it("never invokes the secret writer when a login before bearer capture is failed or ambiguous", async () => {
    for (const loginOutcome of ["tokenless", "unreadable", "failed"] as const) {
      const context = new EventEmitter();
      const login = {
        url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/login",
        method: () => "POST",
        headers: () => ({}),
      };
      let writerCalls = 0;
      let secretChecks = 0;
      let verificationCalls = 0;
      const browser = { close: async () => {} };
      const page = {
        async goto() {
          context.emit("request", login);
          if (loginOutcome === "failed") {
            context.emit("requestfailed", login);
          } else {
            context.emit("response", {
              url: () => login.url(),
              request: () => login,
              status: () => 200,
              json: async () => {
                if (loginOutcome === "unreadable") throw new Error("synthetic unreadable body");
                return {};
              },
            });
            context.emit("requestfinished", login);
          }
          context.emit("request", {
            url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me",
            headers: () => ({ authorization: `Bearer ${fresh}` }),
          });
        },
      };

      await assert.rejects(publishFromPage(
        browser as never,
        context as never,
        page as never,
        {
          fetchImpl: (async () => {
            verificationCalls += 1;
            throw new Error("credential verification must not run after ambiguous capture");
          }) as typeof fetch,
          checkSecretAbsent: () => { secretChecks += 1; },
          runSecretCommand: (() => {
            writerCalls += 1;
            return { status: 0, stdout: "", stderr: "" };
          }),
        },
      ), /ambiguous or the browser token changed/);

      assert.equal(writerCalls, 0, `${loginOutcome} login must not reach the secret writer`);
      assert.equal(secretChecks, 0, `${loginOutcome} login must not begin secret publication`);
      assert.equal(verificationCalls, 0, `${loginOutcome} login must fail before credential verification`);
      assert.equal(context.listenerCount("request"), 0);
      assert.equal(context.listenerCount("response"), 0);
      assert.equal(context.listenerCount("requestfinished"), 0);
      assert.equal(context.listenerCount("requestfailed"), 0);
    }
  });

  it("uses the production safe-GET retry policy for identity verification", async () => {
    for (const temporaryStatus of [401, 503]) {
      let attempts = 0;
      const id = await verifiedIdentity(fresh, async (_url, options) => {
        assert.equal(options?.redirect, "error");
        attempts += 1;
        const status = attempts === 1 ? temporaryStatus : 200;
        return new Response('{"payload":{"accountId":"one"}}', {
          status, headers: { "content-type": "application/json" },
        });
      });
      assert.equal(id, "one");
      assert.equal(attempts, 2, `HTTP ${temporaryStatus} should be retried once before identity is accepted`);
    }

    for (const [status, expectedAttempts] of [[401, 2], [503, 2]] as const) {
      let attempts = 0;
      await assert.rejects(verifiedIdentity(fresh, async () => {
        attempts += 1;
        return new Response("{}", { status, headers: { "content-type": "application/json" } });
      }), new RegExp(String(status)));
      assert.equal(attempts, expectedAttempts, `HTTP ${status} should stop at the production retry limit`);
    }

    let nonRetriableAttempts = 0;
    await assert.rejects(verifiedIdentity(fresh, async () => {
      nonRetriableAttempts += 1;
      return new Response("{}", { status: 422, headers: { "content-type": "application/json" } });
    }), /HTTP 422/);
    assert.equal(nonRetriableAttempts, 1, "non-retriable client errors must not be replayed");
  });

  it("retries transient identity-body failures but not malformed or invalid identity data", async () => {
    let attempts = 0;
    const identity = await verifiedIdentity(fresh, async () => {
      attempts += 1;
      return attempts === 1 ? unreadableBodyResponse() : new Response(
        '{"payload":{"accountId":"one"}}',
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    assert.equal(identity, "one");
    assert.equal(attempts, 2, "a 200 response body timeout should receive one safe retry");

    attempts = 0;
    await assert.rejects(verifiedIdentity(fresh, async () => {
      attempts += 1;
      return unreadableBodyResponse();
    }), (error: unknown) => error instanceof TransientError && /timed out/.test(error.message));
    assert.equal(attempts, 2, "identity body timeouts must stop at the existing retry limit");

    for (const body of ["{", '{"payload":{"accountId":1.5}}']) {
      attempts = 0;
      await assert.rejects(verifiedIdentity(fresh, async () => {
        attempts += 1;
        return new Response(body, {
          status: 200, headers: { "content-type": "application/json" },
        });
      }));
      assert.equal(attempts, 1, "malformed JSON and invalid identity data are not transient read failures");
    }
  });

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
      new Response("[]", { status: 201, headers: { "content-type": "application/json" } }),
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

  it("uses the production retry budget for temporary gift-list authentication and server failures", async () => {
    for (const temporaryStatus of [401, 503]) {
      let attempts = 0;
      await verifyGiftAccess(fresh, async (_url, options) => {
        assert.equal(options?.redirect, "error");
        attempts += 1;
        const status = attempts === 1 ? temporaryStatus : 200;
        return new Response("[]", { status, headers: { "content-type": "application/json" } });
      });
      assert.equal(attempts, 2, `HTTP ${temporaryStatus} should be retried once before the successful response`);
    }

    let mixedAttempts = 0;
    const mixedStatuses = [503, 401, 200];
    await verifyGiftAccess(fresh, async () => {
      const status = mixedStatuses[mixedAttempts++]!;
      return new Response("[]", { status, headers: { "content-type": "application/json" } });
    });
    assert.equal(mixedAttempts, 3, "transient retry and auth corroboration share the production three-attempt cap");

    for (const [status, expectedAttempts] of [[401, 2], [503, 2]] as const) {
      let attempts = 0;
      await assert.rejects(verifyGiftAccess(fresh, async () => {
        attempts += 1;
        return new Response("[]", { status, headers: { "content-type": "application/json" } });
      }));
      assert.equal(attempts, expectedAttempts, `HTTP ${status} should stop at the production retry limit`);
    }

    let nonRetriableAttempts = 0;
    await assert.rejects(verifyGiftAccess(fresh, async () => {
      nonRetriableAttempts += 1;
      return new Response("invalid request", { status: 422, headers: { "content-type": "application/json" } });
    }), /HTTP 422/);
    assert.equal(nonRetriableAttempts, 1, "non-retriable client errors must not be replayed");

    let unexpectedSuccessAttempts = 0;
    await assert.rejects(verifyGiftAccess(fresh, async () => {
      unexpectedSuccessAttempts += 1;
      return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
    }));
    assert.equal(unexpectedSuccessAttempts, 1, "a non-200 success status must fail without retries");
  });

  it("retries gift-list body timeouts but not malformed JSON or schema errors", async () => {
    let attempts = 0;
    await verifyGiftAccess(fresh, async () => {
      attempts += 1;
      return attempts === 1 ? unreadableBodyResponse() : new Response("[]", {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    assert.equal(attempts, 2, "a 200 gift-list body timeout should receive one safe retry");

    attempts = 0;
    await assert.rejects(verifyGiftAccess(fresh, async () => {
      attempts += 1;
      return unreadableBodyResponse();
    }), (error: unknown) => error instanceof TransientError && /timed out/.test(error.message));
    assert.equal(attempts, 2, "gift-list body timeouts must stop at the existing retry limit");

    for (const body of ["{", "{}"]) {
      attempts = 0;
      await assert.rejects(verifyGiftAccess(fresh, async () => {
        attempts += 1;
        return new Response(body, {
          status: 200, headers: { "content-type": "application/json" },
        });
      }), (error: unknown) => error instanceof SchemaMismatchError);
      assert.equal(attempts, 1, "malformed JSON and schema errors must not be retried");
    }
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
    assert.match(run, /mergeAvailableRefreshedAccounts/);
    assert.match(run, /acceptedOverrides\[freshOverrideIndex\]/);
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
      if (giftStatus === 401) assert.match(result.stderr, /Fresh recovery override failed/);
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

  it("verifies the effective scheduled inventory and reports prior versus fresh override failures", () => {
    const priorToken = token("two").replace(".signature", ".prior");
    const freshToken = token("two").replace(".signature", ".fresh");
    const workflow = parse(readFileSync(".github/workflows/check-recovery-auth.yml", "utf8"));
    const run: string = workflow.jobs.check.steps.at(-1).run;
    const script = run.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
    assert.ok(script);
    const stub = `globalThis.fetch = async (url, opts) => {
      const credential = opts.headers.Authorization.slice(7);
      const claims = JSON.parse(Buffer.from(credential.split(".")[1], "base64url").toString());
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({
        payload: { accountId: claims.accountId }
      }), { headers: {"content-type": "application/json"} });
      if (url.endsWith("/offers/gifts?available=true")) {
        const rejected = JSON.parse(process.env.REJECT_GIFT_TOKENS);
        return new Response("[]", {
          status: rejected.includes(credential) ? 401 : 200,
          headers: {"content-type": "application/json"}
        });
      }
      throw new Error("unexpected endpoint");
    };`;
    const execute = (rejectedTokens: string[]) => spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `${stub}\n${script}`],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          STFC_ACCOUNTS: JSON.stringify(original),
          STFC_ACCOUNT_REFRESH: JSON.stringify({ token: priorToken }),
          STFC_ACCOUNT_REFRESH_RECOVERY: JSON.stringify({ token: freshToken }),
          REJECT_GIFT_TOKENS: JSON.stringify(rejectedTokens),
          REPOSITORY_VARIABLES: "{}",
        },
      },
    );

    const priorRejected = execute([priorToken, original[1]!.token]);
    assert.equal(priorRejected.status, 0, priorRejected.stderr);
    assert.match(priorRejected.stderr, /older refresh override was rejected/);
    assert.match(priorRejected.stdout, /2\/2 accounts accepted/);

    const freshRejected = execute([priorToken, original[1]!.token, freshToken]);
    assert.equal(freshRejected.status, 1);
    assert.match(freshRejected.stderr, /Fresh recovery override failed/);
    assert.doesNotMatch(freshRejected.stdout, /Non-redeeming authentication and gift-list access/);
    assert.doesNotMatch(freshRejected.stderr, /older refresh override was rejected/);
  });

  it("retries identity checks in the actual manual recovery workflow and fails after exhaustion", () => {
    const workflow = parse(readFileSync(".github/workflows/check-recovery-auth.yml", "utf8"));
    const run: string = workflow.jobs.check.steps.at(-1).run;
    const script = run.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
    assert.ok(script);
    const refreshed = `${fresh}new`;
    const stub = `globalThis.identityAttempts = 0;
      globalThis.fetch = async (url, opts) => {
        const credential = opts.headers.Authorization.slice(7);
        if (url.endsWith("/auth/me")) {
          if (credential === process.env.IDENTITY_TOKEN) {
            globalThis.identityAttempts += 1;
            process.stdout.write("IDENTITY_ATTEMPTS=" + globalThis.identityAttempts + "\\n");
            if (process.env.IDENTITY_MODE === "exhausted" || globalThis.identityAttempts === 1) {
              return new Response("{}", {
                status: 503, headers: {"content-type": "application/json"}
              });
            }
          }
          return new Response('{"payload":{"accountId":"one"}}', {
            headers: {"content-type": "application/json"}
          });
        }
        return new Response("[]", { headers: {"content-type": "application/json"} });
      };`;
    for (const [mode, expectedStatus, expectedAttempts] of [
      ["transient", 0, 3], ["exhausted", 1, 2],
    ] as const) {
      const result: { status: number | null; stdout: string; stderr: string } = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `${stub}\n${script}\nconsole.log("IDENTITY_ATTEMPTS=" + globalThis.identityAttempts);`],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            STFC_ACCOUNTS: JSON.stringify([original[0]]),
            STFC_ACCOUNT_REFRESH: "",
            STFC_ACCOUNT_REFRESH_RECOVERY: JSON.stringify({ token: refreshed }),
            IDENTITY_TOKEN: refreshed,
            IDENTITY_MODE: mode,
            REPOSITORY_VARIABLES: "{}",
          },
        },
      );
      assert.equal(result.status, expectedStatus, result.stderr);
      assert.match(result.stdout, new RegExp(`IDENTITY_ATTEMPTS=${expectedAttempts}`));
      if (mode === "transient") assert.match(result.stdout, /1\/1 accounts accepted/);
      else assert.match(result.stderr, /Fresh recovery override failed/);
    }
  });

  it("keeps scheduled redemption on the preserved inventory when overrides fail validation", () => {
    const updatedOne = token("one") + "new";
    const updatedTwo = token("two") + "new";
    const stub = `globalThis.identityAttempts = new Map();
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith("/auth/me")) {
        const token = opts.headers.Authorization.slice(7);
        const accountId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).accountId;
        if (token === process.env.IDENTITY_FAULT_TOKEN) {
          const attempts = (globalThis.identityAttempts.get(token) ?? 0) + 1;
          globalThis.identityAttempts.set(token, attempts);
          if (process.env.IDENTITY_FAULT_MODE === "exhausted" || attempts === 1) {
            return new Response("{}", {
              status: 503, headers: {"content-type": "application/json"}
            });
          }
        }
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
      for (const mode of [
        "valid", "identity-transient", "identity-exhausted", "duplicate", "mismatched", "gift-denied",
      ] as const) {
        const recovery = ["valid", "identity-transient", "identity-exhausted", "gift-denied"].includes(mode)
          ? updatedTwo : mode === "duplicate" ? updatedOne : token("unmatched") + "new";
        const identityFault = mode === "identity-transient" || mode === "identity-exhausted";
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `${stub}\n${script}\nconsole.log("IDENTITY_ATTEMPTS=" + (globalThis.identityAttempts.get(process.env.IDENTITY_FAULT_TOKEN) ?? 0));`], {
          encoding: "utf8",
          env: {
            ...process.env, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: summary, REPOSITORY_VARIABLES: "{}",
            REJECT_GIFT_ACCOUNT: mode === "gift-denied" ? "two" : "",
            STFC_ACCOUNTS: JSON.stringify(original), STFC_ACCOUNT_REFRESH: JSON.stringify({ token: updatedOne }),
            STFC_ACCOUNT_REFRESH_RECOVERY: JSON.stringify({
              token: mode === "gift-denied" ? updatedTwo : recovery,
            }),
            IDENTITY_FAULT_TOKEN: identityFault ? updatedTwo : "",
            IDENTITY_FAULT_MODE: mode === "identity-exhausted" ? "exhausted" : "transient",
          },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(existsSync(output), true);
        if (mode === "valid" || mode === "identity-transient") {
          assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
            { name: "main", token: updatedOne }, { name: "alt", token: updatedTwo },
          ]);
          if (mode === "identity-transient") assert.match(result.stdout, /IDENTITY_ATTEMPTS=2/);
        } else {
          assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
            { name: "main", token: updatedOne }, original[1],
          ]);
          assert.match(result.stderr, /1 refresh override\(s\) were rejected/);
          assert.match(readFileSync(summary, "utf8"), /Verified overrides and the preserved `STFC_ACCOUNTS` inventory remain in use/);
          if (mode === "identity-exhausted") assert.match(result.stdout, /IDENTITY_ATTEMPTS=2/);
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
