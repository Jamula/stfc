import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression test for issue #220: prevent issue sessions and Ralph/coordinator
 * automation from auto-landing PRs before review and CI gates.
 *
 * Four PRs (#215-#217, #219) were merged by an automated session before
 * required CI could even start (account-billing block, issue #218) and before
 * any review existed. Draft-PR status alone was later proven insufficient —
 * external automation still merged already-drafted PRs. The only durable,
 * repo-controlled mitigation (this repo's GitHub plan does not support
 * branch-protection APIs — see issue #220) is an explicit, fail-loud
 * instruction invariant: Ralph/the coordinator/issue sessions may open PRs,
 * but must never call `gh pr merge`, enable auto-merge, or run `gh pr ready`
 * without an explicit user request in the current, active conversation.
 *
 * This test pins that invariant's presence (and the removal of the old
 * unconditional "auto-merge on reviewer-approved + CI-green" authorization)
 * across every prompt/runbook/template that could grant merge authority.
 */

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8").replace(
    /\r\n/g,
    "\n",
  );
}

const ralphCharter = readRepoFile(".squad/agents/ralph/charter.md");
const ralphInstructions = readRepoFile(".squad/ralph-instructions.md");
const ralphReference = readRepoFile(".squad/templates/ralph-reference.md");
const issueLifecycle = readRepoFile(".squad/templates/issue-lifecycle.md");
const copilotInstructions = readRepoFile(".github/copilot-instructions.md");

