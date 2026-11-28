import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { HttpRequest, InvocationContext } from "../../api/node_modules/@azure/functions/types/index.js";
import { handler } from "../../api/src/discord-command/index.ts";

const OWNER = "test-owner";
const TEST_TOKEN = "test-only-github-token";

type FetchCall = { input: string | URL | Request; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
const loggedErrors: unknown[][] = [];
let originalFetch: typeof fetch;
let originalAllowedUsers: string | undefined;
let originalOwner: string | undefined;
let originalDispatchToken: string | undefined;

function request(options: {
  principal?: string;
  action?: string;
  origin?: string;
} = {}): HttpRequest {
  const headers = new Headers();
  if (options.principal !== undefined) {
    headers.set("x-ms-client-principal", Buffer.from(JSON.stringify({
      identityProvider: "github",
      userId: "00000000000000000000000000000000",
      userDetails: options.principal,
      userRoles: ["authenticated"],
    })).toString("base64"));
  }
  if (options.action !== undefined) headers.set("x-stfc-pwa-action", options.action);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return {
    method: "POST",
    url: "https://pwa.example/api/discord-command/trigger-redeem",
    headers,
  } as unknown as HttpRequest;
}

function context(): InvocationContext {
  return {
    error: (...args: unknown[]) => loggedErrors.push(args),
  } as unknown as InvocationContext;
}

describe("Discord PWA trigger-redeem handler", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAllowedUsers = process.env["STFC_ALLOWED_USERS"];
    originalOwner = process.env["STFC_OWNER"];
    originalDispatchToken = process.env["PWA_GITHUB_DISPATCH_TOKEN"];
    process.env["STFC_ALLOWED_USERS"] = `${OWNER},test-operator`;
    process.env["STFC_OWNER"] = OWNER;
    delete process.env["PWA_GITHUB_DISPATCH_TOKEN"];
    fetchCalls.length = 0;
    loggedErrors.length = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      throw new Error("Unexpected GitHub request in this test");
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAllowedUsers === undefined) delete process.env["STFC_ALLOWED_USERS"];
    else process.env["STFC_ALLOWED_USERS"] = originalAllowedUsers;
    if (originalOwner === undefined) delete process.env["STFC_OWNER"];
    else process.env["STFC_OWNER"] = originalOwner;
    if (originalDispatchToken === undefined) delete process.env["PWA_GITHUB_DISPATCH_TOKEN"];
    else process.env["PWA_GITHUB_DISPATCH_TOKEN"] = originalDispatchToken;
  });

  it("denies an allowlisted non-owner without dispatching", async () => {
    const response = await handler(request({ principal: "test-operator" }), context());

    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(String(response.body)), {
      error: 'User "test-operator" is not the owner',
    });
    assert.equal(fetchCalls.length, 0);
  });

  it("requires the exact PWA action header instead of Origin equality", async () => {
    process.env["PWA_GITHUB_DISPATCH_TOKEN"] = TEST_TOKEN;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const missingHeader = await handler(request({
      principal: OWNER,
      origin: "https://pwa.example",
    }), context());
    assert.equal(missingHeader.status, 403);
    assert.equal(fetchCalls.length, 0, "matching Origin alone must not authorize dispatch");

    const wrongHeader = await handler(request({
      principal: OWNER,
      action: "another-action",
      origin: "https://pwa.example",
    }), context());
    assert.equal(wrongHeader.status, 403);
    assert.equal(fetchCalls.length, 0, "an unrelated action value must not authorize dispatch");
  });

  it("dispatches the fixed redeem workflow and returns its success payload", async () => {
    const workflow = parse(readFileSync(".github/workflows/redeem.yml", "utf8"));
    assert.ok(workflow.on.workflow_dispatch, "the fixed dispatch target must remain manually triggerable");
    assert.ok(workflow.on.schedule, "the dispatch target must retain scheduled redemption");
    assert.equal(workflow.jobs.redeem.steps[1]?.with?.["node-version-file"], ".nvmrc");
    const tokenSource = workflow.jobs.redeem.steps.find(
      (step: { id?: string }) => step.id === "token_source",
    );
    assert.ok(tokenSource, "manual dispatch must validate the account-token source");
    assert.equal(tokenSource.if, undefined, "token-source validation must not skip manual runs");
    assert.match(tokenSource.run, /validateAzureTokenConfig/);
    process.env["PWA_GITHUB_DISPATCH_TOKEN"] = TEST_TOKEN;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const response = await handler(request({
      principal: OWNER,
      action: "trigger-redeem",
    }), context());

    assert.equal(response.status, 202);
    assert.deepEqual(response.jsonBody, {
      accepted: true,
      workflow: "redeem",
      ref: "main",
    });
    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0]!;
    assert.equal(
      call.input,
      "https://api.github.com/repos/Jamula/stfc/actions/workflows/redeem.yml/dispatches",
    );
    assert.equal(call.init?.method, "POST");
    const headers = new Headers(call.init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${TEST_TOKEN}`);
    assert.equal(headers.get("accept"), "application/vnd.github+json");
    assert.equal(headers.get("x-github-api-version"), "2022-11-28");
    assert.deepEqual(JSON.parse(String(call.init?.body)), { ref: "main" });
  });

  it("returns 503 without dispatch when the GitHub credential is missing", async () => {
    const response = await handler(request({
      principal: OWNER,
      action: "trigger-redeem",
    }), context());

    assert.equal(response.status, 503);
    assert.deepEqual(response.jsonBody, {
      error: "Discord command service is not configured.",
    });
    assert.equal(fetchCalls.length, 0);
  });

  it("converts an upstream GitHub failure to a sanitized 502", async () => {
    process.env["PWA_GITHUB_DISPATCH_TOKEN"] = TEST_TOKEN;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return new Response("private upstream error", { status: 422 });
    }) as typeof fetch;

    const response = await handler(request({
      principal: OWNER,
      action: "trigger-redeem",
    }), context());

    assert.equal(response.status, 502);
    assert.deepEqual(response.jsonBody, {
      error: "The redeem workflow could not be started.",
    });
    assert.deepEqual(loggedErrors, [["PWA redeem workflow dispatch failed", 422]]);
    assert.equal(fetchCalls.length, 1);
  });
});
