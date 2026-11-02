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
    assert.equal(Object.hasOwn(config, "teamRoot"), false);
    assert.equal(Object.hasOwn(config, "stateLocation"), false);
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
      assert.match(charter, /squad_state_create_if_absent/);
      assert.match(charter, /do not use `squad_decide`/i);
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
      assert.match(decisions, /squad_state_create_if_absent/);
      assert.match(decisions, /do not use `squad_decide`/i);
      assert.match(decisions, /do not write directly to `.squad\/decisions\/`/i);
      assert.doesNotMatch(decisions, /the Scribe will merge it/i);
      assert.match(decisions, /unpersisted or unverified decision.*content/i);
    }
  });

  it("requires fallback detection and basic probes of both state layers", () => {
    for (const file of [
      [".github", "agents", "squad.agent.md"],
      [".squad", "templates", "squad.agent.md.template"],
    ]) {
      const content = read(...file);
      const handshake = between(content, "**State-backend handshake", "**⚡ Context caching:**");
      assert.match(handshake, /StateBackendStorageAdapter/);
      assert.match(handshake, /FSStorageProvider/);
      assert.match(handshake, /npx -y @bradygaster\/squad-cli@1\.1\.0 health --json/);
      assert.match(handshake, /checkout root/i);
      assert.doesNotMatch(handshake, /from the team root/i);
      assert.match(handshake, /each.*bridge/i);
      assert.match(handshake, /only.*two-layer.*supported/i);
      assert.match(handshake, /orphan.*StateBackendStorageAdapter/i);
      assert.match(handshake, /restart.*bridge.*after.*config/i);
      assert.match(handshake, /provenance.*HALT/i);
      assert.match(handshake, /Invalidate.*backend configuration.*bridge.*checkout.*host.*environment/i);
      assert.doesNotMatch(content, /file writes to `\.squad\/` are valid/i);
      assert.match(content, /do not switch to a local backend/i);
      assert.match(handshake, /stdout as JSON separately from stderr/);
      assert.match(handshake, /state-backend.*pass/);
      assert.match(handshake, /writer.*own.*checkout.*config/i);
      assert.match(handshake, /Configured two-layer state backend is reachable/);
      assert.match(handshake, /bridge.*startup directory.*checkout root/i);
      assert.match(handshake, /startup directory.*cannot be verified.*HALT/i);
      assert.match(handshake, /teamRoot.*stateLocation.*HALT/i);
      assert.match(handshake, /both.*layers/i);
      assert.match(handshake, /notes-layer write fails/i);
      assert.match(handshake, /does not establish.*data integrity/i);
      assert.match(handshake, /HALT/);
    }
  });

  it("includes pending decisions in handoffs without relying on the racy memory index", () => {
    for (const file of [
      [".github", "agents", "squad.agent.md"],
      [".squad", "templates", "squad.agent.md.template"],
      [".squad", "templates", "spawn-reference.md"],
    ]) {
      const content = read(...file);
      assert.match(content, /squad_state_list.*decisions\/inbox/);
      assert.match(content, /pending.*proposals/i);
      assert.match(content, /do not use `memory\.write`/i);
      assert.match(content, /squad_state_create_if_absent/);
      assert.match(content, /do not use `squad_decide`/i);
    }
    const spawn = read(".squad", "templates", "spawn-reference.md");
    assert.match(spawn, /each writer.*own.*squad_state_health/i);
    assert.match(spawn, /checkout root/i);
    assert.match(spawn, /only.*two-layer.*supported/i);
    assert.match(spawn, /restart.*bridge.*after.*config/i);
    assert.match(spawn, /provenance.*stop/i);
    assert.match(spawn, /own.*checkout.*config/i);
    assert.match(spawn, /Configured two-layer state backend is reachable/);
    assert.match(spawn, /bridge.*startup directory.*checkout root/i);
    assert.match(spawn, /startup directory.*cannot be verified.*stop/i);
    assert.match(spawn, /teamRoot.*stateLocation.*stop/i);
    assert.doesNotMatch(spawn, /skip post-work entirely -- Scribe handles it independently/i);
    assert.doesNotMatch(spawn, /Scribe handles cleanup/i);
    assert.match(spawn, /unpersisted.*decision/i);
    assert.match(spawn, /decision.*coordinator.*authorized handoff/is);
    assert.match(spawn, /uncertainty.*stop/i);
    for (const file of [
      [".squad", "agents", "scribe", "charter.md"],
      [".squad", "templates", "scribe-charter.md"],
      [".squad", "templates", "skills", "coordinator-response-mode", "SKILL.md"],
    ]) {
      const content = read(...file);
      assert.match(content, /verify your own/i);
      assert.match(content, /do not use `squad_decide`/i);
    }
    const lightweight = read(".squad", "templates", "skills", "coordinator-response-mode", "SKILL.md");
    assert.match(lightweight, /unpersisted or unverified decision.*content/i);
  });

  it("keeps decision inbox entries when concurrent consolidation cannot be serialized", () => {
    for (const file of [
      [".github", "agents", "squad.agent.md"],
      [".squad", "templates", "squad.agent.md.template"],
      [".squad", "templates", "spawn-reference.md"],
      [".squad", "agents", "scribe", "charter.md"],
      [".squad", "templates", "scribe-charter.md"],
      [".squad", "templates", "after-agent-reference.md"],
    ]) {
      const content = read(...file);
      assert.match(content, /do not (?:merge|consolidate).*decisions/i, file.join("/"));
      assert.match(content, /do not delete.*inbox/i, file.join("/"));
      assert.doesNotMatch(content, /merge (?:accepted )?(?:durable )?decisions into `decisions\.md` with `squad_state_write`/i, file.join("/"));
    }
    const worktrees = read(".squad", "templates", "worktree-reference.md");
    assert.match(worktrees, /linked worktrees share.*state.*refs/i);
    assert.doesNotMatch(worktrees, /no shared-state races/i);
    assert.match(worktrees, /Nested, external, and other-checkout team roots are unsupported/i);
    assert.doesNotMatch(worktrees, /If `teamRoot` is set/i);
  });

  it("blocks unsafe in-place upgrades and preserves the team and workflow policy", () => {
    const instructions = read(".squad", "templates", "session-init-reference.md");
    const flow = between(instructions, "### 1.6 Upgrade Flow", "### 1.7 Failure Modes");
    assert.match(flow, /do not run `squad upgrade` in this repository/i);
    assert.match(flow, /isolated.*clone/i);
    assert.match(flow, /coordinator.*contract/i);
    assert.match(flow, /workflow/i);
    assert.doesNotMatch(flow, /^\s*squad upgrade\s*$/m);
    const catalog = read(".squad", "templates", "skills", "squad", "SKILL.md");
    const upgrade = between(catalog, "### Upgrade Squad CLI", "### Initialize Squad");
    assert.match(upgrade, /session-init-reference\.md/);
    assert.match(upgrade, /do not run `squad upgrade` in this repository/i);
    assert.doesNotMatch(upgrade, /\*\*action:\*\* shell/);
    const init = between(catalog, "### Initialize Squad", "### Switch State Backend");
    assert.match(init, /do not run `squad init` in this repository/i);
    assert.doesNotMatch(init, /\*\*action:\*\* shell/);
    const switchBackend = between(catalog, "### Switch State Backend", "---\n\n## Team Management");
    assert.match(switchBackend, /verified.*migration/i);
    assert.match(switchBackend, /do not.*config/i);
    assert.match(switchBackend, /backend switching.*unsupported/i);
    assert.match(switchBackend, /only.*two-layer/i);
    assert.doesNotMatch(switchBackend, /\*\*action:\*\* file-edit/);
  });

  it("loads the coordinator's required protocols from files that exist", () => {
    for (const file of [
      [".github", "agents", "squad.agent.md"],
      [".squad", "templates", "squad.agent.md.template"],
    ]) {
      const content = read(...file);
      for (const name of [
        "coordinator-init-mode",
        "coordinator-response-mode",
        "coordinator-source-of-truth",
        "cross-squad",
        "cross-squad-communication",
        "squad",
      ]) {
        const reference = `.squad/templates/skills/${name}/SKILL.md`;
        assert.ok(content.includes(reference), `${file.join("/")} must reference ${reference}`);
        assert.ok(existsSync(path.join(".squad", "templates", "skills", name, "SKILL.md")));
      }
    }
  });

  it("discloses that two-layer state is local until explicitly synchronized", () => {
    const team = read(".squad", "team.md");
    assert.match(team, /state is local/i);
    assert.match(team, /not synchronized/i);
    assert.match(team, /explicit user approval/i);
    assert.match(team, /sync.*fail/i);
  });
});
