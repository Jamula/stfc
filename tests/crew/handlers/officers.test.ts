import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleOfficers } from "../../../src/crew/handlers/officers.ts";
import type { Officer } from "../../../src/crew/schemas.ts";
import { makeCommand, makeDatabase, makeDeps, tinyOfficers, tinyRoster } from "./helpers.ts";

describe("crew officers handler", () => {
  it("renders the account inventory with roster ownership state", async () => {
    const output = await handleOfficers(makeCommand("officers", { account: "tiny" }), makeDeps());

    assert.match(output, /^\*\*Officers\*\* \(3\) — account `tiny`/);
    assert.match(output, /Cadet Chen \(`chen`\).*owned L28 R2 P1/);
    assert.match(output, /James T\. Kirk \(`kirk`\).*owned L60 R4 P3/);
    assert.match(output, /Spock \(`spock`\).*unowned/);
  });

  it("filters to owned officers", async () => {
    const output = await handleOfficers(makeCommand("officers", { account: "tiny", owned: "true" }), makeDeps());

    assert.match(output, /\*\*Officers\*\* \(2\) — account `tiny`, owned only/);
    assert.match(output, /James T\. Kirk/);
    assert.doesNotMatch(output, /Spock/);
  });

  it("filters by exact case-insensitive faction", async () => {
    const romulan: Officer = { ...tinyOfficers[0]!, id: "nero", name: "Nero", faction: "romulan", synergy_groups: [] };
    const output = await handleOfficers(
      makeCommand("officers", { account: "tiny", faction: "ROMULAN" }),
      makeDeps({ loadOfficerDatabase: async () => makeDatabase([...tinyOfficers, romulan]) }),
    );

    assert.match(output, /\*\*Officers\*\* \(1\).*faction `romulan`/);
    assert.match(output, /Nero \(`nero`\)/);
    assert.doesNotMatch(output, /James T\. Kirk/);
  });

  it("truncates long inventory output below Discord limits", async () => {
    const manyOfficers: Officer[] = Array.from({ length: 80 }, (_, index) => ({
      ...tinyOfficers[0]!,
      id: `test-${index}`,
      name: `Very Long Test Officer ${String(index).padStart(2, "0")} With Extra Display Text`,
      synergy_groups: ["enterprise_crew", "very_long_synergy_group_name"],
    }));
    const output = await handleOfficers(
      makeCommand("officers", { account: "tiny" }),
      makeDeps({
        loadOfficerDatabase: async () => makeDatabase(manyOfficers),
        loadRoster: async () => ({ ...tinyRoster, officers: [] }),
      }),
    );

    assert.ok(output.length <= 1_900);
    assert.match(output, /… \(\d+ more — use --owned or --faction X to filter\)$/);
  });

  it("requires an explicit account", async () => {
    await assert.rejects(
      () => handleOfficers(makeCommand("officers"), makeDeps()),
      /--account required\. Available: alt, tiny\./,
    );
  });
});
