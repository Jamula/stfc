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
  assertDecisionInbox,
} from "./helpers.ts";

const charter = readCharter("scotty");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const issueEntries = parseIssueRouting(routing);

describe("Scotty — charter ownership", () => {
  it("owns TypeScript codebase under src/, build tooling, runtime concerns", () => {
    assertOwnership(charter, [
      "TypeScript codebase under `src/`",
      "build",
      "runtime concerns",
    ]);
  });

  it("owns developer experience", () => {
    assert.ok(
      charter.toLowerCase().includes("developer experience"),
      "Charter should mention developer experience",
    );
  });

  it("does not own STFC API contracts, test strategy, or architecture", () => {
    assertBoundaries(
      charter,
      ["TypeScript implementation", "CLI", "build"],
      ["STFC API", "test strategy"],
    );
  });
});

describe("Scotty — routing accuracy", () => {
  it("routes TypeScript/CLI/build to Scotty", () => {
    assertRoutedTo(routingEntries, "TypeScript", "Scotty");
  });

  it("routes GitHub Actions workflows (build/test) to Scotty", () => {
    const workflowEntry = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("github actions"),
    );
    assert.ok(workflowEntry, "Should have GitHub Actions entry");
    assert.ok(
      workflowEntry.routeTo.toLowerCase().includes("scotty"),
      "GitHub Actions (build/test) should route to Scotty",
    );
  });

  it("issue routing maps squad:scotty to Scotty", () => {
    assertIssueRoutedTo(issueEntries, "squad:scotty", "scotty");
  });

  it("Scotty is NOT the route for STFC API, test authoring, or scope decisions", () => {
    assertNotRoutedTo(routingEntries, "STFC API", "Scotty");
    assertNotRoutedTo(routingEntries, "Tests, fixtures", "Scotty");
    assertNotRoutedTo(routingEntries, "Scope, priorities", "Scotty");
  });
});

describe("Scotty — model preference", () => {
  it("declares gpt-5.3-codex per config override", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      modelSection[0].includes("gpt-5.3-codex"),
      "Model section should declare gpt-5.3-codex",
    );
  });

  it("does not request a premium model", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      !modelSection[0].includes("opus"),
      "Scotty should not request a premium opus model",
    );
  });
});

describe("Scotty — collaboration pattern", () => {
  it("references .squad/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });

  it("drops decisions to .squad/decisions/inbox/scotty-{slug}.md", () => {
    assertDecisionInbox(charter, "scotty");
  });
});
