import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readCharter,
  readRouting,
  parseRoutingTable,
  assertOwnership,
  assertBoundaries,
  assertRoutedTo,
  assertModelPreference,
  assertDecisionsReference,
  assertDecisionInbox,
} from "./helpers.ts";

const charter = readCharter("tuvok");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);

describe("Tuvok — charter ownership", () => {
  it("owns surgical edits to governance artifacts per explicit reviewer findings", () => {
    assertOwnership(charter, [
      "Surgical edits",
      "governance artifacts",
      "reviewer findings",
    ]);
  });

  it("owns change-impact accounting and cross-reference discipline", () => {
    assertOwnership(charter, [
      "change-impact accounting",
      "cross-reference",
    ]);
  });

  it("owns reviewer-mandate fidelity", () => {
    assert.ok(
      charter.includes("Reviewer-mandate fidelity"),
      "Charter should declare reviewer-mandate fidelity",
    );
    assert.ok(
      charter.includes("reviewer's stated finding, not my interpretation"),
      "Charter should say edits match the reviewer's stated finding",
    );
  });
});

describe("Tuvok — boundary declarations", () => {
  it("handles surgical edits, change-impact accounting, cross-reference fixes", () => {
    assertBoundaries(
      charter,
      ["Surgical edits", "change-impact accounting", "cross-reference fixes"],
      ["implementation", "tests", "architecture"],
    );
  });

  it("does not author, design, or make architectural calls", () => {
    const boundariesMatch = charter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch, "Charter must have a ## Boundaries section");
    const boundaries = boundariesMatch[0].toLowerCase();
    assert.ok(
      boundaries.includes("authoring principles"),
      "Boundaries should mention not authoring principles",
    );
    assert.ok(
      boundaries.includes("designing process"),
      "Boundaries should mention not designing process",
    );
    assert.ok(
      boundaries.includes("architectural calls"),
      "Boundaries should mention not making architectural calls",
    );
  });

  it("is editor, not reviewer — review veto belongs to others", () => {
    const boundariesMatch = charter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch);
    const boundaries = boundariesMatch[0];
    assert.ok(
      boundaries.includes("My role is editor, not reviewer"),
      'Boundaries should say "My role is editor, not reviewer"',
    );
  });
});

describe("Tuvok — reviewer-mandate fidelity", () => {
  it("edits match the reviewer's stated finding, not Tuvok's interpretation", () => {
    assert.ok(
      charter.includes("reviewer's stated finding, not my interpretation"),
      "Charter should enforce reviewer-mandate fidelity",
    );
  });

  it("never invents the fix when a finding is ambiguous", () => {
    assert.ok(
      charter.includes("never invent the fix"),
      'Charter should say "never invent the fix"',
    );
  });
});

describe("Tuvok — escalation pattern", () => {
  it("asks when unsure — does not improvise corrections", () => {
    const boundariesMatch = charter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch);
    const boundaries = boundariesMatch[0];
    assert.ok(
      boundaries.includes("I ask. I do not improvise corrections"),
      'Boundaries should say "I ask. I do not improvise corrections"',
    );
  });

  it("escalates to the reviewer or the Lead when scope exceeds editing", () => {
    const boundariesMatch = charter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch);
    assert.ok(
      boundariesMatch[0].includes("escalate to the reviewer or the Lead"),
      "Boundaries should mention escalation path",
    );
  });
});

describe("Tuvok — routing accuracy", () => {
  it("routes editorial passes on governance docs to Tuvok", () => {
    assertRoutedTo(routingEntries, "Editorial passes", "Tuvok");
  });

  it("routing entry mentions reviewer findings and cross-reference fixes", () => {
    const entry = routingEntries.find(
      (e) => e.routeTo.toLowerCase().includes("tuvok"),
    );
    assert.ok(entry, "Routing table should have a Tuvok entry");
    assert.ok(
      entry.examples.toLowerCase().includes("cross-reference"),
      "Tuvok routing examples should mention cross-reference fixes",
    );
  });
});

describe("Tuvok — model preference", () => {
  it("declares auto as preferred model", () => {
    assertModelPreference(charter, "auto");
  });

  it("mentions sonnet for text-editing precision and haiku for trivial edits", () => {
    const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
    assert.ok(modelSection, "Charter must have a ## Model section");
    assert.ok(
      modelSection[0].toLowerCase().includes("sonnet"),
      "Model section should mention sonnet",
    );
    assert.ok(
      modelSection[0].toLowerCase().includes("haiku"),
      "Model section should mention haiku",
    );
  });
});

describe("Tuvok — collaboration", () => {
  it("references .squad/decisions.md as first-read", () => {
    assertDecisionsReference(charter);
  });

  it("drops decisions to .squad/decisions/inbox/tuvok-{slug}.md", () => {
    assertDecisionInbox(charter, "tuvok");
  });
});
