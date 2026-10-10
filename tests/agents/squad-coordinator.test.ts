import { describe, it } from "node:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import assert from "node:assert/strict";

/**
 * Regression test for the Squad coordinator MCP config path references.
 *
 * The coordinator prompt (squad.agent.md) instructs agents on where to find
 * the state bridge. Copilot CLI discovers .github/mcp.json and .mcp.json,
 * while Copilot App has both project config and extension registration paths.
 * Keep every host-facing registration pinned so a Squad upgrade cannot silently
 * break the bridge.
 */

function readFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8").replace(
    /\r\n/g,
    "\n",
  );
}

describe("Squad coordinator — MCP bridge configuration", () => {
  const coordinator = readFile(".github/agents/squad.agent.md");
  const cliMcpConfig = readFile(".mcp.json");
  const mcpConfig = readFile(".github/mcp.json");
  const appExtension = readFile(
    ".github/extensions/squad-state/extension.mjs",
  );
  const appMcpConfig = readFile(".copilot/mcp-config.json");

  function squadStatePackageSpec(configText: string): string {
    const config = JSON.parse(configText) as {
      mcpServers?: Record<string, { args?: unknown }>;
    };
    const args = config.mcpServers?.squad_state?.args;
    assert.ok(Array.isArray(args), "squad_state server args must be an array");
    const packageSpec = args.find(
      (arg: unknown): arg is string =>
        typeof arg === "string" &&
        arg.startsWith("@bradygaster/squad-cli@"),
    );
    assert.ok(
      packageSpec,
      "squad_state server args must pin @bradygaster/squad-cli",
    );
    return packageSpec;
  }

  it("coordinator references .github/mcp.json (not stale .mcp.json)", () => {
    // Both references in the state-backend handshake section must point to the
    // correct committed path.
    const staleRefs = [...coordinator.matchAll(/(?<![/\w]).mcp\.json/g)];
    assert.equal(
      staleRefs.length,
      0,
      `squad.agent.md contains ${staleRefs.length} bare ".mcp.json" reference(s) — should reference ".github/mcp.json" instead. Stale refs after squad upgrade? Fix both occurrences in the state-backend handshake section.`,
    );
  });

  it("coordinator mentions .github/mcp.json in the state-backend handshake", () => {
    assert.ok(
      coordinator.includes(".github/mcp.json"),
      "squad.agent.md should reference .github/mcp.json in the state-backend handshake section",
    );
  });

  it(".github/mcp.json declares squad_state server", () => {
    const config = JSON.parse(mcpConfig) as Record<string, unknown>;
    const servers = (
      config["mcpServers"] as Record<string, unknown> | undefined
    ) ?? {};
    assert.ok(
      "squad_state" in servers,
      ".github/mcp.json must declare a squad_state server entry",
    );
  });

  it(".github/mcp.json squad_state server uses a recognized transport type", () => {
    const config = JSON.parse(mcpConfig) as Record<string, unknown>;
    const servers = config["mcpServers"] as Record<
      string,
      Record<string, unknown>
    >;
    const server = servers["squad_state"]!;
    const type = server["type"] as string | undefined;
    // Copilot CLI accepts "stdio" (MCP spec standard) and "local" (legacy alias).
    // Both are equivalent. Reject unrecognised values that would silently fail.
    const valid = ["stdio", "local"];
    assert.ok(
      type === undefined || valid.includes(type),
      `squad_state server type "${type}" is not recognised — use "stdio" or "local"`,
    );
  });

  it(".github/mcp.json squad_state server command launches state-mcp", () => {
    const config = JSON.parse(mcpConfig) as Record<string, unknown>;
    const servers = config["mcpServers"] as Record<
      string,
      Record<string, unknown>
    >;
    const server = servers["squad_state"]!;
    const args = server["args"] as string[] | undefined;
    assert.ok(
      Array.isArray(args) && args.includes("state-mcp"),
      "squad_state server args must include 'state-mcp'",
    );
  });

  it("keeps all state bridge registrations on the same Squad CLI version", () => {
    const cliPackage = squadStatePackageSpec(cliMcpConfig);
    assert.equal(squadStatePackageSpec(mcpConfig), cliPackage);
    assert.equal(squadStatePackageSpec(appMcpConfig), cliPackage);
  });

  it("Copilot App extension registers the shared squad_state MCP definition", () => {
    assert.match(
      appExtension,
      /new URL\("\.\.\/\.\.\/mcp\.json", import\.meta\.url\)/,
      "squad-state extension must load the canonical .github/mcp.json",
    );
    assert.match(
      appExtension,
      /joinSession\(\{\s*mcpServers:\s*\{\s*squad_state:\s*squadState/s,
      "squad-state extension must attach the squad_state MCP server to the App session",
    );
  });

  it(".copilot/mcp-config.json declares the state bridge for Copilot App", () => {
    const config = JSON.parse(appMcpConfig) as Record<string, unknown>;
    const servers = (
      config["mcpServers"] as Record<string, Record<string, unknown>> | undefined
    ) ?? {};
    const server = servers["squad_state"];
    assert.ok(
      server,
      ".copilot/mcp-config.json must declare squad_state for Copilot App sessions",
    );
    assert.equal(server["type"], "stdio");
    assert.deepEqual(server["args"], [
      "-y",
      squadStatePackageSpec(cliMcpConfig),
      "state-mcp",
    ]);
    assert.deepEqual(server["tools"], ["*"]);
  });
});


describe("Squad upgrade template regression coverage", () => {
  const coordinator = readFile(".github/agents/squad.agent.md");
  const sourceOfTruth = readFile(
    ".github/skills/coordinator-source-of-truth/SKILL.md",
  );
  const templateReadme = readFile(".squad/templates/README.md");
  const coordinatorTemplate = readFile(
    ".squad/templates/squad.agent.md.template",
  );

  it("keeps installed skills synchronized with their upgrade sources", () => {
    for (const skill of [
      "reflect",
      "reviewer-protocol",
      "test-discipline",
      "tiered-memory",
    ]) {
      assert.equal(
        readFile(`.github/skills/${skill}/SKILL.md`),
        readFile(`.squad/templates/skills/${skill}/SKILL.md`),
        `${skill} must remain synchronized with its upgrade template`,
      );
    }
  });

  it("uses tracked Rai paths and documented bootstrap sources", () => {
    for (const document of [coordinator, coordinatorTemplate]) {
      assert.ok(document.includes(".squad/agents/Rai/charter.md"));
      assert.ok(!document.includes(".squad/agents/rai/charter.md"));
      assert.ok(!document.includes(".squad/governance.md"));
      assert.ok(!document.includes(".github/PR_REQUIREMENTS.md"));
    }
    assert.match(templateReadme, /\| `ralph-charter\.md` \| `agents\/ralph\/charter\.md` \|/);
    assert.match(templateReadme, /\| `human-members\.md` \| Coordinator \| Adding a human to the team roster \|/);
  });

  it("keeps support-agent activation and state ownership bounded", () => {
    for (const document of [coordinator, coordinatorTemplate]) {
      assert.ok(!document.includes("Pre-Ship ceremony (auto)"));
      assert.ok(!document.includes("Post-research (auto"));
    }
    assert.ok(sourceOfTruth.includes("only mutable Squad state"));
    assert.ok(sourceOfTruth.includes("Do not create or preserve specialist histories"));
  });

  it("preserves the pre-upgrade coordinator as the local backup", () => {
    const backup = readFile(".github/agents/squad.agent.md.local-backup");
    assert.match(backup, /<!-- version: 0\.13\.1 -->/);
    assert.notEqual(backup, coordinator);
  });
});
