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
const spawnTemplates = readFileSync(
  resolve(process.cwd(), ".squad/reference/spawn-templates.md"),
  "utf-8",
);
const afterAgentReference = readFileSync(
  resolve(process.cwd(), ".squad/templates/after-agent-reference.md"),
  "utf-8",
);
const squadCommands = readFileSync(
  resolve(process.cwd(), ".copilot/skills/squad-commands/SKILL.md"),
  "utf-8",
);
const scopeOverrideFanout = readFileSync(
  resolve(process.cwd(), ".copilot/skills/scope-override-fanout/SKILL.md"),
  "utf-8",
);
const architecturalProposals = readFileSync(
  resolve(
    process.cwd(),
    ".squad/templates/skills/architectural-proposals/SKILL.md",
  ),
  "utf-8",
);
const squadAgent = readFileSync(
  resolve(process.cwd(), ".github/agents/squad.agent.md"),
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

describe("Scribe — decision archive eligibility", () => {
  for (const [label, text] of [
    ["active coordinator", squadAgent],
    ["live Scribe charter", charter],
    ["Scribe template", scribeTemplate],
    ["Scribe spawn template", spawnTemplates],
    ["after-agent reference", afterAgentReference],
  ] as const) {
    it(`${label} treats age thresholds as review triggers and retains unresolved entries`, () => {
      const normalized = text.replace(/\s+/g, " ");

      assert.match(
        normalized,
        /(?:thresholds trigger eligibility review only|use ledger size only to trigger eligibility review)/i,
        `${label} should use age thresholds only to trigger archival review`,
      );
      assert.match(
        normalized,
        /review entries older than 30 days/,
        `${label} should review, not automatically archive, 30-day-old entries`,
      );
      assert.match(
        normalized,
        /review entries older than 7 days/,
        `${label} should review, not automatically archive, 7-day-old entries`,
      );
      assert.doesNotMatch(
        normalized,
        /archive entries older than (?:30|7) days/i,
        `${label} should not make age alone sufficient for archival`,
      );

      for (const requiredGuidance of [
        "Keep open, unresolved, or unverifiable entries in the active ledger",
        "current-epic",
        "active-blocker",
      ]) {
        assert.ok(
          normalized.includes(requiredGuidance),
          `${label} should preserve ${requiredGuidance} retention guidance`,
        );
      }
      assert.match(
        normalized,
        /archive-eligible`?\s*=\s*verified completion or resolution only.{0,80}7 days hot before archive/i,
        `${label} should require verified status and a 7-day hot period`,
      );
      assert.match(
        normalized,
        /dry-run classification against the live ledger/,
        `${label} should require a live-ledger dry-run before bulk tagging`,
      );
      assert.match(
        normalized,
        /durable tagging convention.{0,120}10.?15 entries.{0,120}future-inbox behavior/i,
        `${label} should require the planned dry-run output`,
      );
      assert.match(
        normalized,
        /user review.{0,80}before bulk tagging/i,
        `${label} should require user review before bulk tagging`,
      );
      assert.match(
        normalized,
        /until review, leave untagged entries unchanged and active/i,
        `${label} should retain untagged entries until review`,
      );

      for (const [semanticClass, retention] of [
        ["constitutional", "hot forever"],
        ["standing-rule", "hot forever"],
        ["active-blocker", "hot until closed"],
        ["unresolved-followup", "hot until closed"],
        ["canonical-pattern", "hot forever"],
        ["current-epic", "hot until epic closes"],
        [
          "operational-learning",
          "hot until a similar pattern recurs at least 3 times or 90 days pass without recurrence",
        ],
      ] as const) {
        assert.ok(
          normalized.includes(`\`${semanticClass}\` = ${retention}`),
          `${label} should preserve ${semanticClass} retention`,
        );
      }
    });
  }
});

describe("Scribe — decision state keys", () => {
  const operationalGuidance = [
    ["active coordinator", squadAgent],
    ["live Scribe charter", charter],
    ["Scribe template", scribeTemplate],
    ["Scribe spawn template", spawnTemplates],
    ["after-agent reference", afterAgentReference],
    ["squad commands", squadCommands],
    ["scope override fanout", scopeOverrideFanout],
    ["architectural proposals", architecturalProposals],
  ] as const;

  it("uses decisions/decisions.md as the logical decision-ledger key", () => {
    for (const [label, text] of operationalGuidance) {
      const normalized = text.replace(/\r\n/g, "\n");
      assert.match(
        normalized,
        /decisions\/decisions\.md/,
        `${label} should identify the logical decision-ledger key`,
      );

      for (const line of normalized.split("\n")) {
        if (line.includes("squad_state_") && /decision|decisions\.md/i.test(line)) {
          assert.doesNotMatch(
            line,
            /(?<![/\\])decisions\.md\b/,
            `${label} should not pass the bare decisions.md key to state tools`,
          );
        }
      }
    }
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