describe("Merge safety — Ralph's charter (issue #220)", () => {
  it("no longer grants unconditional auto-merge authority", () => {
    assert.doesNotMatch(
      ralphCharter,
      /auto-merge on reviewer-approved \+ CI-green/i,
      "charter must not unconditionally authorize auto-merge on reviewer-approved + CI-green",
    );
    assert.doesNotMatch(
      ralphCharter,
      /merge on approval when reviewer-approved \+ CI-green/i,
      "charter must not authorize merging on approval without an explicit user request",
    );
  });

  it("declares an explicit Merge Safety section", () => {
    assert.match(
      ralphCharter,
      /## Merge Safety/,
      "charter must have a dedicated Merge Safety section",
    );
  });

  it("requires an explicit user request in the current conversation before merge/ready actions", () => {
    assert.match(
      ralphCharter,
      /never call `gh pr merge`, enable GitHub auto-merge, or run `gh pr ready`/,
      "charter must state Ralph never merges/readies PRs unilaterally",
    );
    assert.match(
      ralphCharter,
      /unless the user explicitly requests that merge or ready action in the current, active conversation/,
      "charter must require an explicit, in-conversation user request before any merge/ready action",
    );
  });

  it("references the governing issue (#220)", () => {
    assert.match(ralphCharter, /#220/, "charter should cite issue #220");
  });

  it("does not list merge execution as something Ralph handles", () => {
    const boundariesMatch = ralphCharter.match(
      /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
    );
    assert.ok(boundariesMatch, "charter must have a ## Boundaries section");
    const handlesLine = boundariesMatch[0]
      .split("\n")
      .find((l) => /\*\*I handle:\*\*/.test(l));
    assert.ok(handlesLine, "Boundaries must have an 'I handle' line");
    assert.doesNotMatch(
      handlesLine!,
      /merge execution/i,
      "'I handle' must not list merge execution now that auto-merge is revoked",
    );
  });
});

describe("Merge safety — ralph-instructions.md (issue #220)", () => {
  it("has a hard-constraint Merge Safety section", () => {
    assert.match(
      ralphInstructions,
      /### Merge Safety \(hard constraint, issue #220\)/,
      "ralph-instructions.md must have a Merge Safety section citing issue #220",
    );
  });

  it("forbids unilateral gh pr merge / auto-merge / gh pr ready calls", () => {
    assert.match(
      ralphInstructions,
      /Ralph must never\s*\ncall `gh pr merge`, enable auto-merge, or run `gh pr ready` on its own initiative/,
      "must explicitly forbid unilateral merge/auto-merge/ready calls",
    );
  });

  it("requires the merge request to come from the user in the same conversation", () => {
    assert.match(
      ralphInstructions,
      /the user, in this same active conversation,\s*\nexplicitly asks for a specific PR to be merged or marked ready/,
      "must require an explicit, same-conversation user request as the only sanctioned merge path",
    );
  });
});

describe("Merge safety — ralph-reference.md (issue #220)", () => {
  it("has a MERGE SAFETY callout near the top", () => {
    assert.match(
      ralphReference,
      /🔒 MERGE SAFETY \(2026-08-24, issue #220\)/,
      "ralph-reference.md must have a MERGE SAFETY callout",
    );
  });

  it("Approved PRs category reports merge-ready instead of merging", () => {
    assert.doesNotMatch(
      ralphReference,
      /\|\s*\*\*Approved PRs\*\*\s*\|[^|]*\|\s*Merge and close related issue\s*\|/,
      "Approved PRs row must not instruct Ralph to merge and close automatically",
    );
    assert.match(
      ralphReference,
      /\*\*Report as merge-ready; do NOT merge\.\*\*/,
      "Approved PRs row must instruct Ralph to report as merge-ready, not merge",
    );
  });

  it("the merge trigger requires an explicit, current-conversation user request", () => {
    const mergeTriggerLine = ralphReference
      .split("\n")
      .find((l) => l.includes('"merge PR #N"'));
    assert.ok(mergeTriggerLine, "trigger table must retain the merge PR row");
    assert.match(
      mergeTriggerLine!,
      /only\*\* when the user states this explicitly in the current conversation/,
      "merge trigger must require an explicit statement in the current conversation",
    );
  });
});

describe("Merge safety — issue-lifecycle.md (issue #220)", () => {
  it("PR Merge section requires an explicit user request, not just approval + CI", () => {
    assert.match(
      issueLifecycle,
      /Merge safety \(2026-08-24, issue #220\)/,
      "PR Merge section must carry the #220 safety callout",
    );
    assert.match(
      issueLifecycle,
      /require an explicit user request in the current, active conversation/,
      "PR Merge section must require an explicit, in-conversation user request",
    );
  });

  it("no longer describes Ralph as auto-merging", () => {
    assert.doesNotMatch(
      issueLifecycle,
      /If CI passes, Ralph auto-merges/,
      "must not describe Ralph auto-merging on green CI alone",
    );
    assert.doesNotMatch(
      issueLifecycle,
      /If approved \+ CI passes, Ralph merges/,
      "must not describe Ralph merging on approval + green CI alone",
    );
    assert.doesNotMatch(
      issueLifecycle,
      /4\. \*\*Merge:\*\* Automatically merges approved PRs/,
      "Ralph's role summary must not claim automatic merging",
    );
  });

  it("lifecycle diagrams route merge through an explicit user request", () => {
    assert.match(
      issueLifecycle,
      /PR opened → CI passes → User requests merge → Merged → Issue closed/,
      "Pattern 1 diagram must show an explicit user merge request",
    );
    assert.match(
      issueLifecycle,
      /Re-reviewed → Approved → User requests merge → Merged → Issue closed/,
      "Pattern 2 diagram must show an explicit user merge request",
    );
  });

  it("anti-patterns call out unrequested merge/auto-merge/ready actions", () => {
    assert.match(
      issueLifecycle,
      /Merging PRs, enabling auto-merge, or marking a draft PR ready without an explicit user request/,
      "anti-patterns list must call out unrequested merge/auto-merge/ready actions",
    );
  });

  it("PR creation defaults to draft for automation-initiated PRs (defense in depth)", () => {
    assert.match(
      issueLifecycle,
      /gh pr create --draft --title/,
      "PR creation command should default to --draft for issue-session/Ralph/coordinator PRs",
    );
  });

  it("gh pr ready handoff requires an explicit user request", () => {
    const readyIndex = issueLifecycle.indexOf("gh pr ready {pr-number}");
    assert.ok(readyIndex >= 0, "gh pr ready command must be present");
    const followingText = issueLifecycle.slice(
      readyIndex,
      readyIndex + 400,
    );
    assert.match(
      followingText,
      /Only run `gh pr ready` when the user has explicitly requested it in the current conversation/,
      "gh pr ready must be guarded by an explicit-user-request note immediately after it",
    );
  });
});

describe("Merge safety — .github/copilot-instructions.md (issue #220)", () => {
  it("instructs issue sessions to open PRs and stop, never merge unilaterally", () => {
    assert.match(
      copilotInstructions,
      /Never call `gh pr merge`, enable auto-merge, or run `gh pr ready`/,
      "copilot-instructions.md must forbid unilateral merge/auto-merge/ready actions",
    );
    assert.match(
      copilotInstructions,
      /merging or marking a PR ready requires an explicit user request in this same active conversation/,
      "copilot-instructions.md must require an explicit, same-conversation user request to merge",
    );
    assert.match(
      copilotInstructions,
      /#220/,
      "copilot-instructions.md should cite issue #220",
    );
  });

  it("clarifies approval/CI-green does not itself authorize merge, even when CI is blocked", () => {
    assert.match(
      copilotInstructions,
      /this holds even if CI is red, blocked, or has not started/,
      "copilot-instructions.md must state the invariant holds even when CI cannot run (issue #218 billing block)",
    );
  });
});
