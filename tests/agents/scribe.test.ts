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
const afterAgentTemplate = readFileSync(
  resolve(process.cwd(), ".squad/templates/after-agent-reference.md"),
  "utf-8",
);
const inlineScribePrompts = [
  ["live coordinator", ".github/agents/squad.agent.md"],
  ["coordinator template", ".squad/templates/squad.agent.md.template"],
].map(([label, path]) => {
  const text = readFileSync(resolve(process.cwd(), path!), "utf-8");
  const section = text.replace(/\r\n/g, "\n").match(
    /\*\*Scribe Spawn Template\*\*[\s\S]*?\n```\n[\s\S]*?\n```/,
  )?.[0];
  assert.ok(section, `${label} should contain the inline Scribe prompt`);
  return [label!, section] as const;
});
const spawnReference = readFileSync(
  resolve(process.cwd(), ".squad/templates/spawn-reference.md"), "utf-8",
);
const sourceOfTruth = readFileSync(
  resolve(process.cwd(), ".github/skills/coordinator-source-of-truth/SKILL.md"), "utf-8",
);
const decisionSurfaces = [
  ...inlineScribePrompts,
  ["after-agent reference", afterAgentTemplate],
  ["live charter", charter],
  ["charter template", scribeTemplate],
] as const;

function assertSafeDecisionMerge(text: string, label: string): void {
  const write = text.indexOf("`squad_state_write`");
  const verify = text.indexOf("Re-read `decisions.md`", write);
  const deletion = text.indexOf("`squad_state_delete`");
  assert.ok(write >= 0 && verify > write && deletion > verify,
    `${label}: write, re-read/verify, then delete must be ordered`);
  assert.match(text.slice(verify, deletion), /confirm every merged entry is present before/,
    `${label}: verify entry content before consuming its source`);
  assert.match(text, /leave the inbox source\s+intact and report the failure/,
    `${label}: verification failure must retain the source`);
}

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
    ["Scribe template", scribeTemplate],
  ] as const) {
    it(`${label} treats age thresholds as review triggers and retains unresolved entries`, () => {
      const normalized = text.replace(/\s+/g, " ");

      assert.match(
        normalized,
        /(?:review triggers, not automatic archival eligibility|use ledger size only to trigger eligibility review)/,
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
        "open/unresolved",
        "active blockers",
        "open linked issues",
        "unverifiable status",
        "active ledger",
      ]) {
        assert.ok(
          normalized.includes(requiredGuidance),
          `${label} should keep ${requiredGuidance} entries active`,
        );
      }
      assert.match(
        normalized,
        /Archive only entries verified complete or resolved/,
        `${label} should archive only verified complete or resolved entries`,
      );
      assert.match(
        normalized,
        /status cannot be confirmed/,
        `${label} should retain entries whose status cannot be verified`,
      );
    });
  }
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
  it("routes durable decision merging to Scribe", () => {
    const entry = routingEntries.find((e) =>
      e.workType.toLowerCase().includes("durable decision merging"),
    );
    assert.ok(entry, "Routing table should have a durable decision merging entry");
    assert.ok(
      entry.routeTo.toLowerCase().includes("scribe"),
      "Durable decision merging should route to Scribe",
    );
  });

  it("activation requires accepted durable decisions", () => {
    const entry = routingEntries.find((e) =>
      e.routeTo.toLowerCase().includes("scribe"),
    );
    assert.ok(entry, "Should find a Scribe routing entry");
    assert.ok(
      entry.examples.includes("Only when accepted durable decisions require merging"),
      "Scribe routing should require accepted durable decisions",
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
  it("Scribe appears in team.md as Decision Merger", () => {
    assert.ok(
      teamMd.includes("Scribe"),
      "team.md should list Scribe",
    );
    assert.ok(
      teamMd.toLowerCase().includes("decision merger"),
      "team.md should identify Scribe as Decision Merger",
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
  it("Rule 2 limits Scribe activation to accepted durable decisions", () => {
    assert.ok(
      routing.includes("Scribe runs only when accepted durable decisions require merging"),
      "Routing should limit activation to accepted durable decisions",
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

describe("Scribe - production decision contracts", () => {
  for (const [label, text] of decisionSurfaces) {
    it(`${label} limits activation and work to accepted durable decisions`, () => {
      assert.match(text, /only when accepted durable decisions require merging/i);
      assert.match(text, /[Mm]erge only accepted, current durable decisions/);
      assert.match(text, /[Dd]eduplicate exact duplicate decision headings/);
      assert.match(text, /[Pp]reserv(?:e|ing) relative\s+(?:structure|hierarchy) and fenced code blocks/);
      assert.match(text, /in plain text only/);
      assertSafeDecisionMerge(text, label);
    });

    it(`${label} rejects delete-before-verify regressions`, () => {
      assert.ok(text.includes("`squad_state_write`"), `${label}: mutation target must exist`);
      const mutated = text.replace("`squad_state_write`",
        "`squad_state_write`, delete processed inbox entries with `squad_state_delete`");
      assert.throws(() => assertSafeDecisionMerge(mutated, label),
        /write, re-read\/verify, then delete must be ordered/);
    });

    it(`${label} does not assign logging, history, archival, or health-report writes`, () => {
      assert.doesNotMatch(text, /(?:ORCHESTRATION LOG|SESSION LOG|CROSS-AGENT|HISTORY SUMMARIZATION|DECISIONS ARCHIVE|HEALTH REPORT):/);
      assert.doesNotMatch(text, /squad_state_(?:write|append)[^\n]*(?:orchestration-log|history\.md|log\/)/);
      assert.match(text, /(?:Do not write orchestration logs|does not create specialist histories)/);
      assert.match(text, /(?:Do not write health reports to state|health reports to state)/);
    });
  }

  it("generic spawn reference excludes Scribe from history and cleanup duties", () => {
    assert.match(spawnReference, /Scribe exception:[\s\S]*decision-only Scribe prompt in `after-agent-reference.md`/);
    assert.match(spawnReference, /Do not assign Scribe history appends, skill extraction/);
    assert.match(spawnReference, /squad_state_delete` only after Scribe writes the merged decision, re-reads `decisions.md`, and verifies/);
    assert.doesNotMatch(spawnReference, /Scribe handles (?:it|cleanup)|SKILL EXTRACTION is handled by Scribe/);
  });

  it("source-of-truth rules preserve existing snapshot records without creating new ones", () => {
    assert.match(sourceOfTruth, /Snapshot reconciliation may preserve existing append-only histories and logs/);
    assert.match(sourceOfTruth, /must not manufacture new records/);
    assert.match(sourceOfTruth, /verifies the persisted merge before deleting inbox sources/);
    assert.doesNotMatch(sourceOfTruth, /Do not create or preserve specialist histories/);
  });
});
