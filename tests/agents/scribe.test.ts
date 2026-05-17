import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  readCharter,
  readRouting,
  parseRoutingTable,
} from "./helpers.ts";

const charter = readCharter("scribe");
const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const teamMd = readFileSync(
  resolve(process.cwd(), ".squad/team.md"),
  "utf-8",
);
const rules = readFileSync(
  resolve(process.cwd(), ".github/copilot-instructions.md"),
  "utf-8",
);

describe("Scribe — charter ownership", () => {
  it("charter exists and identifies Scribe role", () => {
    assert.ok(
      charter.includes("Scribe"),
      "Charter should identify the Scribe role",
    );
  });

  it("charter mentions documentation, history, or decisions", () => {
    const lower = charter.toLowerCase();
    assert.ok(
      lower.includes("history") ||
        lower.includes("decisions") ||
        lower.includes("documentation") ||
        lower.includes("records"),
      "Charter should mention documentation, history, decisions, or records",
    );
  });
});

describe("Scribe — write boundary (Rule 2)", () => {
  it("Rule 2 in copilot-instructions.md declares Scribe as sole .squad/ committer", () => {
    assert.ok(
      rules.includes("only Scribe commits there") ||
        rules.includes("Scribe-owned commits"),
      "copilot-instructions.md Rule 2 should declare Scribe as sole .squad/ committer",
    );
  });

  it("Rule 2 lists .squad/ paths as Scribe-owned", () => {
    assert.ok(
      rules.includes(".squad/agents/") ||
        rules.includes(".squad/decisions/inbox/"),
      "Rule 2 should list .squad/ paths",
    );
    assert.ok(
      rules.includes(".squad/log/") || rules.includes(".squad/orchestration-log/"),
      "Rule 2 should mention .squad/log/ paths",
    );
  });
});

describe("Scribe — routing accuracy", () => {
  it("routes session logging to Scribe", () => {
    const entry = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("session logging"),
    );
    assert.ok(entry, "Routing table should have a Session logging entry");
    assert.ok(
      entry.routeTo.toLowerCase().includes("scribe"),
      "Session logging should route to Scribe",
    );
  });

  it("session logging is automatic — never needs routing", () => {
    const entry = routingEntries.find((e) =>
      e.routeTo.toLowerCase().includes("scribe"),
    );
    assert.ok(entry, "Should find a Scribe routing entry");
    assert.ok(
      entry.examples.toLowerCase().includes("automatic") ||
        entry.examples.toLowerCase().includes("never needs routing"),
      "Scribe routing should be automatic",
    );
  });
});

describe("Scribe — boundary declarations", () => {
  it("Scribe is NOT routed for implementation, reviews, or architecture", () => {
    for (const entry of routingEntries) {
      if (
        entry.workType.toLowerCase().includes("typescript") ||
        entry.workType.toLowerCase().includes("code review") ||
        entry.workType.toLowerCase().includes("technical architecture")
      ) {
        assert.ok(
          !entry.routeTo.toLowerCase().includes("scribe"),
          `"${entry.workType}" should NOT route to Scribe`,
        );
      }
    }
  });
});

describe("Scribe — team roster", () => {
  it("Scribe appears in team.md as Session Logger", () => {
    assert.ok(
      teamMd.includes("Scribe"),
      "team.md should list Scribe",
    );
    assert.ok(
      teamMd.toLowerCase().includes("session logger"),
      "team.md should identify Scribe as Session Logger",
    );
  });

  it("Scribe has a charter path in team.md", () => {
    assert.ok(
      teamMd.includes(".squad/agents/scribe/charter.md"),
      "team.md should reference Scribe's charter path",
    );
  });
});

describe("Scribe — routing rules", () => {
  it("Rule 2 in routing says Scribe always runs after substantial work", () => {
    assert.ok(
      routing.includes("Scribe always runs"),
      'Routing should say "Scribe always runs"',
    );
  });

  it("Scribe runs as background mode and never blocks", () => {
    assert.ok(
      routing.includes('mode: "background"'),
      "Routing should specify Scribe runs in background mode",
    );
    assert.ok(
      routing.includes("Never blocks"),
      'Routing should say Scribe "Never blocks"',
    );
  });
});
