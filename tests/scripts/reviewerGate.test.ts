import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  REVIEW_GATE_CONTEXT,
  evaluateReviewerGate,
  extractReviewerLanes,
  getPullRequestNumber,
  parseVerdictComment,
  runReviewerGate,
} from "../../scripts/reviewer-gate.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const NEXT_HEAD = "89abcdef0123456789abcdef0123456789abcdef";
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflowPath = path.join(
  repoRoot,
  ".github",
  "workflows",
  "squad-reviewer-gate.yml",
);

function prBody(...reviewers: string[]): string {
  return [
    "# Test PR",
    "",
    "## Reviewer lanes",
    ...reviewers.map((reviewer) => `- **${reviewer}**: assigned scope`),
    "",
    "## Testing",
    "Done.",
  ].join("\n");
}

function verdict({
  id,
  reviewer,
  head = HEAD,
  kind = "APPROVE",
  timestamp = "2026-08-25T01:00:00Z",
}: {
  id: number;
  reviewer: string;
  head?: string;
  kind?: "APPROVE" | "CHANGES_REQUESTED";
  timestamp?: string;
}) {
  return {
    id,
    body: `**${kind}**\n**Reviewer:** ${reviewer}\n**Head:** \`${head}\``,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

describe("reviewer gate policy", () => {
  it("extracts unique, non-placeholder reviewer lanes", () => {
    assert.deepEqual(
      extractReviewerLanes(
        `${prBody("Kirk", "Garak")}\n- **Kirk**: duplicate\n- **<Reviewer>**: placeholder`,
      ),
      ["Kirk", "Garak"],
    );
  });

  it("fails closed when reviewer lanes are missing", () => {
    const result = evaluateReviewerGate({
      prBody: "# No lanes",
      headSha: HEAD,
      comments: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /declare at least one/);
  });

  it("passes only when every required lane approves the current head", () => {
    const result = evaluateReviewerGate({
      prBody: prBody("Kirk", "Garak"),
      headSha: HEAD,
      comments: [
        verdict({ id: 1, reviewer: "Kirk" }),
        verdict({ id: 2, reviewer: "Garak" }),
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.state, "success");
    assert.deepEqual(result.requiredLanes, ["Kirk", "Garak"]);
  });

  it("invalidates every approval after the PR head changes", () => {
    const result = evaluateReviewerGate({
      prBody: prBody("Kirk"),
      headSha: NEXT_HEAD,
      comments: [verdict({ id: 1, reviewer: "Kirk", head: HEAD })],
    });
    assert.equal(result.ok, false);
    assert.match(result.laneResults[0]!.reason, /stale head/);
  });

  it("uses the latest verdict per lane", () => {
    const result = evaluateReviewerGate({
      prBody: prBody("Kirk"),
      headSha: HEAD,
      comments: [
        verdict({
          id: 1,
          reviewer: "Kirk",
          kind: "CHANGES_REQUESTED",
          timestamp: "2026-08-25T01:00:00Z",
        }),
        verdict({
          id: 2,
          reviewer: "Kirk",
          timestamp: "2026-08-25T02:00:00Z",
        }),
      ],
    });
    assert.equal(result.ok, true);
  });

  it("does not let an edit to an old approval supersede a newer rejection", () => {
    const result = evaluateReviewerGate({
      prBody: prBody("Kirk"),
      headSha: HEAD,
      comments: [
        {
          ...verdict({
            id: 9,
            reviewer: "Kirk",
            timestamp: "2026-08-25T01:00:00Z",
          }),
          updated_at: "2026-08-25T03:00:00Z",
        },
        verdict({
          id: 10,
          reviewer: "Kirk",
          kind: "CHANGES_REQUESTED",
          timestamp: "2026-08-25T02:00:00Z",
        }),
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.laneResults[0]!.reason, /CHANGES_REQUESTED/);
  });

  it("blocks when the latest current-head verdict requests changes", () => {
    const result = evaluateReviewerGate({
      prBody: prBody("Garak"),
      headSha: HEAD,
      comments: [
        verdict({ id: 1, reviewer: "Garak" }),
        verdict({
          id: 2,
          reviewer: "Garak",
          kind: "CHANGES_REQUESTED",
          timestamp: "2026-08-25T02:00:00Z",
        }),
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.laneResults[0]!.reason, /CHANGES_REQUESTED/);
  });

  it("rejects malformed verdict comments instead of ignoring them", () => {
    const parsed = parseVerdictComment({
      id: 7,
      body: "**APPROVE**\nLooks good.",
      created_at: "2026-08-25T01:00:00Z",
    });
    assert.ok(parsed);
    assert.deepEqual(parsed.errors, [
      "missing or placeholder **Reviewer:** line",
      "missing full 40-character **Head:** SHA line",
    ]);

    const result = evaluateReviewerGate({
      prBody: prBody("Kirk"),
      headSha: HEAD,
      comments: [
        {
          id: 7,
          body: "**APPROVE**\nLooks good.",
          created_at: "2026-08-25T01:00:00Z",
        },
      ],
    });

    it("uses numeric comment IDs to break equal-timestamp ties", () => {
      const result = evaluateReviewerGate({
        prBody: prBody("Kirk"),
        headSha: HEAD,
        comments: [
          verdict({ id: 9, reviewer: "Kirk" }),
          verdict({
            id: 10,
            reviewer: "Kirk",
            kind: "CHANGES_REQUESTED",
          }),
        ],
      });
      assert.equal(result.ok, false);
      assert.match(result.laneResults[0]!.reason, /CHANGES_REQUESTED/);
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
  });

  it("accepts only pull-request event payloads", () => {
    assert.equal(
      getPullRequestNumber({ pull_request: { number: 220 } }),
      220,
    );
    assert.equal(
      getPullRequestNumber({
        issue: { number: 220, pull_request: { url: "https://example.test" } },
      }),
      220,
    );
    assert.throws(() => getPullRequestNumber({ issue: { number: 220 } }));
  });
});

describe("reviewer gate GitHub adapter", () => {
  it("publishes failure on the exact current head SHA", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.endsWith("/pulls/220")) {
        return new Response(
          JSON.stringify({ body: prBody("Kirk"), head: { sha: HEAD } }),
          { status: 200 },
        );
      }
      if (url.includes("/issues/220/comments")) {
        return new Response("[]", { status: 200 });
      }
      if (url.endsWith(`/statuses/${HEAD}`)) {
        return new Response("{}", { status: 201 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await runReviewerGate({
      eventPayload: { pull_request: { number: 220 } },
      token: "fake-token",
      repository: "Jamula/stfc",
      fetchImpl,
    });

    assert.equal(result.ok, false);
    const statusRequest = requests.at(-1)!;
    assert.match(statusRequest.url, new RegExp(`/statuses/${HEAD}$`));
    assert.deepEqual(statusRequest.body, {
      state: "failure",
      context: REVIEW_GATE_CONTEXT,
      description: result.description,
    });
  });

  it("fails loudly on GitHub API errors", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("permission denied", { status: 403 });
    await assert.rejects(
      runReviewerGate({
        eventPayload: { pull_request: { number: 220 } },
        token: "fake-token",
        repository: "Jamula/stfc",
        fetchImpl,
      }),
      /failed \(403\): permission denied/,
    );
  });
});

describe("squad-reviewer-gate workflow contract", () => {
  const yaml = fs.readFileSync(workflowPath, "utf8");

  it("runs trusted logic from the default branch on PR and comment changes", () => {
    assert.match(yaml, /pull_request_target:/);
    assert.match(yaml, /issue_comment:/);
    assert.match(yaml, /synchronize/);
    assert.match(yaml, /types:\s*\[created, edited, deleted\]/);
    assert.match(
      yaml,
      /ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/,
    );
    assert.match(yaml, /persist-credentials:\s*false/);
  });

  it("uses least-privilege read permissions plus status publication", () => {
    assert.match(yaml, /contents:\s*read/);
    assert.match(yaml, /issues:\s*read/);
    assert.match(yaml, /pull-requests:\s*read/);
    assert.match(yaml, /statuses:\s*write/);
    assert.doesNotMatch(yaml, /contents:\s*write/);
  });

  it("runs the tested module and contains no merge or ready command", () => {
    assert.match(
      yaml,
      /node scripts\/reviewer-gate\.mjs "\$GITHUB_EVENT_PATH"/,
    );
    assert.doesNotMatch(yaml, /\bgh pr (merge|ready)\b/);
    assert.doesNotMatch(yaml, /enable[_ -]pull[_ -]request[_ -]automerge/i);
  });

  it("pins every external action to a full commit SHA", () => {
    const actions = [
      ...yaml.matchAll(/^[ \t]*-[ \t]+uses:[ \t]*(\S+)/gm),
    ].map(
      (match) => match[1]!,
    );
    assert.ok(actions.length >= 2);
    for (const action of actions) {
      assert.match(action, /@[0-9a-f]{40}\b/);
    }
  });
});

describe("reviewer gate documentation contract", () => {
  const template = fs.readFileSync(
    path.join(repoRoot, ".github", "pull_request_template.md"),
    "utf8",
  );
  const runbook = fs.readFileSync(
    path.join(repoRoot, "docs", "REVIEWER-GATE.md"),
    "utf8",
  );

  it("requires reviewer lanes in the PR template", () => {
    assert.match(template, /## Reviewer lanes/);
    assert.match(template, /\*\*<Reviewer>\*\*/);
  });

  it("documents SHA binding, trust limits, break glass, and deferred ruleset mutation", () => {
    assert.match(runbook, /full 40-character value/);
    assert.match(
      runbook,
      /not a security boundary[\s\S]*owner-identity[\s\S]*session/,
    );
    assert.match(runbook, /## Break-glass runbook/);
    assert.match(runbook, /Assess Dependabot/);
    assert.match(
      runbook,
      /Ruleset `16162127`[\s\S]*intentionally[\s\S]*unchanged/,
    );
  });
});
