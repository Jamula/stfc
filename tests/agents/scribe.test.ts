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
  const searchStart = Math.max(write, 0);
  const verifyMatch = /Re-read `decisions(?:\/decisions)?\.md`/.exec(text.slice(searchStart));
  const verify = verifyMatch ? searchStart + verifyMatch.index : -1;
  const deletion = text.indexOf("`squad_state_delete`");
  assert.ok(write >= 0 && verify > write && deletion > verify,
    `${label}: write, re-read/verify, then delete must be ordered`);
  assert.match(text.slice(verify, deletion), /confirm every merged entry is present before/,
    `${label}: verify entry content before consuming its source`);
  assert.match(text, /leave the inbox source\s+intact and report the failure/,
    `${label}: verification failure must retain the source`);
}

const spawnTemplates = readFileSync(
  resolve(process.cwd(), ".squad/reference/spawn-templates.md"),
  "utf-8",
);
const afterAgentReference = afterAgentTemplate;
const squadCommands = readFileSync(
  resolve(process.cwd(), ".copilot/skills/squad-commands/SKILL.md"),
  "utf-8",
);
const githubSquadSkill = readFileSync(
  resolve(process.cwd(), ".github/skills/squad/SKILL.md"),
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
const coordinatorTemplate = readFileSync(
  resolve(process.cwd(), ".squad/templates/squad.agent.md.template"),
  "utf-8",
);
const reflectTemplate = readFileSync(
  resolve(process.cwd(), ".squad/templates/skills/reflect/SKILL.md"),
  "utf-8",
);
const reflectSkill = readFileSync(
  resolve(process.cwd(), ".github/skills/reflect/SKILL.md"),
  "utf-8",
);
const secretHandling = readFileSync(
  resolve(process.cwd(), ".github/skills/secret-handling/SKILL.md"),
  "utf-8",
);
const supersededPrDetection = readFileSync(
  resolve(process.cwd(), ".squad/skills/superseded-pr-detection/SKILL.md"),
  "utf-8",
);
const worktreeReference = readFileSync(
  resolve(process.cwd(), ".squad/templates/worktree-reference.md"),
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
    ["generated coordinator template", coordinatorTemplate],
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
        [
          "archive-eligible",
          "verified completion or resolution only, with 7 days hot before archive",
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
    ["generated coordinator template", coordinatorTemplate],
    ["live Scribe charter", charter],
    ["Scribe template", scribeTemplate],
    ["Scribe spawn template", spawnTemplates],
    ["after-agent reference", afterAgentReference],
    ["squad commands", squadCommands],
    ["GitHub-facing Squad skill", githubSquadSkill],
    ["scope override fanout", scopeOverrideFanout],
    ["architectural proposals", architecturalProposals],
    ["Reflect skill", reflectSkill],
    ["Reflect template", reflectTemplate],
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

describe("Scribe — decision inbox persistence", () => {
  for (const [label, text, startMarker, endMarker] of [
    [
      "Scribe spawn prompt",
      spawnTemplates,
      "2. DECISION INBOX:",
      "3. ORCHESTRATION LOG:",
    ],
    [
      // Current main narrowed the after-agent prompt: the write (step 2) and the
      // read-back/verify/delete (step 3) are separate numbered steps, with step 4
      // being REPORT (the orchestration-log step was removed). Bound the task
      // through the end of VERIFY so both halves are captured.
      "after-agent Scribe prompt",
      afterAgentReference,
      "2. DECISION INBOX:",
      "4. REPORT:",
    ],
    [
      // Current main's charter dropped the bold "Merge the decision inbox:" /
      // "Deduplicate and consolidate" substep headings in favor of a plain
      // numbered list (no orchestration-log/history-ownership step). Bound the
      // task from the inbox read through the end of the verify-then-delete step,
      // stopping before the REPORT-equivalent health-check step.
      "Scribe charter",
      scribeTemplate,
      "1. List and read `decisions/inbox/`",
      "6. Run the state health check",
    ],
  ] as const) {
    it(`${label} verifies the ledger read-back before deleting inbox sources`, () => {
      const normalized = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ");
      const inboxStart = normalized.indexOf(startMarker);
      const nextTask = normalized.indexOf(endMarker, inboxStart);
      assert.ok(
        inboxStart >= 0 && nextTask > inboxStart,
        `${label} should define a bounded decision inbox task`,
      );

      const inboxTask = normalized.slice(inboxStart, nextTask);
      const writeCall = inboxTask.indexOf("squad_state_write");
      const readBackCall = inboxTask.indexOf("squad_state_read", writeCall + 1);
      const deleteCall = inboxTask.indexOf("squad_state_delete", readBackCall + 1);

      assert.ok(
        writeCall >= 0 && readBackCall > writeCall && deleteCall > readBackCall,
        `${label} should write, read back the merged ledger, then delete inbox sources`,
      );

      // Phrasing differs across surfaces narrowed on current main: the spawn
      // template states "Verify ... before deleting" as a single clause ahead of
      // the delete call, while the after-agent prompt and charter instead gate
      // the delete on "confirm every merged entry is present before deleting"
      // and restate the entry+heading verification afterward. Both phrasings
      // enforce the same fail-closed, verify-before-delete policy.
      const beforeDeleteGate = /(?:Verify every merged entry and heading persisted before deleting|confirm every merged entry is present before\s+deleting)/i
        .exec(inboxTask);
      assert.ok(
        beforeDeleteGate && beforeDeleteGate.index < deleteCall,
        `${label} should gate deletion on a stated verify/confirm-before-delete step`,
      );
      assert.match(
        inboxTask,
        /decisions\/inbox\/?/i,
        `${label} should identify the logical inbox namespace`,
      );
      assert.match(
        inboxTask,
        /decisions\/decisions\.md/i,
        `${label} should write to the logical decision-ledger key`,
      );
      assert.match(
        inboxTask,
        /verify every merged entry and heading persisted/i,
        `${label} should verify every merged entry and heading, not entries alone`,
      );
      assert.match(
        inboxTask,
        /(?:If the write or read-back fails, or verification is incomplete, preserve every inbox source file and report failure|If verification fails, leave the inbox source intact and report the failure)/i,
        `${label} should preserve sources and report failure when persistence is unverified`,
      );
      assert.match(
        inboxTask,
        /On orphan, two-layer, or git-notes backends, do not fall back to a stale checkout snapshot\./i,
        `${label} should not read stale checkout state on governed backends`,
      );
    });
  }

  it("generated coordinator template verifies the ledger read-back before deleting inbox sources", () => {
    const normalized = coordinatorTemplate.replace(/\r\n/g, "\n");
    const inboxStart = normalized.indexOf("2. DECISION INBOX:");
    const nextTask = normalized.indexOf("3. REPORT:", inboxStart);
    assert.ok(inboxStart >= 0 && nextTask > inboxStart, "template should define the decision inbox task");

    const inboxTask = normalized.slice(inboxStart, nextTask);
    const writeCall = inboxTask.indexOf("squad_state_write");
    const readBackCall = inboxTask.indexOf("squad_state_read", writeCall + 1);
    const confirmation = inboxTask.indexOf(
      "confirm every merged entry is present",
      readBackCall + 1,
    );
    const deleteCall = inboxTask.indexOf("squad_state_delete", confirmation + 1);

    assert.ok(
      writeCall >= 0 &&
        readBackCall > writeCall &&
        confirmation > readBackCall &&
        deleteCall > confirmation,
      "the task should write, read back and confirm every merged entry is present, then delete",
    );
    assert.ok(
      inboxTask.includes("verify every merged entry and heading persisted"),
      "the task should verify every merged entry and heading, not just entries, before the source is consumed",
    );
    assert.ok(
      inboxTask.includes(
        "preserve every inbox source file until that verification completes",
      ),
      "the task should preserve inbox sources until persistence is verified",
    );
    assert.ok(
      inboxTask.includes(
        "If verification fails, leave the inbox source intact and report the failure",
      ),
      "the task should preserve inbox sources and report failure when persistence is not verified",
    );
    assert.ok(
      inboxTask.includes(
        "on orphan, two-layer, or git-notes backends, do not fall back to a stale checkout snapshot.",
      ),
      "the task should not use stale checkout snapshots on governed backends",
    );
    assert.match(
      inboxTask,
      /DEMOTE its headings so its shallowest heading lands at `####`/,
      "the task should demote inbox headings before merging them below an entry",
    );
    assert.match(
      inboxTask,
      /Preserve relative structure\. Never emit an `##` under an `###`/,
      "the task should preserve heading structure without creating invalid heading levels",
    );
  });
});

describe("GitHub-facing Squad — decision archive eligibility", () => {
  it("includes the semantic taxonomy and dry-run/user-review safeguards", () => {
    const normalized = githubSquadSkill.replace(/\s+/g, " ");
    const archiveStart = normalized.indexOf("### Archive Old Decisions");
    const nextCommand = normalized.indexOf("### Summarize Agent History", archiveStart);
    assert.ok(
      archiveStart >= 0 && nextCommand > archiveStart,
      "GitHub-facing Squad skill should define a bounded archive command",
    );
    const archiveCommand = normalized.slice(archiveStart, nextCommand);

    assert.match(
      archiveCommand,
      /Treat `decisions\/decisions\.md` as the logical source key/,
      "archive command should identify the logical decision-ledger key",
    );
    assert.match(
      archiveCommand,
      /`squad_state_read` for key `decisions\/decisions\.md`/,
      "archive command should read the logical decision-ledger key",
    );
    assert.match(
      archiveCommand,
      /write key `decisions\/decisions\.md` with `squad_state_write`/,
      "archive command should write the logical decision-ledger key",
    );
    assert.match(
      archiveCommand,
      /At archive-decision time, verify linked GitHub issue\/PR status for `current-epic` and `archive-eligible` entries/i,
      "archive command should verify live GitHub status for current epics and archive-eligible entries",
    );
    assert.match(
      archiveCommand,
      /if status cannot be confirmed, retain the entry/i,
      "archive command should retain entries whose status cannot be confirmed",
    );
    assert.match(
      archiveCommand,
      /Size and age thresholds trigger eligibility review only, never archival by themselves/i,
      "size and age should trigger review, not automatic archival",
    );
    for (const [semanticClass, retention] of [
      ["constitutional", "hot forever"],
      ["standing-rule", "hot forever"],
      ["active-blocker", "hot until closed"],
      ["unresolved-followup", "hot until closed"],
      ["canonical-pattern", "hot forever"],
      ["current-epic", "hot until the epic closes"],
      [
        "operational-learning",
        "hot until a similar pattern recurs at least 3 times or 90 days pass without recurrence",
      ],
      [
        "archive-eligible",
        "verified completion or resolution only, with 7 days hot before archive",
      ],
    ] as const) {
      assert.ok(
        archiveCommand.includes(`\`${semanticClass}\` = ${retention}`),
        `archive command should preserve ${semanticClass} retention`,
      );
    }
    assert.match(
      archiveCommand,
      /dry-run classification against the live ledger.{0,300}durable tagging convention.{0,150}10.?15 entries.{0,150}future-inbox behavior/i,
      "bulk tagging should require a documented dry-run against the live ledger",
    );
    assert.match(
      archiveCommand,
      /Require user review of the artifact before bulk-tagging/i,
      "bulk tagging should wait for user review",
    );
    assert.match(
      archiveCommand,
      /until then, leave untagged entries unchanged and active/i,
      "untagged entries should remain active pending review",
    );
    assert.match(
      archiveCommand,
      /If archive append or verification cannot be safely completed.{0,100}fail closed and leave the source intact/i,
      "failed verification should preserve the source",
    );
    assert.match(
      archiveCommand,
      /For local\/worktree, append verified eligible entries.{0,150}only then trim/i,
      "local/worktree archives should be verified before trimming",
    );
    assert.match(
      archiveCommand,
      /For orphan, two-layer, or git-notes backends.{0,300}Never read or edit a stale checkout copy/i,
      "governed backends should use state tools rather than checkout snapshots",
    );
  });
});

describe("Scribe — generated coordinator archive safeguards", () => {
  it("requires tracked destinations, verified append-first moves, measured gates, and safe failures", () => {
    const normalized = coordinatorTemplate.replace(/\s+/g, " ");
    for (const safeguard of [
      /DESTINATION MUST BE TRACKED/,
      /git ls-files --error-unmatch <destination>/,
      /Moving content into an untracked destination is a DELETION/,
      /APPEND FIRST, VERIFY, THEN DELETE/,
      /every moved heading is literally present/,
      /entry count grew by exactly the number moved/,
      /If the append cannot be verified, DO NOT trim — leave the source intact/,
      /COUNT ENTRIES, NOT BYTES/,
      /File size is not a valid integrity signal/,
      /NEVER REPORT A GATE OUTCOME YOU DID NOT MEASURE/,
      /"No archival required" must come from an actual measurement/,
      /If a state tool cannot perform these checks, STOP and report/,
    ]) {
      assert.match(
        normalized,
        safeguard,
        `generated coordinator template should preserve ${safeguard}`,
      );
    }
  });
});

describe("Reflect — decision state key", () => {
  for (const [label, text] of [
    ["active Reflect skill", reflectSkill],
    ["Reflect template", reflectTemplate],
  ] as const) {
    it(`${label} uses the logical ledger key and namespace with Coordinator ownership`, () => {
      const normalized = text.replace(/\r\n/g, "\n");
      assert.match(
        normalized,
        /Logical state key `decisions\/decisions\.md`/,
        `${label} should identify the logical decision-ledger key`,
      );
      assert.match(
        normalized,
        /logical namespace `decisions\/inbox\/`/i,
        `${label} should identify the logical decision-inbox namespace`,
      );

      const withoutValidKeys = normalized
        .replace(/\.squad\/decisions\/decisions\.md/g, "")
        .replace(/decisions\/decisions\.md/g, "");
      assert.doesNotMatch(
        withoutValidKeys,
        /\bdecisions?\.md\b/i,
        `${label} should not use a bare decision-ledger filename`,
      );

      const physicalInboxReferences = normalized
        .split("\n")
        .filter((line) => line.includes(".squad/decisions/inbox/"));
      assert.ok(
        physicalInboxReferences.length > 0 &&
          physicalInboxReferences.every((line) =>
            /local\/worktree fallback/i.test(line),
          ),
        `${label} should limit physical inbox paths to local/worktree fallback`,
      );
      assert.match(
        normalized,
        /On orphan, two-layer, or git-notes backends, stop and report a missing bridge/i,
        `${label} should fail closed when a governed state bridge is unavailable`,
      );

      const teamDecisionStart = normalized.indexOf("**For Team Decisions:**");
      const skillsStart = normalized.indexOf(
        "3. **For Skills:**",
        teamDecisionStart,
      );
      assert.ok(
        teamDecisionStart >= 0 && skillsStart > teamDecisionStart,
        `${label} should define a bounded team-decision persistence step`,
      );
      const teamDecisionStep = normalized.slice(teamDecisionStart, skillsStart);
      assert.match(
        teamDecisionStep,
        /squad_state_write/i,
        `${label} should persist team decisions through state tools`,
      );
      assert.match(
        teamDecisionStep,
        /logical namespace `decisions\/inbox\/`/i,
        `${label} should target the logical inbox namespace`,
      );
      assert.match(
        teamDecisionStep,
        /Squad Coordinator/i,
        `${label} should route decision review and recording to the Coordinator`,
      );
      assert.match(
        teamDecisionStep,
        /decisions\/decisions\.md/i,
        `${label} should identify the logical ledger key`,
      );
      assert.doesNotMatch(
        teamDecisionStep,
        /\blead\b/i,
        `${label} should not assign accepted-decision review to a generic Lead`,
      );
    });
  }
});

describe("Scribe — mutable-state persistence guidance", () => {
  for (const [label, text] of [
    ["live coordinator prompt", squadAgent],
    ["active Scribe charter", charter],
    ["Scribe template", scribeTemplate],
    ["Scribe spawn template", spawnTemplates],
    ["after-agent Scribe prompt", afterAgentReference],
    ["secret-handling skill", secretHandling],
    ["superseded-PR skill", supersededPrDetection],
    ["worktree reference", worktreeReference],
  ] as const) {
    it(`${label} does not direct Scribe to commit mutable state`, () => {
      const normalized = text.replace(/\r\n/g, "\n");
      assert.match(
        normalized,
        /configured (?:state )?backend|runtime state tools own persistence/i,
        `${label} should identify the configured persistence mechanism`,
      );
      assert.doesNotMatch(
        normalized,
        /git add \.squad\/|Scribe auto-commits|Scribe commits \.squad|normal Scribe commit|Scribe merge-and-commit/i,
        `${label} should not require Scribe to stage or commit mutable state`,
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
