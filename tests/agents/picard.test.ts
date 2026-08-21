import { describe, it } from "node:test";
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

const charter = readCharter("picard");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const issueEntries = parseIssueRouting(routing);

describe("Picard — charter ownership", () => {
  it("declares ownership of scope, priorities, triage, governance, blocker removal", () => {
    assertOwnership(charter, [
      "scope",
      "priorities",
      "triage",
      "blocker removal",
      "governance",
    ]);
  });

  it("delegates technical direction and architecture to Kirk", () => {
    const delegationSection = charter.match(
      /## What I Don't Own[\s\S]*?(?=\n## |\n# |$)/,
    );
    if (!delegationSection) throw new Error("Missing delegation section");
    const text = delegationSection[0].toLowerCase();
    for (const term of ["technical direction", "architecture", "code review"]) {
      if (!text.includes(term)) {
        throw new Error(`Delegation section should mention "${term}"`);
      }
    }
  });

  it("declares correct boundaries", () => {
    assertBoundaries(
      charter,
      ["scope", "priorities", "triage", "governance", "blocker removal"],
      ["architecture", "implementation", "test authoring"],
    );
  });
});

describe("Picard — triage routing accuracy", () => {
  it("routes `squad` label (untriaged) to Picard for triage", () => {
    assertIssueRoutedTo(issueEntries, "squad", "picard");
  });

  it("routes `squad:picard` label to Picard", () => {
    assertIssueRoutedTo(issueEntries, "squad:picard", "picard");
  });

  it("routes scope/priority/governance work to Picard", () => {
    assertRoutedTo(routingEntries, "Scope, priorities", "Picard");
    assertRoutedTo(routingEntries, "blocker removal", "Picard");
  });

  it("does NOT route TypeScript/CLI, STFC API, or test authoring to Picard", () => {
    assertNotRoutedTo(routingEntries, "TypeScript", "Picard");
    assertNotRoutedTo(routingEntries, "STFC API", "Picard");
    assertNotRoutedTo(routingEntries, "Tests, fixtures", "Picard");
  });
});

describe("Picard — governance gate semantics", () => {
  it("reviews on scope/governance grounds", () => {
    if (!charter.includes("I review on scope/governance grounds")) {
      throw new Error(
        'Charter should say "I review on scope/governance grounds"',
      );
    }
  });

  it("declares Kirk reviews on technical grounds", () => {
    if (!charter.includes("Kirk reviews on technical grounds")) {
      throw new Error(
        'Charter should say "Kirk reviews on technical grounds"',
      );
    }
  });

  it("on rejection, Coordinator names a different agent to revise", () => {
    if (
      !charter.includes(
        "the Coordinator names a different agent to revise",
      )
    ) {
      throw new Error(
        'Charter should say "the Coordinator names a different agent to revise"',
      );
    }
  });
});

describe("Picard — model preference", () => {
  it("declares claude-opus-5 as preferred model", () => {
    assertModelPreference(charter, "claude-opus-5");
  });
});

describe("Picard — collaboration", () => {
  it("references .squad/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });
});
