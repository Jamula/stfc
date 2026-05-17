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

const charter = readCharter("uhura");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const issueEntries = parseIssueRouting(routing);

describe("Uhura — charter ownership", () => {
  it("owns STFC API, JWT, redemption, STFC_ACCOUNTS, bookmarklet", () => {
    assertOwnership(charter, [
      "STFC",
      "JWT",
      "redemption",
      "STFC_ACCOUNTS",
      "bookmarklet",
    ]);
  });

  it("owns auth and secret handling", () => {
    assertOwnership(charter, ["auth", "secret"]);
  });

  it("owns response parsing", () => {
    assertOwnership(charter, ["response parsing"]);
  });
});

describe("Uhura — secret-handling discipline", () => {
  it("charter references secret custody / STFC_ACCOUNTS handling", () => {
    assert.ok(
      charter.toLowerCase().includes("stfc_accounts"),
      "Charter should mention STFC_ACCOUNTS",
    );
    assert.ok(
      charter.toLowerCase().includes("secret"),
      "Charter should mention secrets",
    );
  });

  it("treats tokens as secrets — never log, never commit", () => {
    assert.ok(
      charter.includes("Never log, never commit"),
      'Charter should say "Never log, never commit"',
    );
  });
});

describe("Uhura — routing accuracy", () => {
  it("routes STFC API/auth/secrets to Uhura", () => {
    assertRoutedTo(routingEntries, "STFC API, auth, secrets", "Uhura");
  });

  it("routes GitHub Actions cron + secrets to Uhura", () => {
    const workflowEntry = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("github actions"),
    );
    assert.ok(workflowEntry, "Should have GitHub Actions entry");
    assert.ok(
      workflowEntry.routeTo.toLowerCase().includes("uhura"),
      "GitHub Actions (cron + secrets) should route to Uhura",
    );
  });

  it("issue routing maps squad:uhura to Uhura", () => {
    assertIssueRoutedTo(issueEntries, "squad:uhura", "uhura");
  });

  it("TypeScript/CLI routes to Scotty, NOT Uhura", () => {
    assertNotRoutedTo(routingEntries, "TypeScript", "Uhura");
  });
});

describe("Uhura — boundary declarations", () => {
  it("declares correct boundaries", () => {
    assertBoundaries(
      charter,
      ["STFC API", "auth", "secret handling"],
      ["architecture"],
    );
  });

  it("defers CLI plumbing to Scotty and test authoring to Bashir", () => {
    const boundariesMatch = charter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch, "Charter must have a ## Boundaries section");
    const boundaries = boundariesMatch[0].toLowerCase();
    assert.ok(
      boundaries.includes("scotty"),
      "Boundaries should mention Scotty for CLI plumbing",
    );
    assert.ok(
      boundaries.includes("bashir"),
      "Boundaries should mention Bashir for test authoring",
    );
  });
});

describe("Uhura — model preference", () => {
  it("declares auto/claude-sonnet-4.6 for integration code", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      modelSection[0].includes("auto") ||
        modelSection[0].includes("claude-sonnet-4.6"),
      "Model section should declare auto or claude-sonnet-4.6",
    );
  });
});

describe("Uhura — collaboration", () => {
  it("references .squad/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });

  it("drops decisions to .squad/decisions/inbox/uhura-{slug}.md", () => {
    assertDecisionInbox(charter, "uhura");
  });
});
