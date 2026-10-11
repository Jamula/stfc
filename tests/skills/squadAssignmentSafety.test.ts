import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const workflowSchema = z.object({
  permissions: z.record(z.string(), z.string()),
  jobs: z.record(z.string(), z.object({
    steps: z.array(z.object({
      name: z.string().optional(),
      with: z.object({ script: z.string().optional() }).passthrough().optional(),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

const workflows = [
  [".github/workflows/squad-issue-assign.yml", "Assign @copilot coding agent"],
  [".github/workflows/squad-heartbeat.yml", "Ralph — Assign @copilot issues"],
  [".squad/templates/workflows/squad-issue-assign.yml", "Assign @copilot coding agent"],
  [".squad/templates/workflows/squad-heartbeat.yml", "Ralph — Assign @copilot issues"],
] as const;

async function executeAssignment(script: string, rejectAssignment = false, rejectDiscovery = false) {
  const requests: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const github = {
    request: async (route: string, options: Record<string, unknown>) => {
      assert.equal(route, "POST /repos/{owner}/{repo}/issues/{issue_number}/assignees");
      requests.push(options);
      if (rejectAssignment) throw new Error("assignment API unavailable");
    },
    rest: {
      repos: { get: async () => ({ data: { default_branch: "main" } }) },
      issues: {
        listForRepo: async () => {
          if (rejectDiscovery) throw new Error("issue discovery unavailable");
          return { data: [{ number: 220, assignees: [] }] };
        },
        addAssignees: async () => assert.fail("instruction-free fallback must never run"),
      },
    },
  };
  const core = {
    info: () => {},
    warning: () => {},
    setFailed: (message: string) => failures.push(message),
  };
  const requireMock = (name: string) => {
    assert.equal(name, "fs");
    return {
      existsSync: () => true,
      readFileSync: () => "@copilot\n<!-- copilot-auto-assign: true -->",
    };
  };
  const run = new Function("github", "context", "core", "require",
    `return (async () => { ${script} })();`);
  await run(github, { repo: { owner: "Jamula", repo: "stfc" },
    payload: { issue: { number: 220 } } }, core, requireMock);
  return { requests, failures };
}

describe("Squad assignment open-PR-only boundary (#220)", () => {
  for (const [file, stepName] of workflows) {
    const workflow = workflowSchema.parse(parse(readFileSync(resolve(file), "utf8")));
    const step = Object.values(workflow.jobs).flatMap(job => job.steps)
      .find(candidate => candidate.name === stepName);
    const script = step?.with?.script;
    assert.ok(script, `${file}: assignment script must exist`);

    it(`${file} sends the safety boundary in the actual assignment API payload`, async () => {
      const { requests, failures } = await executeAssignment(script);
      assert.equal(requests.length, 1);
      assert.deepEqual(failures, []);
      const assignment = z.object({
        base_branch: z.string(),
        custom_instructions: z.string(),
      }).passthrough().parse(requests[0]?.agent_assignment);
      assert.equal(assignment.base_branch, "main");
      assert.match(assignment.custom_instructions, /Read .squad\/team.md/);
      assert.match(assignment.custom_instructions, /Open a draft PR and stop/);
      assert.match(assignment.custom_instructions, /Never merge, enable auto-merge, or mark a PR ready/);
      assert.match(assignment.custom_instructions, /explicit user request in the current, active conversation/);
      assert.match(assignment.custom_instructions, /Keep the PR open even when CI is red, unavailable, or has not started, and when required reviews are absent/);
      assert.match(assignment.custom_instructions, /#220/);
    });

    it(`${file} fails visibly without assigning again when the guarded request fails`, async () => {
      const { requests, failures } = await executeAssignment(script, true);
      assert.equal(requests.length, 1);
      assert.equal(failures.length, 1);
      assert.match(failures[0]!, /assignment API unavailable/);
    });

    it(`${file} grants no PR-state write permission or landing operation`, () => {
      assert.notEqual(workflow.permissions["pull-requests"], "write");
      assert.doesNotMatch(script,
        /gh\s+pr\s+(?:merge|ready)|pulls\.merge|enablePullRequestAutoMerge|markPullRequestReadyForReview|\/pulls\/[^'"]*\/merge/i);
    });

    if (file.endsWith("squad-heartbeat.yml")) {
      it(`${file} reports discovery failure instead of an empty board`, async () => {
        const { requests, failures } = await executeAssignment(script, false, true);
        assert.deepEqual(requests, []);
        assert.equal(failures.length, 1);
        assert.match(failures[0]!, /issue discovery unavailable/);
      });
    }
  }

  it("links Ralph to supervised report-only operation and honest host acceptance", () => {
    const runbook = readFileSync(resolve("docs/PR-LANDING-SAFETY.md"), "utf8")
      .replace(/\s+/g, " ");
    const reference = readFileSync(resolve(".squad/templates/ralph-reference.md"), "utf8")
      .replace(/\s+/g, " ");
    assert.match(reference, /#220 hold[\s\S]*report-only[\s\S]*docs\/PR-LANDING-SAFETY.md/);
    assert.match(runbook, /Do not run unattended `squad watch --execute`/);
    assert.match(runbook, /Plain watch\/heartbeat can assign coding work/);
    assert.match(runbook, /do \*\*not\*\* identify the initiating host\/client/);
    assert.match(runbook, /#220 remains open\/blocked/);
    assert.match(runbook, /after the session goes idle/);
    assert.match(runbook, /Repeat with a red check and an unavailable\/unstarted check/);
  });
});
