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
