// Pinning tests for the SWA project structure scaffolding (Wave 2, issue #115).
//
// Asserts that the directories and files expected by the deploy workflow
// (swa-deploy.yml app_location/api_location/output_location) and by Wave 3
// agents (Scotty #119/#120, Uhura #117) are present and have the right shape.
//
// Note: swa-deploy.yml gates deploy/teardown on a `preflight` job's has-oidc
// output (probed from secrets.AZURE_CLIENT_ID) so it skips rather than fails
// when OIDC secrets are not yet provisioned. (`secrets` can't be used in a
// job-level `if:` — that would be a startup failure, not a skip.)
// Contract pinning for that guard lives in tests/skills/swaDeploy.test.ts.
//
// If any assertion here fails, the scaffolding has drifted from the contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function isExecutable(rel: string): boolean {
  try {
    fs.accessSync(path.join(ROOT, rel), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe("SWA project structure (T-SWA-002)", () => {
  it("deploy workflow loads the root SWA security configuration", () => {
    assert.match(
      read(".github/workflows/swa-deploy.yml"),
      /config_file_location:\s*\./,
    );
  });

  // ── web/ scaffold ──────────────────────────────────────────────────────────
  describe("web/ scaffold", () => {
    it("web/ directory exists", () => {
      assert.ok(exists("web"), "web/ directory missing");
    });

    it("web/package.json exists", () => {
      assert.ok(exists("web/package.json"), "web/package.json missing");
    });

    it("web/package.json has a 'build' script (vite build)", () => {
      const pkg = JSON.parse(read("web/package.json")) as Record<string, unknown>;
      const scripts = pkg["scripts"] as Record<string, string> | undefined;
      const buildScript = scripts?.["build"];
      assert.ok(buildScript, "web/package.json missing 'build' script");
      assert.match(buildScript, /vite\s+build/, "web build script should invoke vite build");
    });

    it("web/vite.config.ts exists", () => {
      assert.ok(exists("web/vite.config.ts"), "web/vite.config.ts missing");
    });

    it("web/index.html exists", () => {
      assert.ok(exists("web/index.html"), "web/index.html missing");
    });

    it("web/src/main.ts exists", () => {
      assert.ok(exists("web/src/main.ts"), "web/src/main.ts missing");
    });
  });

  // ── api/ scaffold ──────────────────────────────────────────────────────────
  describe("api/ scaffold", () => {
    it("api/ directory exists", () => {
      assert.ok(exists("api"), "api/ directory missing");
    });

    it("api/package.json exists", () => {
      assert.ok(exists("api/package.json"), "api/package.json missing");
    });

    it("api/host.json exists and has version 2.0", () => {
      assert.ok(exists("api/host.json"), "api/host.json missing");
      const host = JSON.parse(read("api/host.json")) as Record<string, unknown>;
      assert.equal(host["version"], "2.0", "api/host.json version must be '2.0'");
    });

    it("api/local.settings.json.example exists", () => {
      assert.ok(
        exists("api/local.settings.json.example"),
        "api/local.settings.json.example missing — dev onboarding will fail",
      );
    });

    it("api/local.settings.json.example has DISABLE_WRITES=1 as default", () => {
      const ex = JSON.parse(read("api/local.settings.json.example")) as {
        Values?: Record<string, string>;
      };
      assert.equal(
        ex.Values?.["DISABLE_WRITES"],
        "1",
        "DISABLE_WRITES must default to '1' in local.settings.json.example (kill switch)",
      );
    });

    it("api/.funcignore exists and excludes local.settings.json", () => {
      assert.ok(exists("api/.funcignore"), "api/.funcignore missing");
      const ignoreContent = read("api/.funcignore");
      assert.match(
        ignoreContent,
        /local\.settings\.json/,
        "api/.funcignore must exclude local.settings.json (secrets must not deploy)",
      );
    });
  });

  // ── shared/contracts/ ─────────────────────────────────────────────────────
  describe("shared/contracts/ scaffold", () => {
    it("shared/contracts/ directory exists", () => {
      assert.ok(exists("shared/contracts"), "shared/contracts/ missing");
    });

    it("shared/contracts/.gitkeep exists (ensures empty dir is tracked)", () => {
      assert.ok(
        exists("shared/contracts/.gitkeep"),
        "shared/contracts/.gitkeep missing — git won't track the empty dir",
      );
    });

    it("shared/contracts/README.md exists", () => {
      assert.ok(exists("shared/contracts/README.md"), "shared/contracts/README.md missing");
    });
  });

  // ── staticwebapp.config.json deny-by-default ──────────────────────────────
  describe("staticwebapp.config.json", () => {
    it("staticwebapp.config.json exists", () => {
      assert.ok(exists("staticwebapp.config.json"), "staticwebapp.config.json missing");
    });

    it("has a deny-by-default catch-all route requiring stfc_operator", () => {
      const config = JSON.parse(read("staticwebapp.config.json")) as {
        routes?: Array<{ route: string; allowedRoles?: string[] }>;
      };
      assert.ok(Array.isArray(config.routes), "staticwebapp.config.json must have routes array");
      const routes = config.routes;
      const catchAll = routes.find((r) => r.route === "/*");
      assert.ok(catchAll, "staticwebapp.config.json must have a '/*' catch-all route");
      assert.ok(
        catchAll.allowedRoles?.includes("stfc_operator"),
        "'/*' route must include 'stfc_operator' in allowedRoles (deny-by-default)",
      );
    });

    it("redirects 401 to GitHub login (unauthenticated users are sent to login)", () => {
      const config = JSON.parse(read("staticwebapp.config.json")) as {
        responseOverrides?: Record<string, { redirect?: string }>;
      };
      assert.ok(config.responseOverrides, "staticwebapp.config.json missing responseOverrides");
      assert.match(
        config.responseOverrides?.["401"]?.redirect ?? "",
        /\.auth\/login/,
        "401 response override must redirect to /.auth/login/...",
      );
    });

    it("api/* route requires stfc_operator", () => {
      const config = JSON.parse(read("staticwebapp.config.json")) as {
        routes?: Array<{ route: string; allowedRoles?: string[] }>;
      };
      const apiRoute = config.routes?.find((r) => r.route === "/api/*");
      assert.ok(apiRoute, "staticwebapp.config.json must have an '/api/*' route");
      assert.ok(
        apiRoute.allowedRoles?.includes("stfc_operator"),
        "'/api/*' route must include 'stfc_operator' in allowedRoles",
      );
    });

    it("pins the SWA API runtime and package engine to supported Node 22", () => {
      const config = JSON.parse(read("staticwebapp.config.json")) as {
        platform?: { apiRuntime?: string };
      };
      const apiPackage = JSON.parse(read("api/package.json")) as {
        engines?: { node?: string };
      };
      const apiLock = JSON.parse(read("api/package-lock.json")) as {
        packages?: Record<string, { engines?: { node?: string } }>;
      };

      assert.equal(config.platform?.apiRuntime, "node:22");
      assert.equal(apiPackage.engines?.node, ">=22");
      assert.equal(apiLock.packages?.[""]?.engines?.node, apiPackage.engines?.node);
    });
  });

  // ── root package.json build scripts ───────────────────────────────────────
  describe("root package.json build scripts", () => {
    it("has build:swa script", () => {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      assert.ok(pkg.scripts?.["build:swa"], "root package.json missing 'build:swa' script");
    });

    it("build:swa invokes both build:web and build:api", () => {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      const buildSwa = pkg.scripts?.["build:swa"] ?? "";
      assert.match(buildSwa, /build:web/, "build:swa must call build:web");
      assert.match(buildSwa, /build:api/, "build:swa must call build:api");
    });

    it("has build:web script", () => {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      assert.ok(pkg.scripts?.["build:web"], "root package.json missing 'build:web' script");
    });

    it("has build:api script", () => {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      assert.ok(pkg.scripts?.["build:api"], "root package.json missing 'build:api' script");
    });

    it("has dev:swa script", () => {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      assert.ok(pkg.scripts?.["dev:swa"], "root package.json missing 'dev:swa' script");
    });
  });

  // ── tsconfig.json path alias ───────────────────────────────────────────────
  describe("tsconfig.json @stfc/contracts path alias", () => {
    it("tsconfig.json has @stfc/contracts/* path mapping", () => {
      const tsconfig = JSON.parse(read("tsconfig.json")) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      const paths = tsconfig.compilerOptions?.paths;
      assert.ok(paths, "tsconfig.json missing compilerOptions.paths");
      assert.ok(
        paths?.["@stfc/contracts/*"],
        "tsconfig.json missing @stfc/contracts/* path mapping",
      );
    });

    it("@stfc/contracts/* maps to shared/contracts/", () => {
      const tsconfig = JSON.parse(read("tsconfig.json")) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      const mapping = tsconfig.compilerOptions?.paths?.["@stfc/contracts/*"] ?? [];
      assert.ok(
        mapping.some((p) => p.includes("shared/contracts")),
        `@stfc/contracts/* must map to shared/contracts/ — got: ${JSON.stringify(mapping)}`,
      );
    });
  });

  // ── scripts/azure/create-swa.sh ───────────────────────────────────────────
  describe("scripts/azure/create-swa.sh", () => {
    it("create-swa.sh exists", () => {
      assert.ok(
        exists("scripts/azure/create-swa.sh"),
        "scripts/azure/create-swa.sh missing",
      );
    });

    it("create-swa.sh is executable", () => {
      assert.ok(
        isExecutable("scripts/azure/create-swa.sh"),
        "scripts/azure/create-swa.sh must be executable (chmod +x)",
      );
    });

    it("create-swa.sh checks for az CLI (prereq guard)", () => {
      const sh = read("scripts/azure/create-swa.sh");
      assert.match(
        sh,
        /command\s+-v\s+az/,
        "create-swa.sh must check that az CLI is installed",
      );
    });

    it("create-swa.sh checks az account show (login guard)", () => {
      const sh = read("scripts/azure/create-swa.sh");
      assert.match(
        sh,
        /az\s+account\s+show/,
        "create-swa.sh must verify user is logged in via az account show",
      );
    });

    it("create-swa.sh references staticwebapp create (idempotent creation)", () => {
      const sh = read("scripts/azure/create-swa.sh");
      assert.match(
        sh,
        /az\s+staticwebapp\s+create/,
        "create-swa.sh must include az staticwebapp create command",
      );
    });

    it("create-swa.sh applies DISABLE_WRITES=1 app setting", () => {
      const sh = read("scripts/azure/create-swa.sh");
      assert.match(
        sh,
        /DISABLE_WRITES=1/,
        "create-swa.sh must apply DISABLE_WRITES=1 app setting (kill switch)",
      );
    });
  });
});
