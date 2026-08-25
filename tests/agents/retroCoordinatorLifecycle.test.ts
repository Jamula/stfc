// Honestly-scoped structural pin for the round-start retro gate (issue
// #245; #248 Garak finding 1, second-round review — "no executable
// coordinator/round dispatcher calls it... deleting all runtime invocation
// behavior would not make that test fail, because none exists").
//
// The first revision of this test claimed squad.agent.md's Core Logic step
// 0 was "lifecycle wiring" while conceding in its own comments that there
// was no process boundary — Garak correctly identified that as an
// unfalsifiable claim: squad.agent.md is a prompt read by an LLM
// coordinator, and no unit test can prove a live session executed any
// part of it. This revision does two things instead:
//
//   1. It pins that squad.agent.md's own prose is now HONEST about that
//      limit — it explicitly says step 0 is advisory/unverifiable for the
//      interactive coordinator, and names the real dispatcher below as the
//      actual point of enforcement. This is intentionally a documentation
//      pin, not a claim of runtime verification.
//   2. It pins the REAL, externally verifiable dispatcher:
//      `.github/workflows/squad-heartbeat.yml` → `.squad/templates/ralph-triage.js`,
//      which runs as a genuine GitHub Actions job on real triggers and
//      whose behavior (including the fake-queue-boundary proof that
//      "overdue" actually suppresses queue construction) is exercised in
//      `tests/scripts/ralphTriageRetroGate.test.ts`, not merely referenced
//      here.
//
// Registered in tests/index.test.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const agentPath = path.join(repoRoot, ".github", "agents", "squad.agent.md");
const ceremoniesPath = path.join(repoRoot, ".squad", "ceremonies.md");
const scriptPath = path.join(repoRoot, "scripts", "check-retro-overdue.mjs");
const ralphTriagePath = path.join(repoRoot, ".squad", "templates", "ralph-triage.js");
const heartbeatWorkflowPath = path.join(repoRoot, ".github", "workflows", "squad-heartbeat.yml");
const installedHeartbeatWorkflowPath = path.join(repoRoot, ".squad", "templates", "workflows", "squad-heartbeat.yml");

function read(p: string): string {
  return fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
}

