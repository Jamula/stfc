// Contract tests for staticwebapp.config.json (Wave 3, issue #116).
//
// Asserts the complete role-gating configuration: deny-by-default stfc_operator
// for all routes, anonymous access to /.auth/*, 401/403 response overrides,
// security headers, GitHub-only auth provider, and .json MIME type.
//
// If any assertion here fails, the SWA authz posture has drifted from the
// threat-model requirements (see specs/005-web-control-panel/threat-model.md).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

type SwaRoute = { route: string; allowedRoles?: string[]; redirect?: string };
type SwaConfig = {
  routes?: SwaRoute[];
  responseOverrides?: Record<string, { redirect?: string; rewrite?: string; statusCode?: number }>;
  auth?: {
    identityProviders?: Record<string, unknown>;
  };
  globalHeaders?: Record<string, string>;
  mimeTypes?: Record<string, string>;
};

describe("staticwebapp.config.json role config (T-SWA-003)", () => {
  let config: SwaConfig;

  // Parse once; failures here surface as individual test errors via closures.
  try {
    config = JSON.parse(read("staticwebapp.config.json")) as SwaConfig;
  } catch {
    config = {};
  }

  // ── routes ────────────────────────────────────────────────────────────────

  describe("routes", () => {
    it("routes array exists", () => {
      assert.ok(Array.isArray(config.routes), "staticwebapp.config.json must have a routes array");
    });

    it("/.auth/* route is accessible to anonymous (SWA login endpoints must be reachable)", () => {
      const authRoute = config.routes?.find((r) => r.route === "/.auth/*");
      assert.ok(authRoute, "staticwebapp.config.json must have a '/.auth/*' route");
      assert.ok(
        authRoute.allowedRoles?.includes("anonymous"),
        "'/.auth/*' must include 'anonymous' in allowedRoles so unauthenticated users can reach the login flow",
      );
    });

    it("/api/* route requires stfc_operator", () => {
      const apiRoute = config.routes?.find((r) => r.route === "/api/*");
      assert.ok(apiRoute, "staticwebapp.config.json must have an '/api/*' route");
      assert.ok(
        apiRoute.allowedRoles?.includes("stfc_operator"),
        "'/api/*' must include 'stfc_operator' in allowedRoles",
      );
    });

    it("catch-all /* route requires stfc_operator (deny-by-default)", () => {
      const catchAll = config.routes?.find((r) => r.route === "/*");
      assert.ok(catchAll, "staticwebapp.config.json must have a '/*' catch-all route");
      assert.ok(
        catchAll.allowedRoles?.includes("stfc_operator"),
        "'/*' must include 'stfc_operator' in allowedRoles (deny-by-default posture)",
      );
    });

    it("/.auth/* route appears before /* (order matters — first match wins)", () => {
      const routes = config.routes ?? [];
      const authIdx = routes.findIndex((r) => r.route === "/.auth/*");
      const catchAllIdx = routes.findIndex((r) => r.route === "/*");
      assert.ok(
        authIdx !== -1 && catchAllIdx !== -1,
        "Both /.auth/* and /* routes must be present",
      );
      assert.ok(
        authIdx < catchAllIdx,
        "/.auth/* must appear before /* in routes array — first match wins in SWA",
      );
    });
  });

  // ── responseOverrides ─────────────────────────────────────────────────────

  describe("responseOverrides", () => {
    it("responseOverrides section exists", () => {
      assert.ok(
        config.responseOverrides,
        "staticwebapp.config.json must have a responseOverrides section",
      );
    });

    it("401 response redirects to GitHub login endpoint", () => {
      const override401 = config.responseOverrides?.["401"];
      assert.ok(override401, "responseOverrides must contain a '401' entry");
      assert.match(
        override401.redirect ?? "",
        /\.auth\/login\/github/,
        "401 override must redirect to /.auth/login/github (GitHub OAuth entry point)",
      );
    });

    it("401 redirect preserves post_login_redirect_uri parameter", () => {
      const redirect = config.responseOverrides?.["401"]?.redirect ?? "";
      assert.match(
        redirect,
        /post_login_redirect_uri/,
        "401 redirect should include post_login_redirect_uri so the user lands on their original page after login",
      );
    });

    it("403 response is present", () => {
      const override403 = config.responseOverrides?.["403"];
      assert.ok(override403, "responseOverrides must contain a '403' entry");
    });

    it("403 response serves the static 403 page (not a blank response)", () => {
      const override403 = config.responseOverrides?.["403"];
      // Either a rewrite to /403.html or a redirect — must not be empty
      const hasBody = override403?.rewrite || override403?.redirect;
      assert.ok(
        hasBody,
        "403 override must rewrite/redirect to a static error page rather than returning a blank response",
      );
    });
  });

  // ── auth identityProviders ────────────────────────────────────────────────

  describe("auth.identityProviders", () => {
    it("auth section exists", () => {
      assert.ok(config.auth, "staticwebapp.config.json must have an 'auth' section");
    });

    it("identityProviders section exists", () => {
      assert.ok(
        config.auth?.identityProviders,
        "auth must contain an 'identityProviders' section",
      );
    });

    it("github provider is configured", () => {
      assert.ok(
        config.auth?.identityProviders?.["github"],
        "identityProviders must include 'github' (the only OAuth provider for this app)",
      );
    });

    it("only github provider is present (no AAD, no anonymous provider entries)", () => {
      const providers = Object.keys(config.auth?.identityProviders ?? {});
      assert.deepEqual(
        providers,
        ["github"],
        `identityProviders must contain only 'github' — found: ${JSON.stringify(providers)}`,
      );
    });
  });

  // ── globalHeaders — security posture ─────────────────────────────────────

  describe("globalHeaders security headers", () => {
    it("globalHeaders section exists", () => {
      assert.ok(
        config.globalHeaders,
        "staticwebapp.config.json must have a globalHeaders section",
      );
    });

    it("Strict-Transport-Security header is set", () => {
      const hsts = config.globalHeaders?.["Strict-Transport-Security"];
      assert.ok(hsts, "globalHeaders must include Strict-Transport-Security");
      assert.match(hsts, /max-age=/, "HSTS must include max-age directive");
    });

    it("Content-Security-Policy header is set", () => {
      const csp = config.globalHeaders?.["Content-Security-Policy"];
      assert.ok(csp, "globalHeaders must include Content-Security-Policy");
      assert.match(csp, /default-src\s+'self'/, "CSP must include default-src 'self'");
      assert.match(csp, /script-src\s+'self'/, "CSP must include script-src 'self'");
    });

    it("X-Content-Type-Options: nosniff is set", () => {
      assert.equal(
        config.globalHeaders?.["X-Content-Type-Options"],
        "nosniff",
        "X-Content-Type-Options must be 'nosniff'",
      );
    });

    it("X-Frame-Options: DENY is set", () => {
      assert.equal(
        config.globalHeaders?.["X-Frame-Options"],
        "DENY",
        "X-Frame-Options must be 'DENY'",
      );
    });

    it("Referrer-Policy is set", () => {
      const rp = config.globalHeaders?.["Referrer-Policy"];
      assert.ok(rp, "globalHeaders must include Referrer-Policy");
      assert.match(rp, /strict-origin/, "Referrer-Policy should be strict-origin-when-cross-origin or similar");
    });
  });

  // ── mimeTypes ─────────────────────────────────────────────────────────────

  describe("mimeTypes", () => {
    it("mimeTypes section exists", () => {
      assert.ok(config.mimeTypes, "staticwebapp.config.json must have a mimeTypes section");
    });

    it(".json extension maps to application/json", () => {
      assert.equal(
        config.mimeTypes?.[".json"],
        "application/json",
        ".json must map to application/json (required for future RAG index endpoint)",
      );
    });
  });

  // ── static error pages ────────────────────────────────────────────────────

  describe("static error pages", () => {
    it("web/public/403.html exists", () => {
      assert.ok(
        exists("web/public/403.html"),
        "web/public/403.html must exist (referenced by 403 responseOverride)",
      );
    });

    it("web/public/403.html contains no inline script (CSP-safe)", () => {
      const html = read("web/public/403.html");
      assert.ok(
        !/<script/i.test(html),
        "web/public/403.html must not contain <script> tags — CSP policy is script-src 'self'",
      );
    });

    it("web/public/403.html mentions stfc_operator role or contact message", () => {
      const html = read("web/public/403.html");
      const hasOperatorRef =
        /stfc_operator/i.test(html) || /not authorized/i.test(html) || /contact/i.test(html);
      assert.ok(
        hasOperatorRef,
        "web/public/403.html must explain the access restriction (mention stfc_operator, 'not authorized', or 'contact')",
      );
    });
  });
});
