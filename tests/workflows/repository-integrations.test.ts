import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("repository integrations", () => {
  it("does not install the removed agent-team state or MCP servers", () => {
    for (const path of [
      ".squad",
      join(".github", "agents", "squad.agent.md"),
      join(".github", "extensions", "squad-state"),
    ]) {
      assert.equal(existsSync(path), false, `${path} must not exist`);
    }

    const configPath = join(".copilot", "mcp-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    assert.ok(config.mcpServers.playwright, "Playwright must remain configured");
    for (const path of [configPath, ".mcp.json", join(".github", "mcp.json")]) {
      if (!existsSync(path)) continue;
      const contents = readFileSync(path, "utf8");
      assert.doesNotMatch(contents, /squad[_-]state|@bradygaster\/squad/i, path);
    }
  });

  it("does not install agent-team automation workflows", () => {
    const files = readdirSync(join(".github", "workflows"));
    assert.deepEqual(
      files.filter((file) => file.startsWith("squad-") || file === "sync-squad-labels.yml"),
      [],
    );
  });
});
