import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readCharter,
  readRouting,
  parseRoutingTable,
  parseIssueRouting,
  assertOwnership,
  assertBoundaries,
  assertRoutedTo,
  assertNotRoutedTo,
  assertIssueRoutedTo,
  assertModelPreference,
  assertDecisionsReference,
} from "./helpers.ts";

const charter = readCharter("kirk");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const issueEntries = parseIssueRouting(routing);

describe("Kirk — charter ownership", () => {
  it("owns technical direction, architecture, code review, reviewer-rejection lockout", () => {
    assertOwnership(charter, [
      "technical direction",
      "architectural decisions",
      "code review",
      "reviewer-rejection lockout",
    ]);
  });

  it("escalates scope, priorities, triage, blocker removal to Picard", () => {
    const section = charter.match(
      /## What I Don't Own[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(section, "Charter must have a delegation section");
    const text = section[0].toLowerCase();
    for (const term of [
      "scope",
      "priorities",
      "triage",
      "blocker",
    ]) {
      assert.ok(
        text.includes(term),
        `Delegation section should mention "${term}"`,
      );
    }
  });

  it("declares correct boundaries", () => {
    assertBoundaries(
      charter,
      ["architecture", "technical direction", "code review"],
      ["implementation", "test authoring"],
    );
  });
});

describe("Kirk — code review routing", () => {
  it("routes non-trivial PR review to Kirk", () => {
    assertRoutedTo(routingEntries, "Code review (technical correctness)", "Kirk");
  });

  it("routes scope/governance review to Picard, NOT Kirk", () => {
    const scopeReview = routingEntries.find((e) =>
      e.workType.includes("scope / governance"),
    );
    assert.ok(scopeReview, "Routing table should have scope/governance review entry");
    assert.ok(
      scopeReview.routeTo.toLowerCase().includes("picard"),
      "Scope/governance review should route to Picard",
    );
    assert.ok(
      !scopeReview.routeTo.toLowerCase().includes("kirk"),
      "Scope/governance review should NOT route to Kirk",
    );
  });

  it("routes to Kirk with Garak on request for risk review", () => {
    const techReview = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("technical correctness"),
    );
    assert.ok(techReview, "Should have technical review entry");
    assert.ok(
      techReview.routeTo.toLowerCase().includes("garak"),
      "Technical review should mention Garak as co-reviewer",
    );
  });
});

describe("Kirk — reviewer-rejection lockout", () => {
  it("declares enforcement of reviewer-rejection lockout on technical grounds", () => {
    assert.ok(
      charter.includes("Reviewer-rejection lockout enforcement"),
      "Charter should declare reviewer-rejection lockout enforcement",
    );
    assert.ok(
      charter.includes("on technical grounds"),
      "Lockout enforcement should specify 'on technical grounds'",
    );
  });

  it("on rejection, names a different agent — never the original author", () => {
    assert.ok(
      charter.includes("I name a different agent to revise"),
      'Charter should say "I name a different agent to revise"',
    );
    assert.ok(
      charter.includes("never the original author"),
      'Charter should say "never the original author"',
    );
  });
});

describe("Kirk — cross-cutting rule compliance", () => {
  it("routing table maps workflow YAML changes to O'Brien (unified as of 2026-05-18)", () => {
    const workflowEntry = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("github actions"),
    );
    assert.ok(workflowEntry, "Routing table should have GitHub Actions entry");
    assert.ok(
      workflowEntry.routeTo.toLowerCase().includes("o'brien"),
      "Workflow entry should route to O'Brien (unified ownership)",
    );
  });

  it("issue routing maps squad:kirk to Kirk", () => {
    assertIssueRoutedTo(issueEntries, "squad:kirk", "kirk");
  });
});

describe("Kirk — model preference", () => {
  it("declares claude-opus-5 as preferred model", () => {
    assertModelPreference(charter, "claude-opus-5");
  });
});

describe("Kirk — collaboration", () => {
  it("references .squad/decisions/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });
});
