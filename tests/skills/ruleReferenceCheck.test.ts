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
  });

  it("canonical extraction uses || true to survive a zero-heading canonical file", () => {
    // When .github/copilot-instructions.md has no ## N. headings (current format),
    // grep exits 1. Without || true, set -euo pipefail aborts the step before any
    // diagnostic is printed. This pins the fix from issue #224.
    assert.match(
      yaml,
      /grep -oE '\[0-9\]\+' \| sort -n \|\| true/,
      "canonical extraction pipeline must end with || true to prevent set -euo pipefail abort on zero matches",
    );
  });

  it("emits a diagnostic when the canonical rule set is empty (zero-heading format)", () => {
    // When no numbered headings are found the workflow must print an explicit
    // message rather than silently proceeding with an empty set. This makes the
    // current-format policy visible in CI logs.
    assert.match(
      yaml,
      /No numbered headings found in copilot-instructions\.md/,
      "must emit diagnostic when canonical rule set is empty",
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

  it("exits 0 when no Rule N citations appear in added lines (current-format / no-citation pass)", () => {
    // A governance PR that touches .squad/** but adds no "Rule N" text must pass.
    // The workflow emits this message and exits 0 before reaching the dangling check.
    assert.match(
      yaml,
      /No 'Rule N' references in added content/,
      "must short-circuit with exit 0 when no Rule N citations are present",
    );
  });

  it("exits 0 when all cited Rule N references are valid (valid-citation pass)", () => {
    // When every cited number is in the canonical set the workflow emits this
    // message and exits 0.
    assert.match(
      yaml,
      /All Rule N references are valid/,
      "must emit pass message when all citations resolve to canonical rule numbers",
    );
  });

  it("exits 1 on dangling references (fail loud)", () => {
    assert.match(yaml, /exit 1/, "workflow must exit 1 when dangling references are found");
  });

  it("failure output shape includes both Rule number and file path (invalid-citation fail)", () => {
    // The failure message must include both the Rule number and the file path
    // that introduced the dangling citation. This pins the fix from issue #224
    // acceptance criterion: "a genuinely invalid Rule N citation fails with
    // the number and file shown."
    //
    // The pattern "Rule ${n} in ${f}" is produced by the per-file iteration
    // loop that replaced the combined-diff approach. A single-file match like
    // "Rule 99 in .squad/foo.md" satisfies this regex.
    assert.match(
      yaml,
      /Rule \$\{n\} in \$\{f\}/,
      "failure output must embed both Rule number (${n}) and file path (${f}) in the dangling line",
    );
  });

  it("per-file iteration loop is present (multi-file path attribution)", () => {
    // Pins that extraction is done per-file via a while-read-f loop rather
    // than a combined diff. This is the structural guarantee that two files
    // adding Rule 99 each produce their own attributed output line, and that
    // different Rule numbers in different files are attributed independently.
    assert.match(
      yaml,
      /while IFS= read -r f;/,
      "must iterate over target files individually to preserve path attribution",
    );
    assert.match(
      yaml,
      /git diff.*-- "\$f"/,
      "per-file diff must quote the file variable to handle paths with spaces",
    );
  });

  it("dangling check emits section header (fail loud)", () => {
    assert.match(
      yaml,
      /Dangling Rule references/,
      "failure output must include the dangling-references section header",
    );
  });
});
