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
//   - authoritative rule-number allowlist
//   - diff strategy (added-lines-only via "^+"/grep -v "^+++")
//   - Rule N citation pattern
//   - NUL-safe changed-file discovery via a temp file (never a shell
//     variable, which strips embedded NUL bytes) with git's exit status
//     checked explicitly, so a failed `git diff` can never be reported as
//     "No target files changed"
//   - per-file added-line `git diff` exit status checked before grep runs,
//     so a real diff failure can't hide behind grep's expected "no match"
//     exit 1
//
// Per Rule 3: update this file in the same commit as rule-reference-check.yml.
// If any assertion fails, the workflow has drifted from the documented contract.

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

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
const authorityPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "rule-reference-numbers.txt",
);

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface RuleReferenceWorkflow {
  jobs?: {
    check?: {
      steps?: WorkflowStep[];
    };
  };
}

function validationScript(yaml: string): string {
  const workflow = parseYaml(yaml) as RuleReferenceWorkflow;
  const step = workflow.jobs?.check?.steps?.find(
    (candidate) => candidate.name === "Validate Rule N references in changed files",
  );
  assert.ok(step?.run, "workflow validation step must contain a run script");
  return step.run;
}

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }

  return execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeRepoFile(repo: string, relativePath: string, content: string): void {
  const absolutePath = path.join(repo, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function createFixture(options: { authority?: string; document?: string } = {}): string {
  const repo = mkdtempSync(path.join(tmpdir(), "rule-reference-check-"));
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Rule Check Test");
  git(repo, "config", "user.email", "rule-check@example.invalid");
  writeRepoFile(
    repo,
    ".github/rule-reference-numbers.txt",
    options.authority ?? readFileSync(authorityPath, "utf8"),
  );
  writeRepoFile(
    repo,
    ".github/copilot-instructions.md",
    "# Copilot instructions\n\n## Named governance section\n",
  );
  writeRepoFile(
    repo,
    "docs/governance.md",
    options.document ?? "# Governance\n\nExisting guidance.\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "--no-verify", "-m", "base");
  git(repo, "switch", "-c", "feature");
  return repo;
}

function commitFixture(repo: string): void {
  git(repo, "add", "-A");
  git(repo, "commit", "--no-verify", "-m", "feature");
}

function runValidation(repo: string, script: string) {
  const result = spawnSync("bash", ["-c", script], {
    cwd: repo,
    env: { ...process.env, BASE_REF: "main" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.ifError(result.error);
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("rule-reference-check.yml / contract pinning", () => {
  let yaml: string;

  yaml = readFileSync(yamlPath, "utf8");

  it("rule-reference-check.yml exists", () => {
    assert.ok(yaml.length > 0, `rule-reference-check.yml is empty at ${yamlPath}`);
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

  it("trigger paths include the authoritative rule-number allowlist", () => {
    assert.match(
      yaml,
      /\.github\/rule-reference-numbers\.txt/,
      "missing .github/rule-reference-numbers.txt trigger path",
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

  it("loads canonical rule numbers from the explicit authoritative allowlist", () => {
    assert.match(
      yaml,
      /CANONICAL_FILE="\.github\/rule-reference-numbers\.txt"/,
      "workflow must name the authoritative Rule N allowlist",
    );
    assert.match(
      yaml,
      /sub\(\/\\r\$\/, ""\).*\/\^\[0-9\]\+\$\//,
      "workflow must safely extract numeric entries from LF or CRLF allowlists",
    );
    assert.match(
      yaml,
      /Authoritative Rule N allowlist contains no rule numbers/,
      "an empty authoritative allowlist must produce a diagnostic",
    );
    assert.doesNotMatch(yaml, /skipping Rule N citation check/, "workflow must not silently bypass validation");
  });

  it("authoritative allowlist preserves Rule slots 1 through 22", () => {
    const numbers = readFileSync(authorityPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^\d+$/.test(line))
      .map(Number);
    assert.deepEqual(numbers, Array.from({ length: 22 }, (_, index) => index + 1));
  });

  it("diff is scoped to origin/<base_ref>...HEAD (three-dot range)", () => {
    // YAML contains: "${BASE_REF}...HEAD" — match with curly braces
    assert.match(
      yaml,
      /\$\{BASE_REF\}\.\.\./,
      "diff must use three-dot range from ${BASE_REF} to HEAD",
    );
  });

  it("only added lines are checked per target file (grep '^+', excluding '+++')", () => {
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
    assert.match(
      yaml,
      /::error file=\$\{file\}::Dangling Rule \$\{n\} reference/,
      "dangling-reference diagnostics must identify the rule and file",
    );
  });

  it("exits 0 when no target files are changed (no false positives)", () => {
    assert.match(
      yaml,
      /No target files changed/,
      "must have explicit early-exit message when no target files changed",
    );
  });

  // ── Failure-propagation invariants (issue #224) ──────────────────────────
  // A prior revision piped `git diff -z` straight into `mapfile` via a
  // `<(...)` process substitution: `mapfile` reports success regardless of
  // whether the upstream `git diff` failed, so a bad BASE_REF silently
  // became "No target files changed" instead of a loud failure. Bash also
  // strips NUL bytes from data stored in a plain shell variable, so
  // NUL-delimited filenames must be captured to a temp file, never a
  // variable.

  it("captures the changed-file diff to a temp file, not a variable (NUL-safe)", () => {
    assert.match(
      yaml,
      /CHANGED_FILE="\$\(mktemp\)"/,
      "changed-file diff output must be captured via mktemp, not a shell variable",
    );
    assert.doesNotMatch(
      yaml,
      /mapfile -d '' -t CHANGED < <\(/,
      "must not feed NUL-delimited git diff output through a process substitution that hides git's exit code",
    );
    assert.match(
      yaml,
      /mapfile -d '' -t CHANGED < "\$CHANGED_FILE"/,
      "mapfile must read NUL-delimited names back from the captured temp file",
    );
  });

  it("fails loudly (never as 'no target files changed') when the changed-file git diff fails", () => {
    assert.match(
      yaml,
      /if ! git diff --name-only -z "\$\{BASE_REF\}\.\.\.HEAD" > "\$CHANGED_FILE"; then/,
      "changed-file git diff's exit status must be checked explicitly, before mapfile runs",
    );
    assert.match(
      yaml,
      /git diff failed to compare \$\{BASE_REF\}\.\.\.HEAD/,
      "a failed changed-file git diff must produce a diagnostic before exiting non-zero",
    );
  });

  it("checks the per-file added-line git diff status before grep can swallow it", () => {
    assert.match(
      yaml,
      /if ! git diff --unified=0 --no-color "\$\{BASE_REF\}\.\.\.HEAD" -- "\$file" > "\$ADDED_FILE"; then/,
      "added-line git diff's exit status must be checked before the grep pipeline runs",
    );
    assert.match(
      yaml,
      /git diff failed while computing added lines for \$\{file\}/,
      "a failed added-line git diff must produce a file-scoped diagnostic before exiting non-zero",
    );
  });
});

describe("rule-reference-check.yml / executable behavior", () => {
  const yaml = readFileSync(yamlPath, "utf8");
  const script = validationScript(yaml);

  it("passes a current-format governance diff with no added citation", () => {
    const repo = createFixture();
    try {
      writeRepoFile(repo, "docs/governance.md", "# Governance\n\nCitation-free update.\n");
      commitFixture(repo);

      const result = runValidation(repo, script);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /No 'Rule N' references in added content/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("accepts an added citation in the authoritative rule set", () => {
    const repo = createFixture();
    try {
      writeRepoFile(repo, "docs/governance.md", "# Governance\n\nFollow Rule 20.\n");
      commitFixture(repo);

      const result = runValidation(repo, script);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /All Rule N references are valid/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects an invalid added citation with its number and file", () => {
    const repo = createFixture();
    try {
      writeRepoFile(repo, "docs/invalid rule.md", "# Invalid\n\nFollow Rule 999.\n");
      writeRepoFile(repo, "docs/clean.md", "# Clean\n\nNo citation here.\n");
      commitFixture(repo);

      const result = runValidation(repo, script);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /Rule 999 in docs\/invalid rule\.md/);
      assert.doesNotMatch(result.output, /Rule 999 in docs\/clean\.md/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("ignores an unchanged historical dangling citation", () => {
    const repo = createFixture({
      document: "# Governance\n\nHistorical Rule 999 citation.\n",
    });
    try {
      writeRepoFile(
        repo,
        "docs/governance.md",
        "# Governance\n\nHistorical Rule 999 citation.\n\nCitation-free update.\n",
      );
      commitFixture(repo);

      const result = runValidation(repo, script);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /No 'Rule N' references in added content/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("fails with a diagnostic when the authoritative allowlist is empty", () => {
    const repo = createFixture({ authority: "# No valid slots\n" });
    try {
      writeRepoFile(repo, "docs/governance.md", "# Governance\n\nFollow Rule 1.\n");
      commitFixture(repo);

      const result = runValidation(repo, script);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /rule-reference-numbers\.txt.*contains no rule numbers/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("fails loudly with a diagnostic when BASE_REF cannot be resolved (issue #224)", () => {
    // Regression test: an unresolvable BASE_REF must exit non-zero with a
    // diagnostic. It must never be reported as "No target files changed" —
    // that message is reserved for a genuinely empty, successfully computed
    // diff, not a failed one.
    const repo = createFixture();
    try {
      writeRepoFile(repo, "docs/governance.md", "# Governance\n\nCitation-free update.\n");
      commitFixture(repo);

      const result = spawnSync("bash", ["-c", script], {
        cwd: repo,
        env: { ...process.env, BASE_REF: "definitely-not-a-real-ref-224" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      assert.ifError(result.error);
      const output = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.status, 0, output);
      assert.match(
        output,
        /git diff failed to compare/,
        "an unresolvable BASE_REF must produce a diagnostic",
      );
      assert.doesNotMatch(
        output,
        /No target files changed/,
        "a failed git diff must never be reported as 'no target files changed'",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
