import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "secrets-check.yml");
const EXPECTED_SCRIPT_LINES = [
  "set -e",
  "report() {",
  'local variable="$1"',
  'if [ -n "${!variable:-}" ]; then',
  'echo "SET"',
  "else",
  'echo "UNSET"',
  "fi",
  "}",
  "{",
  'echo "## Repo secrets check"',
  'echo ""',
  "echo '```'",
  "report S1",
  "report S2",
  "report S3",
  "report S4",
  "report S5",
  "echo '```'",
  '} | tee -a "$GITHUB_STEP_SUMMARY"',
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getReportStep(yaml: string): Record<string, unknown> | undefined {
  const root = asRecord(parse(yaml));
  const jobs = asRecord(root?.jobs);
  const checkJob = asRecord(jobs?.check);
  const steps = checkJob?.steps;
  if (!Array.isArray(steps)) return undefined;

  return steps
    .map(asRecord)
    .find((step) => step?.name === "Report which secrets are defined");
}

function getReportScript(yaml: string): string | undefined {
  const reportStep = getReportStep(yaml);
  return typeof reportStep?.run === "string" ? reportStep.run : undefined;
}

function assertSafeOutputContract(script: string): void {
  const scriptLines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(
    scriptLines,
    EXPECTED_SCRIPT_LINES,
    "workflow output must contain only fixed text and generic set/unset status",
  );
}

const yaml = fs.readFileSync(WORKFLOW, "utf8");
const reportStep = getReportStep(yaml);
const script = getReportScript(yaml);

describe(".github/workflows/secrets-check.yml", () => {
  it("contains the secret-reporting step", () => {
    assert.ok(script, `expected a reporting script in ${WORKFLOW}`);
  });

  it("uses opaque environment aliases in runner-visible metadata", () => {
    assert.ok(reportStep, "expected a secret-reporting step");
    const env = asRecord(reportStep.env);
    assert.ok(env, "expected environment mappings on the reporting step");
    assert.deepEqual(Object.keys(env), ["S1", "S2", "S3", "S4", "S5"]);
    assert.deepEqual(Object.values(env), [
      "${{ secrets.STFC_ACCOUNTS }}",
      "${{ secrets.STFC_EMAIL }}",
      "${{ secrets.STFC_PASSWORD }}",
      "${{ secrets.cj_pwd }}",
      "${{ secrets.STFC_REFRESH_PAT }}",
    ]);
    assert.ok(script, "expected a reporting script");
    const runnerVisibleMetadata = [script, ...Object.keys(env)].join("\n");
    for (const identifier of [
      "STFC_ACCOUNTS",
      "STFC_EMAIL",
      "STFC_PASSWORD",
      "cj_pwd",
      "STFC_REFRESH_PAT",
    ]) {
      assert.ok(
        !runnerVisibleMetadata.includes(identifier),
        `runner-visible metadata must not contain ${identifier}`,
      );
    }
  });

  it("reports only generic set/unset statuses without identifying metadata", () => {
    assert.ok(script, "expected a reporting script");
    assertSafeOutputContract(script);
  });

  it("passes only environment-variable names to the status helper", () => {
    assert.ok(script, "expected a reporting script");
    assert.match(script, /local variable="\$1"/);
    assert.match(script, /if \[ -n "\$\{!variable:-\}" \]; then/);
    for (const env of [
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
    ]) {
      assert.match(script, new RegExp(`report ${env}(?:\\r?$)`, "m"));
      assert.doesNotMatch(script, new RegExp(`report .*\\$${env}`));
    }
  });

  it("rejects secret labels, values, and value-derived metadata", () => {
    assert.ok(script, "expected a reporting script");
    const unsafeValueScript = script.replace(
      'echo "SET"',
      'echo "SET: $STFC_ACCOUNTS_VAL"',
    );
    const unsafeMetadataScript = script.replace(
      'echo "SET"',
      'echo "SET: length=${#STFC_ACCOUNTS_VAL}"',
    );
    const unsafeLabelScript = script.replace('echo "SET"', 'echo "STFC_ACCOUNTS: SET"');
    assert.notEqual(unsafeValueScript, script, "value mutation must change the source");
    assert.notEqual(unsafeMetadataScript, script, "metadata mutation must change the source");
    assert.notEqual(unsafeLabelScript, script, "label mutation must change the source");
    assert.throws(() => assertSafeOutputContract(unsafeValueScript));
    assert.throws(() => assertSafeOutputContract(unsafeMetadataScript));
    assert.throws(() => assertSafeOutputContract(unsafeLabelScript));
  });

  it("emits only set/unset diagnostics in actual logs and appended summaries", (t) => {
    assert.ok(script, "expected a reporting script");
    const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
    if ((bash.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      t.skip("bash is unavailable");
      return;
    }
    assert.equal(bash.status, 0, "bash must be runnable");

    const secrets = [
      ["STFC_ACCOUNTS", "S1"],
      ["STFC_EMAIL", "S2"],
      ["STFC_PASSWORD", "S3"],
      ["cj_pwd", "S4"],
      ["STFC_REFRESH_PAT", "S5"],
    ] as const;
    const emptyEnv: Record<string, string> = Object.fromEntries(
      secrets.map(([, env]) => [env, ""]),
    );
    // Synthetic inputs vary length, format, and shell-sensitive content.
    const values = [
      "x",
      "synthetic-long-value-0123456789",
      '{"synthetic":"account","token":"not-a-token"}',
      "synthetic\r\nmultiline\n秘密",
      '  $(printf injected) `printf injected` " %s \\  ',
      " \t\n",
    ];
    const cases: Record<string, string>[] = [
      {},
      emptyEnv,
      ...secrets.flatMap(([, env]) =>
        values.map((value) => ({ ...emptyEnv, [env]: value })),
      ),
      Object.fromEntries(secrets.map(([, env], index) => [env, values[index]!])),
    ];
    const summaryFile = `.secrets-check-summary-${randomUUID()}.txt`;
    const summaryPath = path.join(REPO_ROOT, summaryFile);
    const previousSummary = "Previous step summary\n";

    try {
      for (const secretEnv of cases) {
        fs.writeFileSync(summaryPath, previousSummary);
        const result: SpawnSyncReturns<string> = spawnSync(
          "bash",
          ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
          {
            cwd: REPO_ROOT,
            encoding: "utf8",
            env: {
              PATH: process.env.PATH,
              GITHUB_STEP_SUMMARY: summaryFile,
              ...secretEnv,
            },
          },
        );
        const expected = [
          "## Repo secrets check",
          "",
          "```",
          ...secrets.map(([, env]) => (secretEnv[env] ? "SET" : "UNSET")),
          "```",
          "",
        ].join("\n");
        assert.equal(result.error, undefined, "workflow shell must launch");
        assert.equal(result.status, 0, "workflow report must succeed");
        assert.equal(result.stderr, "", "workflow stderr must not reveal values or metadata");
        assert.equal(result.stdout, expected, "workflow logs must contain only fixed status diagnostics");
        for (const [name, env] of secrets) {
          assert.ok(!result.stdout.includes(name), `workflow logs must not reveal ${name}`);
          const value = secretEnv[env];
          if (value) {
            assert.ok(!result.stdout.includes(value), `workflow logs must not reveal ${name}'s value`);
          }
        }
        assert.equal(
          fs.readFileSync(summaryPath, "utf8"),
          previousSummary + expected,
          "workflow summary must append only fixed status diagnostics",
        );
        const summary = fs.readFileSync(summaryPath, "utf8");
        for (const [name, env] of secrets) {
          assert.ok(!summary.includes(name), `workflow summary must not reveal ${name}`);
          const value = secretEnv[env];
          if (value) {
            assert.ok(!summary.includes(value), `workflow summary must not reveal ${name}'s value`);
          }
        }
      }
    } finally {
      fs.rmSync(summaryPath, { force: true });
    }
  });
});
