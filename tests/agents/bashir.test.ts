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
  assertDecisionsReference,
  assertDecisionInbox,
} from "./helpers.ts";

const charter = readCharter("bashir");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const issueEntries = parseIssueRouting(routing);

describe("Bashir — charter ownership", () => {
  it("owns tests, fixtures, coverage, QA", () => {
    assertOwnership(charter, [
      "tests/",
      "fixtures",
      "coverage",
    ]);
  });

  it("owns test reliability — no flakes", () => {
    assert.ok(
      charter.toLowerCase().includes("reliability"),
      "Charter should mention test reliability",
    );
    assert.ok(
      charter.toLowerCase().includes("flake"),
      "Charter should mention flaky tests",
    );
  });

  it("holds a reviewer gate — can reject changes lacking coverage", () => {
    assert.ok(
      charter.toLowerCase().includes("reject"),
      "Charter should mention ability to reject changes",
    );
    assert.ok(
      charter.toLowerCase().includes("coverage"),
      "Charter should mention coverage",
    );
  });
});

describe("Bashir — routing accuracy", () => {
  it("routes tests/fixtures/coverage to Bashir", () => {
    assertRoutedTo(routingEntries, "Tests, fixtures, coverage", "Bashir");
  });

  it("issue routing maps squad:bashir to Bashir", () => {
    assertIssueRoutedTo(issueEntries, "squad:bashir", "bashir");
  });

  it("Bashir is NOT the route for TypeScript/CLI, STFC API, or scope", () => {
    assertNotRoutedTo(routingEntries, "TypeScript", "Bashir");
    assertNotRoutedTo(routingEntries, "STFC API", "Bashir");
    assertNotRoutedTo(routingEntries, "Scope, priorities", "Bashir");
  });
});

describe("Bashir — boundary declarations", () => {
  it("declares correct boundaries", () => {
    assertBoundaries(
      charter,
      ["test design", "test code", "fixtures", "coverage"],
      ["architecture"],
    );
  });

  it("defers production code to Scotty/Uhura and architecture to Picard", () => {
    const boundariesMatch = charter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch, "Charter must have a ## Boundaries section");
    const boundaries = boundariesMatch[0].toLowerCase();
    assert.ok(
      boundaries.includes("scotty") || boundaries.includes("uhura"),
      "Boundaries should mention Scotty or Uhura for production code",
    );
    assert.ok(
      boundaries.includes("picard"),
      "Boundaries should mention Picard for architecture",
    );
  });
});

describe("Bashir — test-first discipline", () => {
  it("charter mandates writing failing test first when fixing a bug", () => {
    assert.ok(
      charter.includes("failing test first"),
      'Charter should mandate "failing test first"',
    );
  });

  it("requires behaviour change to be observable in tests", () => {
    assert.ok(
      charter.toLowerCase().includes("observable in tests"),
      "Charter should require changes be observable in tests",
    );
  });
});

describe("Bashir — model preference", () => {
  it("declares auto/claude-sonnet-4.6 for test code", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      modelSection[0].includes("auto") ||
        modelSection[0].includes("claude-sonnet-4.6"),
      "Model section should declare auto or claude-sonnet-4.6",
    );
  });
});

describe("Bashir — collaboration", () => {
  it("references .squad/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });

  it("drops decisions to .squad/decisions/inbox/bashir-{slug}.md", () => {
    assertDecisionInbox(charter, "bashir");
  });
});
