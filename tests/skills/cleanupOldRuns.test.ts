// Pinning tests for .github/workflows/cleanup-old-runs.yml
//
// Regression-guards the invariants of the cleanup-old-runs CI workflow.
// Validates:
//   - input definitions (older_than_days, older_than_hours, defaults)
//   - permissions (actions: write, contents: read)
//   - cutoff logic for both days and hours modes
//   - validation patterns (positive integers only)
//   - mode detection and logging
//
// Per Rule 3: update this file in the same commit as cleanup-old-runs.yml.
// If any assertion fails, the workflow has drifted from the documented contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const yamlPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "cleanup-old-runs.yml",
);

describe("cleanup-old-runs.yml / contract pinning", () => {
  let yamlContent: string;

  yamlContent = fs.readFileSync(yamlPath, "utf8");

  it("cleanup-old-runs.yml exists", () => {
    assert.ok(fs.existsSync(yamlPath), `cleanup-old-runs.yml not found at ${yamlPath}`);
  });

  // ── Inputs ───────────────────────────────────────────────────────────────

  it("has workflow_dispatch trigger", () => {
    assert.match(yamlContent, /on:\s*workflow_dispatch:/, "must have workflow_dispatch trigger");
  });

  it("older_than_days input exists with default '3'", () => {
    assert.match(yamlContent, /older_than_days:/, "older_than_days input must exist");
    assert.match(yamlContent, /default:\s*['"]3['"]/, "older_than_days default must be '3'");
  });

  it("older_than_hours input exists with empty default", () => {
    assert.match(yamlContent, /older_than_hours:/, "older_than_hours input must exist");
    assert.match(yamlContent, /older_than_hours:[\s\S]*?default:\s*['"]?['"]/, "older_than_hours default must be empty string");
  });

  it("older_than_hours description mentions precedence over older_than_days", () => {
    assert.match(
      yamlContent,
      /older_than_hours:[\s\S]*?description:[\s\S]*?(precedence|takes precedence)/i,
      "must document that hours takes precedence",
    );
  });

  // ── Permissions ───────────────────────────────────────────────────────────

  it("permissions include actions: write", () => {
    assert.match(yamlContent, /permissions:[\s\S]*?actions:\s*write/, "permissions must include actions: write");
  });

  it("permissions include contents: read", () => {
    assert.match(yamlContent, /permissions:[\s\S]*?contents:\s*read/, "permissions must include contents: read");
  });

  // ── Cutoff step logic ──────────────────────────────────────────────────────

  it("Set cutoff timestamp step exists", () => {
    assert.match(yamlContent, /- name: Set cutoff timestamp/, "must have 'Set cutoff timestamp' step");
  });

  it("has HOURS and DAYS environment variables", () => {
    assert.match(yamlContent, /HOURS:\s*\$\{\{\s*inputs\.older_than_hours/, "must read inputs.older_than_hours");
    assert.match(yamlContent, /DAYS:\s*\$\{\{\s*inputs\.older_than_days/, "must read inputs.older_than_days");
  });

  it("hours validation regex matches positive integers only", () => {
    assert.match(
      yamlContent,
      /"\$HOURS".*=~.*1-9.*0-9.*\$/,
      "hours validation must match ^[1-9][0-9]*$",
    );
  });

  it("days validation regex matches positive integers only", () => {
    assert.match(
      yamlContent,
      /"\$DAYS".*=~.*1-9.*0-9.*\$/,
      "days validation must match ^[1-9][0-9]*$",
    );
  });

  it("hours cutoff uses 'date -d \"$HOURS hours ago\"'", () => {
    assert.match(yamlContent, /date.*-d.*"\$HOURS hours ago"/, "hours mode must use 'date -d \"$HOURS hours ago\"'");
  });

  it("days cutoff uses 'date -d \"$DAYS days ago\"'", () => {
    assert.match(yamlContent, /date.*-d.*"\$DAYS days ago"/, "days mode must use 'date -d \"$DAYS days ago\"'");
  });

  it("outputs mode and mode_value to GITHUB_OUTPUT", () => {
    assert.match(yamlContent, /echo "mode=/, "must output mode");
    assert.match(yamlContent, /echo "mode_value=/, "must output mode_value");
  });

  it("job summary logs which mode was used", () => {
    assert.match(
      yamlContent,
      /## Cleanup Summary[\s\S]*?Mode.*mode_value.*mode/,
      "job summary must log mode and mode_value",
    );
  });

  // ── Backward compat ────────────────────────────────────────────────────────

  it("falls back to days when hours is empty", () => {
    assert.match(
      yamlContent,
      /if \[\[ -n "\$HOURS"/,
      "must check if HOURS is non-empty before using hours mode",
    );
  });

  it("hours check is guarded by both -n and != empty string", () => {
    assert.match(
      yamlContent,
      /-n "\$HOURS".*&&.*"\$HOURS" != ""/,
      "hours check must guard against both null and empty string",
    );
  });
});
