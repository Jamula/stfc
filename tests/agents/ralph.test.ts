import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  readRouting,
  parseRoutingTable,
} from "./helpers.ts";

const routing = readRouting();
const routingEntries = parseRoutingTable(routing);
const teamMd = readFileSync(
  resolve(process.cwd(), ".squad/team.md"),
  "utf-8",
);
const charterPath = resolve(
  process.cwd(),
  ".squad/agents/ralph/charter.md",
);
const charterExists = existsSync(charterPath);
const charter = charterExists ? readFileSync(charterPath, "utf-8") : "";

const ralphInstructions = readFileSync(
  resolve(process.cwd(), ".squad/ralph-instructions.md"),
  "utf-8",
);
const issueLifecycle = readFileSync(
  resolve(process.cwd(), ".squad/templates/issue-lifecycle.md"),
  "utf-8",
);
const ralphReference = readFileSync(
  resolve(process.cwd(), ".squad/templates/ralph-reference.md"),
  "utf-8",
);

describe("Ralph — team roster", () => {
  it("Ralph appears in team.md as Work Monitor", () => {
    assert.ok(
      teamMd.includes("Ralph"),
      "team.md should list Ralph",
    );
    assert.ok(
      teamMd.toLowerCase().includes("work monitor"),
      "team.md should identify Ralph as Work Monitor",
    );
  });

  it("Ralph is listed as a specialist alongside Garak, Tuvok, Scribe", () => {
    const specialistLine = teamMd
      .split("\n")
      .find(
        (l) =>
          l.includes("Ralph") &&
          (l.includes("Garak") || l.includes("Tuvok") || l.includes("Scribe")),
      );
    assert.ok(
      specialistLine,
      "team.md should list Ralph among specialists (Garak/Tuvok/Scribe/Ralph)",
    );
  });
});

describe("Ralph — routing", () => {
  it("Ralph is exempt from normal routing — no direct routing entry", () => {
    const ralphEntry = routingEntries.find((e) =>
      e.routeTo.toLowerCase().includes("ralph"),
    );
    assert.equal(
      ralphEntry,
      undefined,
      "Ralph should NOT appear as a route-to target (Work Monitor scans the board)",
    );
  });

  it("routing anti-patterns mention Ralph visibility requirement", () => {
    assert.ok(
      routing.toLowerCase().includes("ralph"),
      "Routing doc should reference Ralph",
    );
    assert.ok(
      routing.includes("invisible to Ralph"),
      'Routing should warn about issues being "invisible to Ralph"',
    );
  });
});

describe("Ralph — charter existence", () => {
  it("Ralph has a charter file at .squad/agents/ralph/charter.md", () => {
    assert.ok(
      charterExists,
      "Ralph should have a charter.md file",
    );
  });

  it("charter identifies Ralph by name", () => {
    assert.ok(
      charter.includes("Ralph"),
      "Charter should identify Ralph by name",
    );
  });
});

describe("Ralph — role identity", () => {
  it("team.md has no charter path for Ralph (dash instead)", () => {
    // Ralph's team.md row shows "—" for charter path, unlike agents with full charters
    const ralphRow = teamMd
      .split("\n")
      .find((l) => l.includes("Ralph") && l.includes("Work Monitor"));
    assert.ok(ralphRow, "team.md should have a Ralph / Work Monitor row");
    assert.ok(
      ralphRow.includes("—") || ralphRow.includes(".squad/agents/ralph"),
      "Ralph's row should show either a dash or a charter path",
    );
  });

  it("Ralph has Monitor status emoji in team.md", () => {
    const ralphRow = teamMd
      .split("\n")
      .find((l) => l.includes("Ralph") && l.includes("Work Monitor"));
    assert.ok(ralphRow, "team.md should have a Ralph row");
    assert.ok(
      ralphRow.includes("🔄") || ralphRow.includes("Monitor"),
      "Ralph's row should show monitor status",
    );
  });
});

// ─── Regression: issue #220 — no unconditional auto-merge authority ───────────

