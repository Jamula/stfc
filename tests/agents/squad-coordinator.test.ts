import { describe, it } from "node:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import assert from "node:assert/strict";

/**
 * Regression test for the Squad coordinator MCP config path references.
 *
 * The coordinator prompt (squad.agent.md) instructs agents on where to find
 * the state bridge. The config moved from .mcp.json to .github/mcp.json in
 * commit #200. squad upgrade regenerates squad.agent.md from an upstream
 * template that still carries the old path — so this test pins the correct
 * location and catches the regression before it silently breaks the bridge.
 */

function readFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8").replace(
    /\r\n/g,
    "\n",
  );
}

describe("Squad coordinator — MCP bridge configuration", () => {
  const coordinator = readFile(".github/agents/squad.agent.md");
  const mcpConfig = readFile(".github/mcp.json");

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
});
