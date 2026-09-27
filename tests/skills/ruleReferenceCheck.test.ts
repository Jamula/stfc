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
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

function cleanGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function findBash(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
          path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
          "bash",
        ]
      : ["bash"];

  return candidates.find((candidate) => {
    const result = spawnSync(candidate, ["--version"], {
      env: cleanGitEnvironment(),
      stdio: "ignore",
    });
    return !result.error && result.status === 0;
  });
}

function extractWorkflowScript(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const runIndex = lines.findIndex((line) => /^\s{8}run:\s*\|$/.test(line));
  assert.notEqual(runIndex, -1, "workflow run block must exist");

  const body: string[] = [];
  let indentation: number | undefined;
  for (const line of lines.slice(runIndex + 1)) {
    if (!line.trim()) {
      body.push("");
      continue;
    }

    const lineIndentation = line.match(/^\s*/)?.[0].length ?? 0;
    if (lineIndentation <= 8) break;
    indentation ??= lineIndentation;
    if (lineIndentation < indentation) break;
    body.push(line.slice(indentation));
  }

  return body.join("\n").replace(/\$\{\{\s*github\.base_ref\s*\}\}/g, "main");
}

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: cleanGitEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runWorkflowFixture(
  bash: string,
  script: string,
  canonicalInstructions: string,
  addedContent: string,
): { status: number | null; output: string } {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rule-reference-check-"));
  try {
    const repo = path.join(scratch, "repo");
    fs.mkdirSync(path.join(repo, ".github"), { recursive: true });
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".github", "copilot-instructions.md"),
      canonicalInstructions,
    );
    runGit(repo, "init", "-b", "main");
    runGit(repo, "config", "user.name", "Workflow Test");
    runGit(repo, "config", "user.email", "workflow-test@example.invalid");
    runGit(repo, "add", "--", ".github/copilot-instructions.md");
    runGit(repo, "commit", "-m", "canonical baseline");
    runGit(
      repo,
      "update-ref",
      "refs/remotes/origin/main",
      runGit(repo, "rev-parse", "HEAD"),
    );

    fs.writeFileSync(path.join(repo, "docs", "change.md"), addedContent);
    runGit(repo, "add", "--", "docs/change.md");
    runGit(repo, "commit", "-m", "governance change");

    const result = spawnSync(bash, ["-"], {
      cwd: repo,
      encoding: "utf8",
      env: cleanGitEnvironment(),
      input: script,
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const bash = findBash();

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

  it("canonical rule numbers come only from numbered headings in copilot instructions", () => {
    // .github/copilot-instructions.md is authoritative; only ^## [0-9]+. declares a rule.
    assert.match(
      yaml,
      /grep -oE '\^## \[0-9\]\+\\.'/,
      "canonical-extraction must use grep pattern '^## [0-9]+.' on copilot-instructions.md",
    );
    assert.match(
      yaml,
      /sort -n \|\| true/,
      "canonical extraction must allow an instruction file with no numbered headings",
    );
    assert.match(
      yaml,
      /\.github\/copilot-instructions\.md is authoritative/,
      "the canonical rule-number source must be explicit",
    );
    assert.match(
      yaml,
      /No numbered canonical rules found in \.github\/copilot-instructions\.md; any cited Rule N will be reported as dangling\./,
      "workflow must diagnose an empty canonical rule set",
    );
    const emptyCanonicalGuard = yaml.match(
      /if \[ -z "\$CANONICAL" \]; then([\s\S]*?)fi/,
    );
    assert.ok(emptyCanonicalGuard, "must diagnose when no canonical rule numbers are found");
    assert.doesNotMatch(
      emptyCanonicalGuard[1]!,
      /exit\s+0/,
      "an empty canonical set must not bypass citation diagnostics",
    );
  });

  it("continues citation validation when copilot instructions contain no numbered rule headings", () => {
    assert.match(
      yaml,
      /if ! echo "\$CANONICAL" \| grep -qw "\$n"; then/,
      "every cited number must be checked against the canonical set, including when empty",
    );
    assert.match(
      yaml,
      /These numbers do not exist in \.github\/copilot-instructions\.md\./,
      "dangling citations must identify the authoritative source",
    );
  });

  it(
    "runs the workflow correctly when the canonical instructions have no numbered headings",
    { skip: bash ? false : "Bash is unavailable for executing the workflow fixture" },
    () => {
      const script = extractWorkflowScript(yaml);
      const noRules = "# Instructions\n\n## Overview\n\n";

      const noCitation = runWorkflowFixture(bash!, script, noRules, "No rule citation.\n");
      assert.equal(noCitation.status, 0, noCitation.output);
      assert.match(noCitation.output, /No numbered canonical rules found/);
      assert.match(noCitation.output, /No 'Rule N' references in added content/);

      const danglingCitation = runWorkflowFixture(bash!, script, noRules, "This cites Rule 999.\n");
      assert.equal(danglingCitation.status, 1, danglingCitation.output);
      assert.match(danglingCitation.output, /Rule 999/);
      assert.match(danglingCitation.output, /docs\/change\.md/);

      const validCitation = runWorkflowFixture(
        bash!,
        script,
        "# Instructions\n\n## 2. Rule Two\n\n",
        "This cites Rule 2.\n",
      );
      assert.equal(validCitation.status, 0, validCitation.output);
      assert.match(validCitation.output, /All Rule N references are valid/);
    },
  );

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
