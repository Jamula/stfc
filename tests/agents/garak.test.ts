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
  assertIssueRoutedTo,
  assertDecisionsReference,
  assertDecisionInbox,
} from "./helpers.ts";

const charter = readCharter("garak");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const issueEntries = parseIssueRouting(routing);

describe("Garak — charter ownership", () => {
  it("owns critique, risk surfacing, assumption auditing, pre-mortems, hostile fact-checks", () => {
    assertOwnership(charter, [
      "Challenging proposals",
      "assumptions",
      "Pre-mortems",
      "risks",
      "Hostile fact-checks",
    ]);
  });

  it("owns cross-provider critique for analytical diversity", () => {
    assert.ok(
      charter.toLowerCase().includes("cross-provider"),
      "Charter should mention cross-provider critique",
    );
    assert.ok(
      charter.toLowerCase().includes("analytical diversity"),
      "Charter should mention analytical diversity",
    );
  });
});

describe("Garak — routing accuracy", () => {
  it("routes critique/risk/assumptions to Garak", () => {
    assertRoutedTo(routingEntries, "Critique, risk, assumptions", "Garak");
  });

  it("routes code review to Kirk with Garak on request", () => {
    const techReview = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("technical correctness"),
    );
    assert.ok(techReview, "Should have technical review entry");
    assert.ok(
      techReview.routeTo.toLowerCase().includes("kirk"),
      "Technical review should route to Kirk",
    );
    assert.ok(
      techReview.routeTo.toLowerCase().includes("garak"),
      "Technical review should mention Garak as co-reviewer",
    );
  });

  it("issue routing maps squad:garak to Garak", () => {
    assertIssueRoutedTo(issueEntries, "squad:garak", "garak");
  });
});

describe("Garak — boundary declarations", () => {
  it("declares correct boundaries", () => {
    assertBoundaries(
      charter,
      ["critique", "risk surfacing", "assumption auditing", "pre-mortems", "hostile fact-checks"],
      ["implementation", "tests", "architecture"],
    );
  });

  it("produces findings, not vetoes — team decides", () => {
    assert.ok(
      charter.includes("findings, not vetoes"),
      'Charter should say "findings, not vetoes"',
    );
    assert.ok(
      charter.includes("The team decides"),
      'Charter should say "The team decides"',
    );
  });

  it("does not block merges directly — Kirk/Picard call the veto", () => {
    assert.ok(
      charter.includes("I do not block merges directly"),
      'Charter should say "I do not block merges directly"',
    );
    assert.ok(
      charter.toLowerCase().includes("kirk calls the technical veto"),
      "Charter should delegate technical veto to Kirk",
    );
    assert.ok(
      charter.toLowerCase().includes("picard calls the scope"),
      "Charter should delegate scope/governance veto to Picard",
    );
  });
});

describe("Garak — signal-to-noise contract", () => {
  it("prioritises highest-impact assumptions — does not nitpick style", () => {
    assert.ok(
      charter.includes("I do not nitpick style"),
      'Charter should say "I do not nitpick style"',
    );
    assert.ok(
      charter.toLowerCase().includes("highest-impact"),
      "Charter should prioritise highest-impact assumptions",
    );
  });

  it("verifies claims against live repo, never against memory", () => {
    assert.ok(
      charter.includes("never against memory"),
      'Charter should say "never against memory"',
    );
  });
});

describe("Garak — model preference", () => {
  it("declares auto/claude-sonnet-5 with premium escalation for high-stakes", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      modelSection[0].includes("claude-sonnet-5"),
      "Model section should declare claude-sonnet-5",
    );
    assert.ok(
      modelSection[0].toLowerCase().includes("premium"),
      "Model section should mention premium escalation",
    );
  });

  it("mentions cross-provider diversity as a critique technique", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      modelSection[0].toLowerCase().includes("cross-provider diversity"),
      "Model section should mention cross-provider diversity",
    );
  });
});

describe("Garak — collaboration", () => {
  it("references .squad/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });

  it("drops decisions to .squad/decisions/inbox/garak-{slug}.md", () => {
    assertDecisionInbox(charter, "garak");
  });

  it("never commits .squad/ paths — Scribe owns those commits", () => {
    assert.ok(
      charter.includes("Never commit"),
      'Charter should say "Never commit .squad/ paths"',
    );
    assert.ok(
      charter.includes("Scribe owns those commits"),
      'Charter should say "Scribe owns those commits"',
    );
  });
});
