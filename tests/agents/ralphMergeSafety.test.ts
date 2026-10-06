import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";

/**
 * Regression test for issue #220: prevent issue sessions and Ralph/coordinator
 * automation from auto-landing PRs before review and CI gates.
 *
 * Four PRs (#215-#217, #219) were merged by an automated session before
 * required CI could even start (account-billing block, issue #218) and before
 * any review existed. Draft-PR status alone was later proven insufficient —
 * issue #220 comments report that external automation (not Ralph, not any
 * squad-controlled agent) merged further PRs after Ralph converted open work
 * to draft/hold and sessions had stopped. This test pins the repo-side fix
 * only: removal of squad-controlled merge authority. It does not, and cannot,
 * prove who or what the external merger is — identifying/disabling it is a
 * separate, still-open concern (see issue #220), not something an
 * instruction-file pin test can verify.
 *
 * The only durable, repo-controlled mitigation (this repo's GitHub plan does
 * not support branch-protection APIs — see issue #220) is an explicit,
 * fail-loud instruction invariant: Ralph/the coordinator/issue sessions may
 * open PRs, but must never call `gh pr merge`, enable auto-merge, or run
 * `gh pr ready` without an explicit user request in the current, active
 * conversation. A request from a prior turn, stale context, or an inference
 * from CI/review status never counts, no matter how recent.
 *
 * This test pins that invariant's presence (and the removal of the old
 * unconditional "auto-merge on reviewer-approved + CI-green" authorization,
 * the "(recent context)" stale-request bypass, and the dangling "Rule 7
 * auto-merge gate" citation) across every prompt/runbook/template/skill that
 * could grant merge authority, plus a bounded repo-wide scan so newly added
 * instruction files can't silently reintroduce this class of bug.
 */

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8").replace(
    /\r\n/g,
    "\n",
  );
}

