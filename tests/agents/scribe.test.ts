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
const secretHandlingTemplate = readFileSync(
  resolve(process.cwd(), ".squad/templates/skills/secret-handling/SKILL.md"),
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
const gitWorkflowSkill = readFileSync(
  resolve(process.cwd(), ".github/skills/git-workflow/SKILL.md"),
  "utf-8",
);
const gitWorkflowTemplate = readFileSync(
  resolve(process.cwd(), ".squad/templates/skills/git-workflow/SKILL.md"),
  "utf-8",
);
const crossSquadCommunication = readFileSync(
  resolve(
    process.cwd(),
    ".github/skills/cross-squad-communication/SKILL.md",
  ),
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

describe("Scribe — semantic classification state path", () => {
  for (const [label, text] of [
    ["active coordinator prompt", squadAgent],
    ["generated coordinator template", coordinatorTemplate],
    ["active Scribe charter", charter],
    ["Scribe charter template", scribeTemplate],
    ["Scribe spawn template", spawnTemplates],
    ["after-agent Scribe prompt", afterAgentReference],
    ["Squad command skill", squadCommands],
    ["GitHub-facing Squad skill", githubSquadSkill],
  ] as const) {
    it(`${label} writes and verifies the review artifact through logical log state`, () => {
      const normalized = text.replace(/\r\n/g, "\n");
      const artifactGuidance = normalized
        .split("\n")
        .find((line) => line.includes("decisions-classification-sample.md"));
      assert.ok(
        artifactGuidance,
        `${label} should define the classification artifact destination`,
      );

      assert.match(
        artifactGuidance,
        /logical state key `log\/\{timestamp\}-decisions-classification-sample\.md`/,
        `${label} should target the logical log key`,
      );
      assert.match(
        artifactGuidance,
        /with `squad_state_write`/,
        `${label} should persist the artifact through the state backend`,
      );
      assert.match(
        artifactGuidance,
        /Re-read that key with `squad_state_read` and verify the artifact/,
        `${label} should verify the artifact through the state backend`,
      );
      assert.match(
        artifactGuidance,
        /physical `\.squad\/log\/\{timestamp\}-decisions-classification-sample\.md` only as a local\/worktree fallback/,
        `${label} should limit the physical log path to local/worktree fallback`,
      );
      assert.match(
        artifactGuidance,
        /On orphan, two-layer, or git-notes backends, do not create or use a checkout path; if the bridge is unavailable, stop and report it/,
        `${label} should fail closed instead of using governed-backend checkout paths`,
      );
      assert.match(
        artifactGuidance,
        /If the write or read-back fails, preserve the source ledger, do not bulk-tag, and report failure/,
        `${label} should preserve source data and report failed persistence`,
      );
    });
  }
});

describe("Agent history — logical state paths", () => {
  for (const [label, text, hasPathSpecificFallback] of [
    ["active coordinator prompt", squadAgent, true],
    ["generated coordinator template", coordinatorTemplate, true],
    ["active Scribe charter", charter, false],
    ["Scribe charter template", scribeTemplate, true],
    ["active Reflect skill", reflectSkill, true],
    ["Reflect template", reflectTemplate, true],
  ] as const) {
    it(`${label} routes agent histories through logical state`, () => {
      const normalized = text.replace(/\r\n/g, "\n");
      const collapsed = normalized.replace(/\s+/g, " ");
      assert.match(
        collapsed,
        /agents\/(?:\{agent\}|\*)\/history\.md/,
        `${label} should name the logical agent-history key`,
      );
      assert.match(
        collapsed,
        /squad_state_append|through the configured backend/,
        `${label} should route agent-history writes through state tools`,
      );
      assert.match(
        normalized,
        /On orphan, two-layer, or git-notes backends/,
        `${label} should define governed-backend behavior`,
      );

      if (hasPathSpecificFallback) {
        const physicalHistoryReferences = normalized
          .split("\n")
          .filter((line) =>
            line.includes(".squad/agents/{agent}/history.md"),
          );
        assert.ok(
          physicalHistoryReferences.length > 0 &&
            physicalHistoryReferences.every((line) =>
              /local\/worktree(?:-only| physical)? fallback|for `local`\/`worktree`/i.test(line),
            ),
          `${label} should limit physical history paths to local/worktree fallback`,
        );
        assert.match(
          normalized,
          /If the write or read-back fails, preserve the source (?:update|learning) and report failure/,
          `${label} should preserve source learnings and report persistence failures`,
        );
      } else {
        assert.match(
          collapsed,
          /Filesystem fallback for mutable state is permitted only for local\/worktree backends/,
          `${label} should limit filesystem fallback to local/worktree`,
        );
      }
    });
  }
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

describe("Scribe — backend-aware identity/history reads share the fallback rule", () => {
  it("spawn-reference.md gates history.md and decisions.md behind the local/worktree-only fallback and nonlocal fail-closed rule", () => {
    const normalized = spawnReference.replace(/\s+/g, " ");
    const fallbackClause =
      /only for `local`\/`worktree` backends; for `orphan`, `two-layer`, or `git-notes`, follow the state-backend handshake and report a missing bridge/i;

    for (const [label, anchor] of [
      ["agents/{name}/history.md", "Read logical key `agents/{name}/history.md` with `squad_state_read`"],
      ["decisions/decisions.md", "Read logical state key `decisions/decisions.md` with `squad_state_read`"],
    ] as const) {
      const start = normalized.indexOf(anchor);
      assert.ok(start >= 0, `spawn-reference.md should resolve ${label} through state tools`);
      const window = normalized.slice(start, start + 400);
      assert.match(
        window,
        fallbackClause,
        `spawn-reference.md's ${label} read should share the local/worktree-only fallback and nonlocal fail-closed rule`,
      );
    }
  });

  it("treats absent optional identity keys differently from state-tool failures", () => {
    const normalized = spawnReference.replace(/\s+/g, " ");

    assert.match(
      normalized,
      /optional identity context `identity\/wisdom\.md` and `identity\/now\.md` is not required/i,
    );
    assert.match(
      normalized,
      /runtime's specific response `State key not found: <logical-key>` for either key is ordinary absence; continue without that context/i,
    );
    assert.match(
      normalized,
      /for `local`\/`worktree`, when state tools are unavailable or return that key-not-found response, read the physical file only if it exists; if it does not, continue without context/i,
    );
    assert.match(
      normalized,
      /any other state-tool read error must be surfaced, not treated as absence/i,
    );
    assert.match(
      normalized,
      /for `orphan`, `two-layer`, or `git-notes`, a missing state tool\/bridge or any other read error is a failure; fail closed and never read a checkout copy/i,
    );
  });

  it("active and generated coordinator prompts resolve optional current focus through the configured backend", () => {
    for (const [label, text] of [
      ["active coordinator", squadAgent],
      ["generated coordinator template", coordinatorTemplate],
    ] as const) {
      const normalized = text.replace(/\s+/g, " ");

      assert.match(
        normalized,
        /resolve optional current-focus context only after resolving the configured `STATE_BACKEND` and completing any required state-backend handshake/i,
        `${label} should not read identity state before backend resolution`,
      );
      assert.match(
        normalized,
        /runtime's specific response `State key not found: identity\/now\.md` is normal optional-key absence; continue without current-focus context/i,
        `${label} should treat an absent optional key as normal`,
      );
      assert.match(
        normalized,
        /for `local`\/`worktree`, use state tools when available; if they are unavailable or return that key-not-found response, read `.squad\/identity\/now\.md` only if the file exists/i,
        `${label} should limit physical identity reads to the local/worktree fallback`,
      );
      assert.match(
        normalized,
        /for `orphan`, `two-layer`, or `git-notes`, a missing state tool\/bridge or any other read error is a failure; fail closed and never read or write a checkout copy/i,
        `${label} should fail closed for nonlocal bridge/read failures`,
      );
      assert.match(
        normalized,
        /update logical key `identity\/now\.md` with `squad_state_write`/,
        `${label} should write focus through the logical state key`,
      );
      assert.doesNotMatch(
        normalized,
        /Check `.squad\/identity\/now\.md` if it exists/,
        `${label} should not instruct unconditional checkout reads`,
      );
    }
  });

  it("cross-squad-communication.md resolves peer identity/now.md and identity/wisdom.md through state tools, with no unconditional direct checkout read", () => {
    const normalized = crossSquadCommunication.replace(/\s+/g, " ");

    assert.match(
      normalized,
      /use Pattern 0 to ask the peer coordinator to resolve logical state keys `identity\/now\.md` and `identity\/wisdom\.md`/i,
      "cross-squad-communication.md should resolve peer identity/now.md and identity/wisdom.md through the peer's state tools",
    );
    assert.match(
      normalized,
      /Reading `\.squad\/identity\/now\.md` directly is only valid when the peer is confirmed on the `local`\/`worktree` backend; never read it as a checkout snapshot for `orphan`, `two-layer`, or `git-notes` backends/i,
      "cross-squad-communication.md should gate any direct identity/now.md read to a confirmed local/worktree peer",
    );
    assert.match(
      normalized,
      /if the peer's backend is unknown or unreachable, fail closed and report the missing bridge/i,
      "cross-squad-communication.md should fail closed when the peer's backend cannot be confirmed",
    );

    // No unconditional direct checkout read of peer decisions/decisions.md anywhere in the skill.
    assert.doesNotMatch(
      crossSquadCommunication,
      /Get-Content\s+"[^"]*decisions[^"]*"/i,
      "cross-squad-communication.md should never read a peer's decisions ledger via a direct checkout read",
    );
  });
});

describe("Squad command skill — parity with GitHub-facing Squad skill", () => {
  it("retains the same size thresholds, link-status fail-closed rule, and untagged-entry/user-review gate", () => {
    const normalized = squadCommands.replace(/\s+/g, " ");
    const archiveStart = normalized.indexOf("### Archive Old Decisions");
    const nextCommand = normalized.indexOf("### Summarize Agent History", archiveStart);
    assert.ok(
      archiveStart >= 0 && nextCommand > archiveStart,
      "Squad command skill should define a bounded archive command",
    );
    const archiveCommand = normalized.slice(archiveStart, nextCommand);

    assert.match(
      archiveCommand,
      /If the ledger is at least 20,480 bytes, review entries older than 30 days/i,
      "archive command should preserve the 20,480-byte / 30-day review threshold",
    );
    assert.match(
      archiveCommand,
      /if it is at least 51,200 bytes, review entries older than 7 days/i,
      "archive command should preserve the 51,200-byte / 7-day review threshold",
    );
    assert.match(
      archiveCommand,
      /if status cannot be confirmed, retain the entry/i,
      "archive command should fail closed and retain entries whose linked GitHub status cannot be confirmed",
    );
    assert.match(
      archiveCommand,
      /Until then, leave untagged entries unchanged and active and never infer archive eligibility from age alone/i,
      "archive command should gate untagged entries on user review before any age-based inference",
    );
  });

  it("uses the same tracked archive append-and-verify contract on both command surfaces", () => {
    const archiveDestinationContract =
      "For every backend, append eligible entries to the already tracked `.squad/decisions-archive.md` with normal repository file operations, not mutable-state tools. Before appending, verify the destination with `git ls-files --error-unmatch .squad/decisions-archive.md`. Re-read the archive and confirm every moved heading is literally present and its entry count grew by exactly the number moved. Only after those checks pass may the active source be trimmed.";
    for (const [label, text] of [
      ["legacy Squad command skill", squadCommands],
      ["GitHub-facing Squad skill", githubSquadSkill],
    ] as const) {
      const normalized = text.replace(/\s+/g, " ");
      const archiveStart = normalized.indexOf("### Archive Old Decisions");
      const nextCommand = normalized.indexOf("### Summarize Agent History", archiveStart);
      assert.ok(
        archiveStart >= 0 && nextCommand > archiveStart,
        `${label} should define a bounded archive command`,
      );
      const archiveCommand = normalized.slice(archiveStart, nextCommand);

      assert.ok(
        archiveCommand.includes(archiveDestinationContract),
        `${label} should append to the tracked archive and verify its readback and entry count before trimming`,
      );
      assert.match(
        archiveCommand,
        /For local\/worktree, use state tools for active-ledger reads and writes when available; if unavailable, the physical active ledger is a permitted fallback/i,
        `${label} should preserve the local/worktree file fallback`,
      );
      assert.match(
        archiveCommand,
        /For orphan, two-layer, or git-notes, read the active ledger with `squad_state_read` for `decisions\/decisions\.md`/,
        `${label} should read the nonlocal source through state tools`,
      );
      assert.match(
        archiveCommand,
        /write the trimmed ledger to logical key `decisions\/decisions\.md` with `squad_state_write`, then read it back with `squad_state_read` to verify the trim/i,
        `${label} should write and verify the trimmed nonlocal ledger through state tools`,
      );
      assert.match(
        archiveCommand,
        /Keep open, unresolved, or unverifiable entries active/i,
        `${label} should retain unresolved or unverifiable entries`,
      );
      assert.match(
        archiveCommand,
        /if status cannot be confirmed, retain the entry/i,
        `${label} should retain entries with unverified linked status`,
      );
      assert.match(
        archiveCommand,
        /If archive tracking, append\/readback, or entry-count verification fails, leave the active source intact and report the failure/i,
        `${label} should preserve the source when the archive cannot be verified`,
      );
      assert.doesNotMatch(
        archiveCommand,
        /append and verify the archive using the configured backend's governing state tools/i,
        `${label} should not route durable archive appends through mutable state tools`,
      );

      const sourceReadIndex = archiveCommand.indexOf(
        "For orphan, two-layer, or git-notes, read the active ledger",
      );
      const appendIndex = archiveCommand.indexOf(
        "For every backend, append eligible entries",
      );
      const trimGateIndex = archiveCommand.indexOf(
        "Only after those checks pass may the active source be trimmed",
      );
      const stateWriteIndex = archiveCommand.indexOf(
        "For orphan, two-layer, or git-notes, write the trimmed ledger",
      );
      assert.ok(
        sourceReadIndex >= 0 &&
          sourceReadIndex < appendIndex &&
          appendIndex < trimGateIndex &&
          trimGateIndex < stateWriteIndex,
        `${label} should read the nonlocal ledger, verify the tracked archive, then write the trimmed logical source`,
      );
    }
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
      /read the active ledger with `squad_state_read` for `decisions\/decisions\.md`/i,
      "archive command should read the logical decision-ledger key",
    );
    assert.match(
      archiveCommand,
      /write the trimmed ledger to logical key `decisions\/decisions\.md` with `squad_state_write`/i,
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
      /dry-run classification against the live ledger.{0,900}durable tagging convention.{0,150}10.?15 entries.{0,150}future-inbox behavior/i,
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
      /If archive tracking, append\/readback, or entry-count verification fails, leave the active source intact and report the failure/i,
      "failed verification should preserve the source",
    );
    assert.match(
      archiveCommand,
      /For orphan, two-layer, or git-notes, read the active ledger with `squad_state_read` for `decisions\/decisions\.md`; if the bridge is unavailable or the read fails, fail closed, and never consult a stale checkout copy/i,
      "governed backends should read the active ledger through state tools rather than checkout snapshots",
    );
    assert.match(
      archiveCommand,
      /For every backend, append eligible entries to the already tracked `\.squad\/decisions-archive\.md` with normal repository file operations, not mutable-state tools/,
      "the tracked archive should be updated with repository file operations, not runtime state tools",
    );
    assert.match(
      archiveCommand,
      /Before appending, verify the destination with `git ls-files --error-unmatch \.squad\/decisions-archive\.md`/,
      "the archive destination should be confirmed tracked before appending",
    );
    assert.match(
      archiveCommand,
      /Re-read the archive and confirm every moved heading is literally present and its entry count grew by exactly the number moved/,
      "the appended archive should be read back and checked by entry count before trimming",
    );
    assert.match(
      archiveCommand,
      /For orphan, two-layer, or git-notes, write the trimmed ledger to logical key `decisions\/decisions\.md` with `squad_state_write`, then read it back with `squad_state_read` to verify the trim/i,
      "the trimmed nonlocal ledger should be written and verified through state tools",
    );
  });
});

describe("Scribe — generated coordinator archive safeguards", () => {
  it("requires tracked destinations, verified append-first moves, measured gates, and safe failures", () => {
    const normalized = coordinatorTemplate.replace(/\s+/g, " ");
    for (const safeguard of [
      /DESTINATION MUST BE TRACKED/,
      /A\. DECISION ARCHIVE DESTINATION MUST BE TRACKED/,
      /git ls-files --error-unmatch \.squad\/decisions-archive\.md/,
      /If it is not tracked, abort decision archival/,
      /APPEND FIRST, VERIFY, THEN DELETE/,
      /every moved heading is literally present/,
      /entry count grew by exactly the number moved/,
      /If the append cannot be verified, DO NOT trim — leave the source intact/,
      /COUNT ENTRIES, NOT BYTES/,
      /File size is not a valid integrity signal/,
      /NEVER REPORT A GATE OUTCOME YOU DID NOT MEASURE/,
      /"No archival required" must come from an actual measurement/,
      /For non-local backends, if state tools cannot perform these checks, STOP and report/,
    ]) {
      assert.match(
        normalized,
        safeguard,
        `generated coordinator template should preserve ${safeguard}`,
      );
    }
  });
});

describe("Scribe — backend-aware history archival", () => {
  const extractHistoryArchiveProcedure = (text: string, label: string) => {
    const normalized = text.replace(/\s+/g, " ");
    const start = normalized.indexOf("HISTORY ARCHIVE PROCEDURE (backend-owned mutable state):");
    const end = normalized.indexOf("Runtime state tools own persistence.", start);
    assert.ok(start >= 0 && end > start, `${label} should define a separate history archive procedure`);
    return normalized.slice(start, end);
  };

  it("keeps the tracked decision archive rule separate from backend-owned history archives", () => {
    const activeProcedure = extractHistoryArchiveProcedure(squadAgent, "active coordinator");
    const generatedProcedure = extractHistoryArchiveProcedure(
      coordinatorTemplate,
      "generated coordinator template",
    );
    assert.equal(activeProcedure, generatedProcedure, "active and generated procedures should match");

    for (const [label, text] of [
      ["active coordinator", squadAgent],
      ["generated coordinator template", coordinatorTemplate],
    ] as const) {
      const normalized = text.replace(/\s+/g, " ");
      assert.match(
        normalized,
        /ARCHIVAL SAFETY RULES \(Rule A applies only to decision archival; Rules B-E apply to every move\)/,
        `${label} should scope the tracked-destination rule to decision archival`,
      );
      assert.match(
        normalized,
        /A\. DECISION ARCHIVE DESTINATION MUST BE TRACKED\. Before writing `\.squad\/decisions-archive\.md`, run `git ls-files --error-unmatch \.squad\/decisions-archive\.md`/,
        `${label} should retain the tracked-destination check for the durable decision archive`,
      );
    }

    assert.match(
      activeProcedure,
      /for `local`\/`worktree`, read `\.squad\/agents\/\{agent\}\/history\.md` and append the entries being summarized to `\.squad\/agents\/\{agent\}\/history-archive\.md` using the local state filesystem/i,
    );
    assert.match(
      activeProcedure,
      /verify every moved entry and that its entry count grew by exactly the number moved\. Only then trim the active history file/i,
    );
    assert.match(
      activeProcedure,
      /these paths are ignored\/untracked mutable state: never run Rule A for them and never stage or commit them/i,
    );
    assert.match(
      activeProcedure,
      /for `orphan`, `two-layer`, or `git-notes`, read logical key `agents\/\{agent\}\/history\.md` with `squad_state_read`, append to logical key `agents\/\{agent\}\/history-archive\.md` with `squad_state_append`/i,
    );
    assert.match(
      activeProcedure,
      /read the archive with `squad_state_read` and verify every moved entry and exact entry-count growth\. Only after that verification, write the trimmed active history with `squad_state_write` and read it back to verify/i,
    );
    assert.match(
      activeProcedure,
      /never create, read, or write a checkout copy\. If the bridge, append, readback, or count verification fails, fail closed and preserve the active source/i,
    );
    assert.doesNotMatch(
      activeProcedure,
      /DESTINATION MUST BE TRACKED|git ls-files --error-unmatch/i,
      "history archives must not inherit the decision archive's tracked-destination requirement",
    );
  });

  for (const [label, text] of [
    ["live Scribe charter", charter],
    ["Scribe charter template", scribeTemplate],
    ["after-agent reference", afterAgentReference],
    ["spawn-templates reference", spawnTemplates],
  ] as const) {
    it(`${label} routes history archives through the backend-aware mutable-state procedure`, () => {
      const normalized = text.replace(/\s+/g, " ");

      assert.match(
        normalized,
        /backend-aware (?:procedure|HISTORY ARCHIVE PROCEDURE)/i,
        `${label} should reference backend-aware history archival`,
      );
      assert.match(
        normalized,
        /\.squad\/agents\/\{agent\}\/history-archive\.md/,
        `${label} should identify the local/worktree history archive path`,
      );
      assert.match(
        normalized,
        /agents\/\{agent\}\/history-archive\.md/,
        `${label} should identify the logical history archive key`,
      );
      assert.match(
        normalized,
        /verify (?:archived|moved) entries and exact (?:entry-)?count growth before trimming/i,
        `${label} should verify archived entries and counts before trimming`,
      );
      assert.match(
        normalized,
        /never apply (?:the )?tracked-destination rule or stage\/commit history archives|never apply tracked-destination Rule A or stage\/commit history archives/i,
        `${label} should keep history archives untracked and uncommitted`,
      );
    });
  }
});

describe("Scribe — spawn template health reports use entry counts, not byte-size deltas", () => {
  it("Scribe spawn template HEALTH REPORT step reports entry counts rather than before/after size", () => {
    const normalized = spawnTemplates.replace(/\s+/g, " ");
    assert.match(
      normalized,
      /HEALTH REPORT: Report ENTRY COUNTS, never file sizes: `N removed from source \/ N added to destination`/,
      "Scribe spawn template should match the active coordinator's entry-count health-report rule",
    );
    assert.doesNotMatch(
      normalized,
      /before\/after size/i,
      "Scribe spawn template should not report a byte-size delta as the integrity signal",
    );
  });

  // The decision-only Scribe prompt in after-agent-reference.md deliberately has no
  // persisted HEALTH REPORT step (see the "does not assign ... health-report writes"
  // test below) — it verifies merges by entry presence, never file size, and returns
  // the merge result/errors to the coordinator in plain text instead of writing a
  // health report to state at all.
  it("after-agent reference REPORT step returns the merge result/errors via entry-level verification, never a byte-size health report", () => {
    const normalized = afterAgentReference.replace(/\s+/g, " ");
    assert.match(
      normalized,
      /confirm every merged entry is present/,
      "after-agent reference should verify merges by entry presence, not file size",
    );
    assert.match(
      normalized,
      /REPORT: Return the merge result[\s\S]*?to the coordinator/,
      "after-agent reference should report the merge result to the coordinator",
    );
    assert.match(
      normalized,
      /report the failure/,
      "after-agent reference should report merge/verification errors",
    );
    assert.match(
      normalized,
      /Do not write orchestration logs, session logs, specialist\s+histories, archival records, or health reports to state/,
      "after-agent reference should not persist any health report, eliminating byte-size reporting entirely",
    );
    assert.doesNotMatch(
      normalized,
      /before\/after size/i,
      "after-agent reference should not report a byte-size delta as the integrity signal",
    );
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
    ["secret-handling template", secretHandlingTemplate],
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

describe("Coordinator — non-local runtime memory filesystem boundary", () => {
  for (const [label, text] of [
    ["active coordinator", squadAgent],
    ["generated coordinator template", coordinatorTemplate],
  ] as const) {
    it(`${label} permits static memory config but forbids runtime memory file edits`, () => {
      const normalized = text
        .replace(/\r\n/g, "\n")
        .replace(/`/g, "")
        .replace(/\s+/g, " ");

      assert.match(
        normalized,
        /backend-owned runtime files under \.squad\/memory\/\* \(excluding the static, constitution-tracked \.squad\/memory\/config\.json policy file\) via create \/ edit \/ write_file tools/,
      );
      assert.match(
        normalized,
        /\.squad\/memory\/config\.json is static tracked configuration, not runtime-managed memory/,
      );
      assert.match(
        normalized,
        /all other files under \.squad\/memory\/ remain runtime-owned and must not be directly edited for non-local backends/i,
        "runtime memory files must remain filesystem-protected",
      );
      assert.match(
        normalized,
        /\.squad\/memory\/\*\* except \.squad\/memory\/config\.json/,
      );
      assert.match(
        normalized,
        /\.squad\/memory\/config\.json is static tracked policy configuration, not runtime state, and may be edited on disk under every backend/,
      );
    });
  }
});

describe("Scribe — secret-handling active/template parity", () => {
  it("active and template secret-handling skills agree on the no-stage/no-commit policy", () => {
    for (const text of [secretHandling, secretHandlingTemplate]) {
      const normalized = text.replace(/\r\n/g, "\n");
      assert.match(
        normalized,
        /Scribe never stages or commits mutable `\.squad\/` state/,
        "skill must state Scribe never stages or commits mutable state",
      );
      assert.match(
        normalized,
        /authorized committer must (?:unstage and remediate|remove the secret)/i,
        "skill must route remediation to the authorized committer, not Scribe",
      );
      assert.doesNotMatch(
        normalized,
        /Scribe MUST[\s\S]{0,80}git reset HEAD|Scribe commits ALL `\.squad\/`/i,
        "skill must not direct Scribe to stage, unstage, or commit `.squad/` changes",
      );
    }
  });

  it("does not model partial secret-value disclosure in sample report output", () => {
    for (const text of [secretHandling, secretHandlingTemplate]) {
      const normalized = text.replace(/\r\n/g, "\n");
      assert.match(
        normalized,
        /Never print the matched value while reporting a finding/,
        "skill must instruct withholding the matched value when reporting",
      );
    }
    // The template's commit-blocked sample must use a non-value label
    // (e.g. "DATABASE_URL assignment detected (value withheld)") rather than
    // echoing a redacted-but-present secret value like `DATABASE_URL=...`.
    // Scope the check to the "SECRET DETECTED — commit blocked" sample block;
    // the separate git-history leak alert example is out of scope here.
    const normalizedTemplate = secretHandlingTemplate.replace(/\r\n/g, "\n");
    const blockStart = normalizedTemplate.indexOf(
      "SECRET DETECTED — commit blocked",
    );
    const blockEnd = normalizedTemplate.indexOf(
      "Exit with error (never silently skip)",
      blockStart,
    );
    assert.ok(
      blockStart >= 0 && blockEnd > blockStart,
      "template should contain the commit-blocked sample report block",
    );
    const commitBlockedSample = normalizedTemplate.slice(blockStart, blockEnd);
    assert.doesNotMatch(
      commitBlockedSample,
      /Pattern:\s*[A-Z_]+(?:KEY|TOKEN|SECRET|PASSWORD|URL)=\S/,
      "template's sample commit-blocked report must not echo a redacted-but-present secret value",
    );
    assert.match(
      commitBlockedSample,
      /Pattern:\s*DATABASE_URL assignment detected \(value withheld\)/,
      "template's sample commit-blocked report should use a non-value label",
    );
  });

  it("keeps active and template secret-handling guidance substantively aligned", () => {
    const stripExamples = (text: string) =>
      text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((line) => !/^#|^>/.test(line.trim()))
        .join("\n")
        .replace(/\s+/g, " ")
        .trim();
    assert.equal(
      stripExamples(secretHandlingTemplate).length > 0,
      true,
      "template body should not be empty",
    );
    for (const marker of [
      "Secret Scanning Before Authorized Commits",
      "the authorized committer may proceed",
      "Remediation — If a Secret Was Already Committed",
    ]) {
      assert.ok(
        secretHandling.includes(marker.split(" ").slice(0, 3).join(" ")) ||
          new RegExp(marker, "i").test(secretHandling),
        `active secret-handling skill should contain: ${marker}`,
      );
      assert.ok(
        new RegExp(marker, "i").test(secretHandlingTemplate),
        `secret-handling template should mirror: ${marker}`,
      );
    }
  });
});

describe("worktree-reference.md — no merge=union reliance for backend-owned state", () => {
  it("does not claim a .gitattributes merge=union driver auto-resolves .squad/ state, consistent with git-workflow/SKILL.md", () => {
    const normalized = worktreeReference.replace(/\s+/g, " ");

    assert.doesNotMatch(
      normalized,
      /merge=union.{0,120}auto-resolves/i,
      "worktree-reference.md should not claim merge=union auto-resolves append-only .squad/ files",
    );
    assert.match(
      normalized,
      /Do not rely on `\.gitattributes` `merge=union` to reconcile `\.squad\/` runtime state across worktrees or branches/i,
      "worktree-reference.md should match git-workflow/SKILL.md's merge=union guidance",
    );
    assert.match(
      normalized,
      /union merge is not a persistence mechanism for backend-owned state/i,
      "worktree-reference.md should state union merge is not a persistence mechanism for backend-owned state",
    );
  });
});

describe("git-workflow — backend-aware worktree cleanup", () => {
  it("keeps the canonical skill and template aligned and limits checkout copies to the local/worktree fallback", () => {
    const cleanupPolicy =
      "Before removing a worktree, resolve its configured state backend. For `local`/`worktree` backends, use the configured state tools with canonical logical paths when available; the checkout-snapshot fallback below is permitted only when those tools are unavailable. For `orphan`, `two-layer`, or `git-notes` backends, reconcile and clean mutable state only through the configured state tools using canonical logical paths (for example, `agents/{agent}/history.md`, `decisions/decisions.md`, `identity/now.md`, and `log/{timestamp}-{topic}.md`). Never read or copy a worktree `.squad/` checkout snapshot for these backends. If any required state tool is unavailable, fail closed, leave the worktree in place, and report the missing bridge.";
    const cleanupFallbackHeading =
      "#### Local/worktree checkout-snapshot fallback (only when state tools unavailable)";

    for (const [label, text] of [
      ["canonical git-workflow skill", gitWorkflowSkill],
      ["git-workflow template", gitWorkflowTemplate],
    ] as const) {
      const normalized = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ");
      const cleanupStart = normalized.indexOf(
        label === "canonical git-workflow skill"
          ? "### Cleanup After Merge"
          : "## Worktree Cleanup",
      );
      assert.ok(cleanupStart >= 0, `${label} should define worktree cleanup guidance`);
      const cleanup = normalized.slice(cleanupStart);

      assert.ok(cleanup.includes(cleanupPolicy), `${label} should match the shared backend policy`);
      assert.ok(
        cleanup.includes(cleanupFallbackHeading),
        `${label} should explicitly scope snapshot fallback to local/worktree`,
      );
      assert.doesNotMatch(
        cleanup,
        /Before removing a worktree, preserve (?:any|its) uncommitted `\.squad\/` (?:state|artifacts) as a complete snapshot/i,
        `${label} must not direct unconditional checkout copying`,
      );

      const fallbackStart = cleanup.indexOf(cleanupFallbackHeading);
      const copyCommands = [...cleanup.matchAll(/(?:cp -a|robocopy\s+\$source)/g)];
      for (const copyCommand of copyCommands) {
        assert.ok(
          copyCommand.index > fallbackStart,
          `${label} must keep checkout-copy commands inside the local/worktree fallback`,
        );
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
