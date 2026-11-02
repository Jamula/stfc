import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(...segments: string[]): string {
  return readFileSync(path.join(...segments), "utf8").replace(/\r\n/g, "\n");
}

function section(content: string, heading: string): string {
  const marker = `## ${heading}\n`;
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, `Missing section: ${heading}`);
  const body = content.slice(start + marker.length);
  const next = /^## /m.exec(body);
  return next ? body.slice(0, next.index) : body;
}

function tableNames(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) => line.split("|")[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

function between(content: string, start: string, end: string): string {
  const first = content.indexOf(start);
  assert.notEqual(first, -1, `Missing start marker: ${start}`);
  const last = content.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Missing end marker: ${end}`);
  return content.slice(first + start.length, last);
}

describe("native Squad configuration", () => {
  it("uses the requested two-layer backend and state bridge", () => {
    const config = JSON.parse(read(".squad", "config.json")) as {
      stateBackend: string;
    };
    const mcp = JSON.parse(read(".mcp.json")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    assert.equal(config.stateBackend, "two-layer");
    assert.ok(mcp.mcpServers.squad_state, "Missing squad_state MCP server");
    assert.equal(mcp.mcpServers.squad_state.command, "npx");
    assert.match(mcp.mcpServers.squad_state.args.join(" "), /@bradygaster\/squad-cli@.+ state-mcp$/);
  });

  it("keeps mutable runtime state out of the source tree", () => {
    const ignored = [
      ".squad/decisions.md",
      ".squad/agents/spock/history.md",
      ".squad/identity/now.md",
      ".squad/rai/audit-trail.md",
      ".squad/fact-checker/audit-trail.md",
      ".squad/memory/index.json",
      ".squad/memory/audit.jsonl",
      ".squad/.first-run",
    ];
    for (const file of ignored) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", file]);
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${file} should be ignored: ${result.stderr.toString()}`);
    }
    const config = spawnSync("git", [
      "check-ignore", "--no-index", "-q", "--", ".squad/memory/config.json",
    ]);
    assert.ifError(config.error);
    assert.equal(config.status, 1, "The static memory configuration must remain trackable");
  });

  it("has Seven, the three specialists, and optional Copilot without auto-assignment", () => {
    const team = read(".squad", "team.md");
    assert.match(section(team, "Coordinator"), /\|\s*Seven\s*\|\s*Coordinator\s*\|/);
    assert.deepEqual(tableNames(section(team, "Members")), ["Spock", "Data", "Uhura"]);
    assert.match(section(team, "Coding Agent"), /<!-- copilot-auto-assign: false -->/);
    assert.match(section(team, "Coding Agent"), /\|\s*@copilot\s*\|\s*Coding Agent\s*\|/);
    assert.equal(existsSync(path.join(".github", "agents", "seven.agent.md")), false);
  });

  it("routes implementation, independent review, and documentation to their owners", () => {
    const routing = section(read(".squad", "routing.md"), "Work Type → Agent");
    assert.match(routing, /\|\s*Implementation, tests, and remediation\s*\|\s*Spock\s*\|/);
    assert.match(routing, /\|\s*Independent review\s*\|\s*Data\s*\|/);
    assert.match(routing, /\|\s*Documentation and operational guidance\s*\|\s*Uhura\s*\|/);

    const spock = read(".squad", "agents", "spock", "charter.md");
    const data = read(".squad", "agents", "data", "charter.md");
    const uhura = read(".squad", "agents", "uhura", "charter.md");
    assert.match(spock, /Implement code, tests, and fixes/);
    assert.match(spock, /CI\/CD workflows/);
    assert.match(data, /Independent review of the current substantive revision/);
    assert.match(data, /security, privacy, responsible AI and content safety/);
    assert.match(uhura, /Write and maintain user-facing documentation and operational guidance/);
    for (const charter of [spock, data, uhura]) {
      assert.match(charter, /squad_state/);
      assert.match(charter, /squad_decide/);
      assert.doesNotMatch(charter, /the Scribe will merge it/i);
    }
  });

  it("generates accurate capabilities instead of granting Data edit authority", () => {
    const coordinator = read(".github", "agents", "squad.agent.md");
    const capabilities = between(
      coordinator,
      "<!-- SQUAD:TEAM-CAPABILITIES:BEGIN -->",
      "<!-- SQUAD:TEAM-CAPABILITIES:END -->",
    );
    assert.match(capabilities, /\|\s*Spock\s*\|[^|\n]*\|\s*edit\s*\|/);
    assert.match(capabilities, /\|\s*Data\s*\|[^|\n]*\|\s*review\s*\|/);
    assert.match(capabilities, /\|\s*Uhura\s*\|[^|\n]*\|\s*edit, advisory\s*\|/);
    assert.match(capabilities, /author and maintain CI\/CD workflows/);
    assert.match(capabilities, /responsible-AI and content-safety review/);
  });

  it("preserves the operating contract across the coordinator and its local template", () => {
    const coordinator = read(".github", "agents", "squad.agent.md");
    const template = read(".squad", "templates", "squad.agent.md.template");
    const start = "## Project Operating Contract\n";
    const end = "### Coordinator Identity";
    const contract = between(coordinator, start, end);

    assert.equal(contract, between(template, start, end));
    assert.match(coordinator, /^name: Seven$/m);
    assert.match(contract, /Do not implement, edit files, run shell commands, or release/);
    assert.match(contract, /Data independently reviews the current substantive revision/);
    assert.match(contract, /Agent merge and automatic merging/);
    assert.match(contract, /fleet mode/);
    assert.match(contract, /separate worktrees for parallel changes/);
    assert.match(contract, /stacked PRs/);
    assert.match(contract, /explicit approval before spending money/);
    assert.match(contract, /native atomic casting protocol/);
    assert.doesNotMatch(coordinator, /work inline \(fallback only/i);
    assert.doesNotMatch(coordinator, /original author is locked out/i);
  });

  it("keeps optional ceremonies and support agents inactive by default", () => {
    const ceremonies = read(".squad", "ceremonies.md");
    for (const name of ["Design Review", "Retrospective", "Retrospective with Enforcement"]) {
      const body = section(ceremonies, name);
      assert.match(body, /\|\s*\*\*Trigger\*\*\s*\|\s*manual\s*\|/);
      assert.match(body, /\|\s*\*\*Enabled\*\*\s*\|\s*no\s*\|/);
    }
    const coordinator = read(".github", "agents", "squad.agent.md");
    assert.match(coordinator, /support identities and are inactive unless the user explicitly requests them/);
    assert.doesNotMatch(coordinator, /spawned automatically before user-facing artifacts/i);
    assert.doesNotMatch(coordinator, /Ralph is the always-on work monitor/i);
    assert.match(coordinator, /`\.squad\/agents\/Rai\/charter\.md`/);
    assert.match(coordinator, /`\.squad\/templates\/rai-charter\.md`/);
    assert.ok(existsSync(path.join(".squad", "agents", "Rai", "charter.md")));
    assert.ok(existsSync(path.join(".squad", "templates", "rai-charter.md")));
  });

  it("keeps Copilot decisions on the configured state bridge", () => {
    const instructions = read(".github", "copilot-instructions.md");
    const template = read(".squad", "templates", "copilot-instructions.md");
    for (const content of [instructions, template]) {
      const decisions = section(content, "Decisions");
      assert.match(decisions, /squad_decide/);
      assert.match(decisions, /do not write directly to `.squad\/decisions\/`/i);
      assert.doesNotMatch(decisions, /the Scribe will merge it/i);
    }
  });
});
