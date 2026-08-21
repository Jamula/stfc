// Pinning tests for .github/workflows/rule-reference-check.yml
//
// Regression-guards the invariants of the rule-reference-check CI workflow
// added post-PR #128 (rule consolidation). Follows the same pattern as
// tests/skills/swaDeploy.test.ts (workflow YAML contract assertions).
//
// Pins:
//   - trigger paths (the files that activate the check)
//   - concurrency group name
//   - action SHA (actions/checkout)
//   - canonical-extraction grep pattern
//   - diff strategy (added-lines-only via "^+"/grep -v "^+++")
//   - Rule N citation pattern
//
// Per Rule 3: update this file in the same commit as rule-reference-check.yml.
// If any assertion fails, the workflow has drifted from the documented contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// SHA pinned in workflow — must match bit-for-bit.
const CHECKOUT_SHA = "34e114876b0b11c390a56381ad16ebd13914f8d5";

const yamlPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "rule-reference-check.yml",
);

describe("rule-reference-check.yml / contract pinning", () => {
  let yaml: string;

  yaml = fs.readFileSync(yamlPath, "utf8");

  it("rule-reference-check.yml exists", () => {
    assert.ok(fs.existsSync(yamlPath), `rule-reference-check.yml not found at ${yamlPath}`);
  });

  // ── Trigger ──────────────────────────────────────────────────────────────

  it("triggers on pull_request events", () => {
    assert.match(yaml, /pull_request:/, "must trigger on pull_request");
  });

  it("trigger paths include .squad/**", () => {
    assert.match(yaml, /\.squad\/\*\*/, "missing .squad/** trigger path");
  });

  it("trigger paths include .github/copilot-instructions.md", () => {
    assert.match(
      yaml,
      /\.github\/copilot-instructions\.md/,
      "missing .github/copilot-instructions.md trigger path",
    );
  });

  it("trigger paths include .github/agents/squad.agent.md", () => {
    assert.match(
      yaml,
      /\.github\/agents\/squad\.agent\.md/,
      "missing .github/agents/squad.agent.md trigger path",
    );
  });

  it("trigger paths include docs/**", () => {
    assert.match(yaml, /docs\/\*\*/, "missing docs/** trigger path");
  });

  // ── Concurrency ───────────────────────────────────────────────────────────

  it("concurrency group is rule-ref-check-${{ github.ref }}", () => {
    assert.match(
      yaml,
      /group:\s*rule-ref-check-\$\{\{\s*github\.ref\s*\}\}/,
      "concurrency group must be 'rule-ref-check-${{ github.ref }}'",
    );
  });

  it("cancel-in-progress is true", () => {
    assert.match(yaml, /cancel-in-progress:\s*true/, "cancel-in-progress must be true");
  });

  // ── Permissions ───────────────────────────────────────────────────────────

  it("permissions are contents: read only", () => {
    assert.match(yaml, /contents:\s*read/, "permissions must include contents: read");
    assert.doesNotMatch(
      yaml,
      /contents:\s*write/,
      "rule-reference-check must not have write permissions",
    );
  });

  // ── Action pinning ────────────────────────────────────────────────────────

  it("all `uses:` actions are SHA-pinned (40-hex characters)", () => {
    const uses = [...yaml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    assert.ok(uses.length > 0, "expected at least one `uses:` line");
    for (const u of uses) {
      assert.match(u, /@[0-9a-f]{40}\b/, `action not SHA-pinned: ${u}`);
    }
  });

  it(`actions/checkout is pinned to ${CHECKOUT_SHA}`, () => {
    assert.match(
      yaml,
      new RegExp(`actions/checkout@${CHECKOUT_SHA}`),
      `expected actions/checkout@${CHECKOUT_SHA}`,
    );
  });

  it("fetch-depth: 0 is set (required for git diff base comparison)", () => {
    assert.match(
      yaml,
      /fetch-depth:\s*0/,
      "fetch-depth: 0 required so git diff can reach origin/<base_ref>",
    );
  });

  // ── Script invariants ─────────────────────────────────────────────────────

  it("canonical rule numbers are extracted from .github/copilot-instructions.md headings", () => {
    // The grep pattern ^## [0-9]+. captures every rule slot (including RESERVED).
    assert.match(
      yaml,
      /grep -oE '\^## \[0-9\]\+\\.'/,
      "canonical-extraction must use grep pattern '^## [0-9]+.' on copilot-instructions.md",
    );
    assert.match(
      yaml,
      /\| sort -n \|\| true/,
      "canonical extraction must allow an instruction file with no numbered headings",
    );
    assert.match(
      yaml,
      /No numbered canonical rules found — every cited Rule N is dangling\./,
      "workflow must warn (not skip) when no numbered canonical rules exist",
    );
    // An empty canonical set must not short-circuit the check: citation
    // extraction has to keep running so `Rule 999` is still reported dangling.
    assert.doesNotMatch(
      yaml,
      /No numbered canonical rules found[^\n]*\n\s*exit 0/,
      "workflow must not exit early when the canonical set is empty",
    );
  });

  it("skips validation when copilot instructions contain no numbered rule headings", () => {
    assert.match(
      yaml,
      /No numbered '## N\.' headings found/,
      "must early-exit when no canonical numbered headings are present",
    );
  });

  it("diff is scoped to origin/<base_ref>...HEAD (three-dot range)", () => {
    // YAML contains: "${BASE_REF}...HEAD" — match with curly braces
    assert.match(
      yaml,
      /\$\{BASE_REF\}\.\.\./,
      "diff must use three-dot range from ${BASE_REF} to HEAD",
    );
  });

  it("only added lines are checked (grep '^+', excluding '+++')", () => {
    // In YAML block scalar, grep '^+' appears literally with caret and plus chars.
    assert.match(yaml, /grep '\^\+'/, "must filter to added lines with grep '^+'");
    assert.match(yaml, /grep -v '\^\+\+\+'/, "must exclude diff file headers with grep -v '^+++'");
  });

  it("Rule N citation pattern is 'Rule [0-9]+'", () => {
    assert.match(
      yaml,
      /grep -oE 'Rule \[0-9\]\+'/,
      "citation extraction must use pattern 'Rule [0-9]+'",
    );
  });

  it("exits 1 on dangling references (fail loud)", () => {
    assert.match(yaml, /exit 1/, "workflow must exit 1 when dangling references are found");
  });

  it("exits 0 when no target files are changed (no false positives)", () => {
    assert.match(
      yaml,
      /No target files changed/,
      "must have explicit early-exit message when no target files changed",
    );
  });
});