/** Collapses all runs of whitespace (including newlines) to a single space.
 * Used for assertions whose meaning spans a line-wrap boundary, so a future
 * re-wrap of the prose doesn't spuriously break the pin. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

const ralphCharter = readRepoFile(".squad/agents/ralph/charter.md");
const ralphInstructions = readRepoFile(".squad/ralph-instructions.md");
const ralphReference = readRepoFile(".squad/templates/ralph-reference.md");
const issueLifecycle = readRepoFile(".squad/templates/issue-lifecycle.md");
const copilotInstructions = readRepoFile(".github/copilot-instructions.md");
const templateCopilotInstructions = readRepoFile(
  ".squad/templates/copilot-instructions.md",
);
const templateRalphInstructions = readRepoFile(
  ".squad/templates/ralph-instructions.md",
);

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

  it("does not overstate causality by claiming the old charter language itself produced the four merges", () => {
    // Issue #220 established that four PRs were merged before CI/review
    // gates could act. Picard's governance audit on that issue confirms a
    // GitHub identifies the authenticated actor and the merge commits carry
    // Copilot App co-authoring, but the available issue-session tool logs do
    // not identify the host component or trigger that initiated the merge.
    // The charter must describe its own old language as an authorization gap,
    // not as the proven cause, and must not conflate the known actor/execution
    // context with the still-unknown initiating trigger.
    assert.doesNotMatch(
      collapseWhitespace(ralphCharter),
      /language authorized unattended merges and,? per issue #220's audit,? produced (four|4) PRs/i,
      "charter must not claim its old language 'produced' the four merges — the triggering component is unidentified per #220",
    );
    assert.match(
      collapseWhitespace(ralphCharter),
      /GitHub records API-driven merges under the authenticated @cyrusjamula identity and the merge commits carry Copilot App co-authoring/,
      "charter must identify the evidence-supported actor and execution context",
    );
    assert.match(
      collapseWhitespace(ralphCharter),
      /Available issue-session tool logs do not show the initiating merge call, so issue #220 does not identify which host component or trigger initiated the action/,
      "charter must acknowledge that the initiating host component or trigger remains unidentified",
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
      collapseWhitespace(ralphInstructions),
      /Ralph must never call `gh pr merge`, enable auto-merge, or run `gh pr ready` on its own initiative/,
      "must explicitly forbid unilateral merge/auto-merge/ready calls",
    );
  });

  it("requires the merge request to come from the user in the same conversation", () => {
    assert.match(
      collapseWhitespace(ralphInstructions),
      /the user, in this same active conversation, explicitly asks for a specific PR to be merged or marked ready/,
      "must require an explicit, same-conversation user request as the only sanctioned merge path",
    );
  });
});

describe("Merge safety — .squad/templates/ralph-instructions.md is pinned to the live copy (issue #220)", () => {
  // .squad/templates/ralph-instructions.md is what `squad init` scaffolds as a
  // brand-new .squad/ralph-instructions.md; `squad upgrade` never overwrites a
  // user's existing copy. If the template silently lacked the Merge Safety
  // section, every *new* install would start without this invariant. Pin the
  // template to carry the identical section as the live, in-repo copy.
  it("has the same hard-constraint Merge Safety section as the live copy", () => {
    assert.match(
      templateRalphInstructions,
      /### Merge Safety \(hard constraint, issue #220\)/,
      "templates/ralph-instructions.md must have a Merge Safety section citing issue #220",
    );
  });

  it("forbids unilateral gh pr merge / auto-merge / gh pr ready calls", () => {
    assert.match(
      collapseWhitespace(templateRalphInstructions),
      /Ralph must never call `gh pr merge`, enable auto-merge, or run `gh pr ready` on its own initiative/,
      "templates/ralph-instructions.md must explicitly forbid unilateral merge/auto-merge/ready calls",
    );
  });

  it("requires the merge request to come from the user in the same conversation", () => {
    assert.match(
      collapseWhitespace(templateRalphInstructions),
      /the user, in this same active conversation, explicitly asks for a specific PR to be merged or marked ready/,
      "templates/ralph-instructions.md must require an explicit, same-conversation user request as the only sanctioned merge path",
    );
  });

  it("the Merge Safety section text is identical between the template and the live copy", () => {
    const extractSection = (text: string): string => {
      const match = text.match(
        /### Merge Safety \(hard constraint, issue #220\)[\s\S]*$/,
      );
      assert.ok(match, "Merge Safety section must be present to compare");
      return collapseWhitespace(match![0]).trim();
    };
    assert.equal(
      extractSection(templateRalphInstructions),
      extractSection(ralphInstructions),
      "templates/ralph-instructions.md's Merge Safety section must match .squad/ralph-instructions.md exactly, so regeneration/init cannot drop or drift from the invariant",
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

  it("does not offer a stale '(recent context)' bypass on the merge trigger", () => {
    const mergeTriggerLine = ralphReference
      .split("\n")
      .find((l) => l.includes('"merge PR #N"'));
    assert.ok(mergeTriggerLine, "trigger table must retain the merge PR row");
    assert.doesNotMatch(
      mergeTriggerLine!,
      /recent context/i,
      "merge trigger row must not authorize inferring a merge request from recent/stale conversational context",
    );
    assert.doesNotMatch(
      ralphReference,
      /recent context/i,
      "ralph-reference.md must not mention 'recent context' anywhere as a merge-trigger bypass",
    );
    assert.match(
      mergeTriggerLine!,
      /a request from a prior turn or stale context does not count/i,
      "merge trigger row must state that prior-turn/stale requests do not authorize merge",
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

  it("every gh pr create example in the file defaults to draft, including the spawn-prompt block", () => {
    const ghPrCreateLines = issueLifecycle
      .split("\n")
      .filter((l) => l.includes("gh pr create"));
    assert.ok(
      ghPrCreateLines.length >= 2,
      "expected at least two gh pr create examples in issue-lifecycle.md (top-level PR-creation section and the spawn-prompt ISSUE CONTEXT block)",
    );
    for (const line of ghPrCreateLines) {
      assert.match(
        line,
        /gh pr create --draft\b/,
        `every gh pr create example must default to --draft, found non-draft example: ${line.trim()}`,
      );
    }
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

describe("Merge safety — git-workflow SKILL.md, both copies (issue #220)", () => {
  const gitWorkflowSkillPaths = [
    ".github/skills/git-workflow/SKILL.md",
    ".squad/templates/skills/git-workflow/SKILL.md",
  ];

  for (const path of gitWorkflowSkillPaths) {
    describe(path, () => {
      const content = readRepoFile(path);

      it("no longer runs gh pr ready unconditionally as a normal workflow step", () => {
        assert.doesNotMatch(
          content,
          /Push and mark ready/i,
          `${path} must not present "push and mark ready" as one unconditional step`,
        );
        assert.doesNotMatch(
          collapseWhitespace(content),
          /git push -u origin squad\/\{issue-number\}-\{slug\} gh pr ready/,
          `${path} must not run \`gh pr ready\` immediately after push with no gate`,
        );
      });

      it("still documents the push step", () => {
        assert.match(
          content,
          /git push -u origin squad\/\{issue-number\}-\{slug\}/,
          `${path} must retain the push command`,
        );
      });

      it("gates gh pr ready behind an explicit current-conversation user request", () => {
        assert.match(
          content,
          /gh pr ready` is a handoff action, not a normal workflow step/,
          `${path} must describe gh pr ready as a handoff action, not routine`,
        );
        assert.match(
          collapseWhitespace(content),
          /Only run `gh pr ready` when the user explicitly requests that exact action in the current, active conversation/,
          `${path} must require an explicit, current-conversation user request before gh pr ready`,
        );
        assert.match(
          content,
          /a prior turn, stale context, or an inference from CI\/review status never authorizes it/,
          `${path} must state that prior-turn/stale/inferred requests do not authorize gh pr ready`,
        );
      });
    });
  }
});

describe("Merge safety — routing.md (issue #220)", () => {
  const routing = readRepoFile(".squad/routing.md");

  it("Rule 9 no longer describes a firing 'Rule 7 auto-merge gate'", () => {
    assert.doesNotMatch(
      routing,
      /Rule 7 auto-merge gate does not fire/,
      "Rule 9 must not reference a firing Rule 7 auto-merge gate",
    );
    assert.match(
      collapseWhitespace(routing),
      /does not become \*\*merge-ready\*\* until both verdicts are posted as APPROVE and CI is green/,
      "Rule 9 must use merge-ready semantics instead of an auto-merge-gate-fires claim",
    );
  });

  it("Rule 12 no longer describes the Rule 7 auto-merge gate firing on Kirk's own approval", () => {
    assert.doesNotMatch(
      routing,
      /prevents the Rule 7 auto-merge gate from firing/,
      "Rule 12 must not reference the Rule 7 auto-merge gate firing",
    );
    assert.match(
      collapseWhitespace(routing),
      /This prevents a PR from becoming \*\*merge-ready\*\* on Kirk-approves-Kirk's-own-call alone/,
      "Rule 12 must use merge-ready semantics for the Kirk-as-author-and-reviewer mitigation",
    );
  });

  it("reviewer-lane boilerplate no longer says a Rule 7 gate reads verdicts and fires auto-merge", () => {
    assert.doesNotMatch(
      routing,
      /The Rule 7 auto-merge gate reads these comment headers/,
      "reviewer-lane boilerplate must not describe a Rule 7 auto-merge gate reading verdicts",
    );
    assert.doesNotMatch(
      routing,
      /before auto-merge fires/,
      "reviewer-lane boilerplate must not describe auto-merge firing",
    );
  });

  it("no numbered Rule 7 auto-merge authorization is implied anywhere in routing.md", () => {
    assert.doesNotMatch(
      routing,
      /Rule 7 auto-merge gate/,
      "routing.md must not reference a 'Rule 7 auto-merge gate' — no such numbered rule exists",
    );
  });

  it("states that merging still requires an explicit user request under #220", () => {
    assert.match(
      routing,
      /merging still requires an explicit user request in the current,? active conversation under #220/,
      "routing.md must state merging requires an explicit, current-conversation user request under #220",
    );
  });
});

describe("Merge safety — workflow-cron-review SKILL.md (issue #220)", () => {
  const skill = readRepoFile(".squad/skills/workflow-cron-review/SKILL.md");

  it("no longer chains 'then gh pr merge' onto the self-approval workaround", () => {
    assert.doesNotMatch(
      skill,
      /then `gh pr merge`/,
      "must not authorize gh pr merge as a follow-on to the approval-comment workaround",
    );
    assert.doesNotMatch(
      skill,
      /The squad's textual sign-off \+ the merge action are the record/,
      "must not describe the merge action itself as part of the sign-off record",
    );
  });

  it("makes the approval comment itself the record, and defers merge to the explicit-user handoff", () => {
    assert.match(
      skill,
      /that comment \*\*is\*\* the record of sign-off/,
      "approval comment must be documented as the record of sign-off",
    );
    assert.match(
      skill,
      /`gh pr merge` requires an explicit user request in the current, active conversation/,
      "must defer gh pr merge to the explicit-user-request handoff (issue #220)",
    );
  });
});

describe("Merge safety — docs/ARCHITECTURE.md (issue #220)", () => {
  const architecture = readRepoFile("docs/ARCHITECTURE.md");

  it("no longer describes unconditional 'Auto-merge on green (Rule 7)'", () => {
    assert.doesNotMatch(
      architecture,
      /\*\*Auto-merge on green\*\* \(Rule 7\)/,
      "must not describe an unconditional auto-merge-on-green Rule 7 behavior",
    );
    assert.doesNotMatch(
      architecture,
      /Reviewer-approved \+ CI-green PRs\s*\n\s*merge without asking/,
      "must not claim reviewer-approved + CI-green PRs merge without asking",
    );
  });

  it("states merge-ready requires an explicit user request (issue #220)", () => {
    assert.match(
      collapseWhitespace(architecture),
      /makes a PR merge-ready, not merged\*{0,2} \(issue #220\)/,
      "must state reviewer-approved + CI-green makes a PR merge-ready, not merged",
    );
    assert.match(
      collapseWhitespace(architecture),
      /requires an explicit user request in the current, active conversation/,
      "must require an explicit, current-conversation user request to merge",
    );
  });
});

describe("Merge safety — workflow-wiring-appendix-a-code-reviewer.md (issue #220)", () => {
  const appendixA = readRepoFile(
    ".squad/templates/workflow-wiring-appendix-a-code-reviewer.md",
  );

  it("no longer authorizes 'the coordinator merges via gh pr merge' on APPROVE alone", () => {
    assert.doesNotMatch(
      appendixA,
      /On APPROVE, the coordinator merges via `gh pr merge`/,
      "must not authorize an unconditional merge on reviewer APPROVE",
    );
  });

  it("uses merge-ready semantics gated on an explicit user request (issue #220)", () => {
    assert.match(
      appendixA,
      /On APPROVE, the PR becomes merge-ready/,
      "APPROVE must produce merge-ready status, not an immediate merge",
    );
    assert.match(
      collapseWhitespace(appendixA),
      /the coordinator still never calls `gh pr merge` \(or enables auto-merge \/ runs `gh pr ready`\) except when the user explicitly requests that exact action in the current, active conversation/,
      "must gate gh pr merge/auto-merge/gh pr ready behind an explicit, current-conversation user request",
    );
  });
});

describe("Merge safety — bounded repo-wide scan for unguarded merge authorization (issue #220)", () => {
  /**
   * Scans a fixed, known set of "live" instruction/skill/config surfaces —
   * NOT historical logs, decision archives, or example fixtures — for any
   * mention of `gh pr merge`, `gh pr ready`, or "auto-merge". Any file that
   * mentions one of those MUST also carry the explicit-current-conversation
   * guard language and cite issue #220 somewhere in the file, so a newly
   * added instruction file cannot silently reintroduce unconditional merge
   * authority.
   *
   * Deliberately excluded (bounded scope, not a full-repo grep):
   * - `.squad/decisions/decisions.md` / `.squad/decisions-archive.md` — historical
   *   decision record, not a live instruction surface.
   * - `.squad/templates/orchestration-log.md`, `raw-agent-output.md`,
   *   `run-output.md` — example output/log fixtures, not executable
   *   instructions.
   * - `specs/**`, `.squad/log/**` — point-in-time planning/log artifacts.
   * - `docs/models.md` — model-selection rationale that references the
   *   historical "Rule 7" name but contains no `gh pr merge`/`gh pr ready`/
   *   `auto-merge` action text for this scanner to act on.
   */
  const SCAN_ROOTS = [
    ".github/copilot-instructions.md",
    ".github/agents",
    ".github/skills",
    ".squad/routing.md",
    ".squad/ralph-instructions.md",
    ".squad/agents",
    ".squad/skills",
    ".squad/templates",
    "docs/ARCHITECTURE.md",
  ];

  const EXCLUDE_PATH_PATTERNS = [
    /decisions-archive\.md$/i,
    /(^|[\\/])decisions\.md$/i,
    /history(-archive)?\.md$/i,
    /orchestration-log\.md$/i,
    /raw-agent-output\.md$/i,
    /run-output\.md$/i,
    /(^|[\\/])log([\\/]|$)/i,
  ];

  // Files that legitimately mention "auto-merge" in a sense unrelated to
  // squad-agent merge authority (e.g. Dependabot's dependency auto-merge
  // policy, or a description of GitHub's conflict-resolution bot). Each
  // entry pins the EXACT allowlisted phrase so the allowlist can't quietly
  // widen to cover a real regression.
  const ALLOWLISTED_UNRELATED_MENTIONS: Record<string, RegExp> = {
    ".squad/agents/obrien/charter.md":
      /Dependabot triage \+ auto-merge policy/,
    ".squad/skills/superseded-pr-detection/SKILL.md":
      /GitHub auto-merge resolver/,
  };

  const ACTION_PATTERN = /gh pr merge|gh pr ready|auto-merge/i;
  const GUARD_PATTERN =
    /explicit[\s\S]{0,200}?(current|active)[\s\S]{0,100}?conversation|(current|active)[\s\S]{0,100}?conversation[\s\S]{0,200}?explicit/i;

  function collectMarkdownFiles(root: string): string[] {
    const abs = resolve(process.cwd(), root);
    const st = statSync(abs);
    if (st.isFile()) {
      return abs.endsWith(".md") ? [abs] : [];
    }
    const out: string[] = [];
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const full = join(abs, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectMarkdownFiles(relative(process.cwd(), full)));
      } else if (entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
    return out;
  }

  function toRelPosix(absPath: string): string {
    return relative(process.cwd(), absPath).split("\\").join("/");
  }

  const allFiles = SCAN_ROOTS.flatMap(collectMarkdownFiles);
  const scannedRelPaths = new Set<string>();
  for (const abs of allFiles) {
    const rel = toRelPosix(abs);
    if (EXCLUDE_PATH_PATTERNS.some((p) => p.test(rel))) continue;
    scannedRelPaths.add(rel);
  }

  it("scan covers the known live surfaces (sanity check on the scanner itself)", () => {
    assert.ok(
      scannedRelPaths.has(".squad/routing.md"),
      "scanner must include .squad/routing.md",
    );
    assert.ok(
      scannedRelPaths.has(".squad/templates/ralph-reference.md"),
      "scanner must include .squad/templates/ralph-reference.md",
    );
    assert.ok(
      scannedRelPaths.has(
        ".squad/templates/workflow-wiring-appendix-a-code-reviewer.md",
      ),
      "scanner must include the code-reviewer wiring appendix",
    );
    assert.ok(
      scannedRelPaths.has(".github/agents/squad.agent.md"),
      "scanner must include .github/agents/squad.agent.md",
    );
    assert.deepEqual(
      Array.from(scannedRelPaths).filter((rel) => !rel.endsWith(".md")),
      [],
      "scanner must only pick up .md files, never sibling copies such as a .md.local-backup",
    );
    assert.ok(
      !scannedRelPaths.has(".squad/decisions-archive.md"),
      "scanner must exclude the historical decisions archive",
    );
  });

  for (const rel of Array.from(scannedRelPaths).sort()) {
    const content = readRepoFile(rel);
    const allowlistPattern = ALLOWLISTED_UNRELATED_MENTIONS[rel];

    if (allowlistPattern) {
      it(`${rel} — 'auto-merge' mention is the allowlisted unrelated reference, not new merge authorization`, () => {
        assert.match(
          content,
          allowlistPattern,
          `${rel} was allowlisted for a specific unrelated phrase that is no longer present — re-check whether it now needs the explicit-user-request guard instead`,
        );
        const withoutAllowlisted = content.replace(allowlistPattern, "");
        assert.doesNotMatch(
          withoutAllowlisted,
          ACTION_PATTERN,
          `${rel} must not contain a second, unguarded gh pr merge/gh pr ready/auto-merge mention outside the allowlisted phrase`,
        );
      });
      continue;
    }

    if (!ACTION_PATTERN.test(content)) {
      continue;
    }

    it(`${rel} mentions gh pr merge/ready or auto-merge and must carry the explicit-conversation guard + #220 citation`, () => {
      assert.match(
        content,
        GUARD_PATTERN,
        `${rel} mentions gh pr merge/ready or auto-merge but is missing the "explicit ... current/active conversation" guard language required by issue #220`,
      );
      assert.match(
        content,
        /#220/,
        `${rel} mentions gh pr merge/ready or auto-merge but does not cite issue #220`,
      );
    });
  }
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