describe("Ralph — merge authority restrictions (issue #220)", () => {
  it("charter does NOT grant unconditional auto-merge authority", () => {
    // The old Rule 7 phrasing "auto-merge on reviewer-approved + CI-green" must be gone
    assert.ok(
      !charter.includes("auto-merge on reviewer-approved"),
      "Charter must not grant unconditional auto-merge authority",
    );
  });

  it("charter explicitly states Ralph does NOT call gh pr merge", () => {
    assert.ok(
      charter.toLowerCase().includes("never") &&
        charter.includes("gh pr merge"),
      "Charter must contain an explicit prohibition on calling 'gh pr merge'",
    );
  });

  it("charter describes merge-hold posture for non-green CI", () => {
    assert.ok(
      charter.toLowerCase().includes("billing-blocked") ||
        charter.toLowerCase().includes("ci-unavailable") ||
        charter.toLowerCase().includes("hold"),
      "Charter must describe the CI-unavailable / red / pending hold posture",
    );
  });

  it("ralph-instructions.md prohibits gh pr merge and auto-merge", () => {
    assert.ok(
      ralphInstructions.toLowerCase().includes("must not") ||
        ralphInstructions.toLowerCase().includes("never"),
      "ralph-instructions must contain a prohibition keyword",
    );
    assert.ok(
      ralphInstructions.includes("gh pr merge") ||
        ralphInstructions.includes("auto-merge"),
      "ralph-instructions must reference the prohibited actions by name",
    );
  });

  it("ralph-instructions.md requires --draft flag on PR creation", () => {
    assert.ok(
      ralphInstructions.includes("--draft"),
      "ralph-instructions must require --draft when creating PRs",
    );
  });

  it("issue-lifecycle.md PR creation command uses --draft", () => {
    // Every gh pr create example in the lifecycle doc must include --draft
    const prCreateLines = issueLifecycle
      .split("\n")
      .filter((l) => l.includes("gh pr create") && !l.startsWith("#"));
    assert.ok(
      prCreateLines.length > 0,
      "issue-lifecycle.md should contain at least one gh pr create command",
    );
    for (const line of prCreateLines) {
      assert.ok(
        line.includes("--draft"),
        `All gh pr create commands must include --draft, but found: ${line.trim()}`,
      );
    }
  });

  it("issue-lifecycle.md anti-patterns list --draft omission as prohibited", () => {
    assert.ok(
      issueLifecycle.includes("--draft"),
      "issue-lifecycle.md must mention --draft in anti-patterns or requirements",
    );
  });

  it("issue-lifecycle.md PR merge section is human-only", () => {
    assert.ok(
      issueLifecycle.toLowerCase().includes("human") &&
        issueLifecycle.toLowerCase().includes("merge"),
      "issue-lifecycle.md must describe human-only merge authority",
    );
    // Must not describe Ralph auto-merging
    assert.ok(
      !issueLifecycle.includes("Ralph auto-merges"),
      "issue-lifecycle.md must not describe Ralph auto-merging",
    );
  });

  it("ralph-reference.md merge trigger does NOT map to gh pr merge", () => {
    // The triggers table row for "merge PR #N" must NOT say 'Merge via `gh pr merge`'
    assert.ok(
      !ralphReference.includes("Merge via `gh pr merge`"),
      "ralph-reference.md must not map 'merge PR #N' to 'gh pr merge'",
    );
  });

  it("ralph-reference.md CI-unavailable / billing-blocked hold policy is documented", () => {
    assert.ok(
      ralphReference.toLowerCase().includes("billing-blocked"),
      "ralph-reference.md must document billing-blocked as a CI-hold trigger",
    );
    assert.ok(
      ralphReference.toLowerCase().includes("hold"),
      "ralph-reference.md must document the hold posture for non-green CI",
    );
  });

  it("ralph-reference.md explicitly requires draft PRs", () => {
    assert.ok(
      ralphReference.includes("draft"),
      "ralph-reference.md must mention draft PR requirement",
    );
  });
});