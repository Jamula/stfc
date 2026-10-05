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
const scribeTemplate = readFileSync(
  resolve(process.cwd(), ".squad/templates/scribe-charter.md"),
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

describe("Scribe — decision consolidation", () => {
  it("copilot-instructions.md delegates shared decision updates to Scribe", () => {
    assert.ok(
      rules.includes("The Scribe will merge it into the shared decisions file"),
      "copilot-instructions.md should delegate shared decision updates to Scribe",
    );
  });

  it("directs agent decisions to the decision inbox", () => {
    assert.ok(
      rules.includes(".squad/decisions/inbox/"),
      "copilot-instructions.md should list the decision inbox",
    );
  });
});

describe("Scribe — worktree snapshot ingestion", () => {
  for (const [label, text] of [
    ["live charter", charter],
    ["template", scribeTemplate],
  ] as const) {
    it(`${label} scopes snapshot cleanup to verified local/worktree persistence`, () => {
      const normalized = text.replace(/\s+/g, " ");
      assert.ok(
        normalized.includes(".squad/worktree-inbox/<id>/"),
        `${label} should identify the worktree snapshot inbox`,
      );
      assert.ok(
        normalized.includes("manifest.json") && normalized.includes("head_sha"),
        `${label} should use the snapshot manifest to identify its base`,
      );
      assert.ok(
        normalized.includes("for local/worktree backends only"),
        `${label} should limit checkout snapshot handling to local/worktree backends`,
      );
      assert.ok(
        normalized.includes(
          "On orphan, two-layer, or git-notes backends, do not inspect or mutate checkout snapshots",
        ),
        `${label} should keep governed backends away from checkout snapshots`,
      );
      assert.ok(
        normalized.includes(
          "Persist canonical changes through the configured backend, then re-read or diff every result.",
        ) &&
          normalized.includes(
            "Delete only the specific local/worktree snapshot directory after all changes are persisted and verified; do not commit mutable state.",
          ),
        `${label} should delete only after backend persistence and verification, without committing mutable state`,
      );
    });
  }
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