describe("round-start retro gate — honest scoping of the interactive coordinator's prose", () => {
  const agent = read(agentPath);

  it("scripts/check-retro-overdue.mjs exists and is not a symlink/reparse point", () => {
    assert.ok(fs.existsSync(scriptPath));
    const st = fs.lstatSync(scriptPath);
    assert.equal(st.isSymbolicLink(), false);
    assert.equal(st.isFile(), true);
  });

  it("squad.agent.md Core Logic step 0 explicitly concedes it is a prompt instruction, not independently verifiable execution", () => {
    const ceremoniesSection = agent.slice(agent.indexOf("### Ceremonies"), agent.indexOf("### Adding Team Members"));
    assert.match(
      ceremoniesSection,
      /0\.\s*\*\*Round-start retro gate/,
      "Core Logic must still document a step 0 for the round-start retro gate",
    );
    assert.match(
      ceremoniesSection,
      /no external test can prove a live session actually executes it|no separate process that can\s*\n?\s*verify a live session actually ran it/,
      "step 0 must explicitly disclose that this is unverifiable prose, per Garak's second-round finding",
    );
  });

  it("squad.agent.md names the REAL externally-verifiable dispatcher, not just itself, as the enforcement point", () => {
    const ceremoniesSection = agent.slice(agent.indexOf("### Ceremonies"), agent.indexOf("### Adding Team Members"));
    assert.match(ceremoniesSection, /squad-heartbeat\.yml/);
    assert.match(ceremoniesSection, /ralph-triage\.js/);
    assert.match(ceremoniesSection, /tests\/scripts\/ralphTriageRetroGate\.test\.ts/);
  });

  it("squad.agent.md documents the CLI's JSON stdin/stdout bridge protocol for non-local backends, not an in-process import", () => {
    const ceremoniesSection = agent.slice(agent.indexOf("### Ceremonies"), agent.indexOf("### Adding Team Members"));
    assert.match(ceremoniesSection, /overdue --backend/);
    assert.match(ceremoniesSection, /squad_state_list\(dir: "log"\)/);
    assert.match(ceremoniesSection, /stdin/);
  });

  it("squad.agent.md states plainly that full interactive-coordinator enforcement remains open under #245", () => {
    const ceremoniesSection = agent.slice(agent.indexOf("### Ceremonies"), agent.indexOf("### Adding Team Members"));
    assert.match(ceremoniesSection, /remains (tracked under|open under) issue #245/);
  });
});

describe("round-start retro gate — the real dispatcher (squad-heartbeat.yml → ralph-triage.js)", () => {
  it("ralph-triage.js exists, is not a symlink, and exports the gate/queue/round functions", () => {
    assert.ok(fs.existsSync(ralphTriagePath));
    const st = fs.lstatSync(ralphTriagePath);
    assert.equal(st.isSymbolicLink(), false);
    const content = read(ralphTriagePath);
    assert.match(content, /function evaluateRetroGate/);
    assert.match(content, /function buildTriageQueue/);
    assert.match(content, /function runRound/);
    assert.match(content, /module\.exports\s*=\s*\{[^}]*evaluateRetroGate/s);
    assert.match(content, /module\.exports\s*=\s*\{[^}]*runRound/s);
  });

  it("ralph-triage.js's runRound() evaluates the retro gate BEFORE constructing the triage queue", () => {
    const content = read(ralphTriagePath);
    const roundStart = content.indexOf("async function runRound(");
    const roundBody = content.slice(roundStart);
    const evalIndex = roundBody.indexOf("const retroGate = await evaluateRetroGate(");
    const buildIndex = roundBody.indexOf("results = buildTriageQueue(");
    assert.ok(evalIndex !== -1 && buildIndex !== -1, "runRound() must call both evaluateRetroGate and buildTriageQueue");
    assert.ok(evalIndex < buildIndex, "evaluateRetroGate must run before buildTriageQueue — this is the actual 'before queue construction' boundary");
  });

  it("ralph-triage.js's runRound() proceeds ONLY when evaluated===true && overdue===false — fail closed on every other outcome (#248 Garak round-3 finding 1)", () => {
    const content = read(ralphTriagePath);
    assert.match(content, /const canProceed = retroGate\.evaluated === true && retroGate\.overdue === false;/);
  });

  it("squad-heartbeat.yml consumes the { retroGate, results, canProceed } shape (not a bare array) written by ralph-triage.js", () => {
    const workflow = read(heartbeatWorkflowPath);
    assert.match(workflow, /canProceed = data\.canProceed === true/);
    assert.match(workflow, /const retroGate = data\.retroGate/);
    assert.match(workflow, /const results = Array\.isArray\(data\) \? data : data\.results/);
  });

  it("squad-heartbeat.yml gates BOTH the triage-apply step and the Assign @copilot step on the same retro-gate output (#248 Garak round-3 finding 1)", () => {
    const workflow = read(heartbeatWorkflowPath);
    const applyStepIndex = workflow.indexOf("Ralph — Apply triage decisions");
    const applyIfStart = workflow.indexOf("if:", applyStepIndex);
    const applyIfLine = workflow.slice(applyIfStart, workflow.indexOf("\n", applyIfStart));
    assert.match(applyIfLine, /steps\.retro-gate\.outputs\.can_proceed == 'true'/);

    const assignStepIndex = workflow.indexOf("Ralph — Assign @copilot issues");
    const assignIfStart = workflow.indexOf("if:", assignStepIndex);
    const assignIfLine = workflow.slice(assignIfStart, workflow.indexOf("\n", assignIfStart));
    assert.match(assignIfLine, /steps\.retro-gate\.outputs\.can_proceed == 'true'/);
  });

  it("squad-heartbeat.yml surfaces an overdue gate loudly (::warning::), not silently, from a step that actually runs regardless of canProceed (#248 Copilot review: prior warnings lived in a step gated to only run when canProceed was true, making them dead code)", () => {
    const workflow = read(heartbeatWorkflowPath);
    const gateStepIndex = workflow.indexOf("Ralph — Check retro gate");
    const applyStepIndex = workflow.indexOf("Ralph — Apply triage decisions");
    const gateStepBlock = workflow.slice(gateStepIndex, applyStepIndex);

    // The retro-gate step's own `if:` must NOT depend on can_proceed —
    // otherwise the warning it emits would be exactly as unreachable as
    // the code it replaced.
    const gateIfStart = workflow.indexOf("if:", gateStepIndex);
    const gateIfLine = workflow.slice(gateIfStart, workflow.indexOf("\n", gateIfStart));
    assert.doesNotMatch(gateIfLine, /can_proceed/, "the gate-check step itself must not be gated on can_proceed, or its warning can never fire");

    assert.match(gateStepBlock, /retroGate\.evaluated && retroGate\.overdue/);
    assert.match(gateStepBlock, /::warning::\[RETRO\] Overdue/);
    assert.match(gateStepBlock, /::warning::\[RETRO\] Round-start gate not evaluated/);
  });

  it("both repo-local heartbeat workflow copies emit the retro warning from the gate-check step, not from the now-unreachable apply step", () => {
    for (const workflowPath of [heartbeatWorkflowPath, installedHeartbeatWorkflowPath]) {
      const workflow = read(workflowPath);
      const gateStepIndex = workflow.indexOf("Ralph — Check retro gate");
      const applyStepIndex = workflow.indexOf("Ralph — Apply triage decisions");
      assert.ok(gateStepIndex !== -1 && applyStepIndex !== -1 && gateStepIndex < applyStepIndex, `${workflowPath} must have both steps in order`);

      const gateStepBlock = workflow.slice(gateStepIndex, applyStepIndex);
      const applyStepBlock = workflow.slice(applyStepIndex);

      assert.match(gateStepBlock, /::warning::\[RETRO\] Overdue/, `${workflowPath}: the gate-check step must emit the overdue warning`);
      assert.match(gateStepBlock, /::warning::\[RETRO\] Round-start gate not evaluated/, `${workflowPath}: the gate-check step must emit the unevaluated warning`);

      // The apply step must no longer contain its own copy of these
      // branches — that copy was unreachable dead code, since this step
      // only ever runs once canProceed is already known true.
      assert.doesNotMatch(applyStepBlock, /retroGate\.evaluated && retroGate\.overdue/, `${workflowPath}: the apply step must not duplicate the (unreachable) overdue branch`);

      const boardClearIndex = applyStepBlock.indexOf("if (!results || results.length === 0) {");
      assert.ok(boardClearIndex !== -1, `${workflowPath} must still have the empty-results branch`);
    }
  });
});

describe("round-start retro gate — ceremonies.md reflects the same honest scoping", () => {
  const ceremonies = read(ceremoniesPath);

  it("'Retrospective with Enforcement' row uses the schema-valid `before` trigger, not `weekly`", () => {
    const section = ceremonies.slice(ceremonies.indexOf("## Retrospective with Enforcement"));
    assert.match(section, /\|\s*\*\*When\*\*\s*\|\s*before\s*\|/);
    assert.doesNotMatch(section, /\|\s*\*\*When\*\*\s*\|\s*weekly\s*\|/);
  });

  it("ceremonies.md names ralph-triage.js as the externally verifiable enforcement point", () => {
    const section = ceremonies.slice(
      ceremonies.indexOf("## Retrospective with Enforcement"),
      ceremonies.indexOf("## Retrospective with Enforcement") + 3000,
    );
    assert.match(section, /ralph-triage\.js/);
    assert.match(section, /independently, externally verifiable|externally verifiable/);
  });

  it("agenda item 5 requires a NEW retro-complete issue every time, never 'update'/'relabel' an existing one (#248 Copilot review: staleness finding)", () => {
    const section = ceremonies.slice(ceremonies.indexOf("## Retrospective with Enforcement"));
    const agendaMatch = /5\.\s*\*\*Completion marker[^\n]*\n?[^\n]*/i.exec(section);
    assert.ok(agendaMatch, "expected a numbered agenda item 5 for the completion marker");
    const agendaText = agendaMatch![0];
    assert.match(agendaText, /\bnew\b/i, "agenda item 5 must require a NEW issue");
    assert.doesNotMatch(agendaText, /open or update/i, "agenda item 5 must not offer an 'update' path — created_at never changes on edit/relabel");
  });

  it("documents that the retro-complete label has actually been provisioned on this repository, not merely described", () => {
    const section = ceremonies.slice(ceremonies.indexOf("## Retrospective with Enforcement"));
    assert.match(section, /Label provisioning/i);
    assert.match(section, /has been created on this repository/i);
  });
});