describe("Merge safety — .squad/templates/copilot-instructions.md is pinned to the live copy (issue #220)", () => {
  // .squad/templates/copilot-instructions.md is the source template that
  // regenerates the Squad section of the live .github/copilot-instructions.md.
  // If the template dropped the merge-safety bullet, regeneration would
  // silently strip the invariant from the live file. Pin the exact bullet in
  // both places so they cannot drift apart.
  it("forbids unilateral merge/auto-merge/ready actions in the PR Guidelines section", () => {
    assert.match(
      templateCopilotInstructions,
      /Never call `gh pr merge`, enable auto-merge, or run `gh pr ready`/,
      "templates/copilot-instructions.md must forbid unilateral merge/auto-merge/ready actions",
    );
    assert.match(
      templateCopilotInstructions,
      /merging or marking a PR ready requires an explicit user request in this same active conversation/,
      "templates/copilot-instructions.md must require an explicit, same-conversation user request to merge",
    );
    assert.match(
      templateCopilotInstructions,
      /#220/,
      "templates/copilot-instructions.md should cite issue #220",
    );
  });

  it("the merge-safety bullet is identical between the template and the live copy", () => {
    const extractBullet = (text: string): string => {
      const line = text
        .split("\n")
        .find((l) => l.includes("**Open the PR and stop.**"));
      assert.ok(
        line,
        "merge-safety bullet ('**Open the PR and stop.**') must be present to compare",
      );
      return line!.trim();
    };
    assert.equal(
      extractBullet(templateCopilotInstructions),
      extractBullet(copilotInstructions),
      "templates/copilot-instructions.md's merge-safety bullet must match .github/copilot-instructions.md exactly, so regeneration cannot drop or drift from the invariant",
    );
  });
});
