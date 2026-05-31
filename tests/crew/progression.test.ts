import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { formatUnknownOfficerError, loadOfficerDatabase } from "../../src/crew/database.ts";
import { analyzeProgression } from "../../src/crew/progression.ts";
import { loadRoster } from "../../src/crew/roster.ts";
import type { Officer, Roster } from "../../src/crew/schemas.ts";

const tinyOfficersPath = path.join(process.cwd(), "tests/crew/fixtures/tiny-officers.json");
const tinyRosterPath = path.join(process.cwd(), "tests/crew/fixtures/tiny.yaml");

function officer(
  id: string,
  tags: Officer["officer_ability"]["tags"],
  captainTags: Officer["captain_maneuver"]["tags"] = [],
  synergyGroups: string[] = [],
): Officer {
  return {
    id,
    name: id,
    faction: "federation",
    synergy_groups: synergyGroups,
    captain_maneuver: { text: `${id} captain`, tags: captainTags },
    officer_ability: { text: `${id} ability`, tags },
    bda_role: "either",
    rank_curve: "linear",
    added_in_patch: "M90",
    source: "test",
  };
}

describe("crew progression", () => {
  it("throws the canonical unknown-officer error for owned and unowned roster entries", async () => {
    const database = await loadOfficerDatabase(tinyOfficersPath);
    const baseRoster = await loadRoster(tinyRosterPath);
    const unknown = "definitely-not-real";
    const rosters: Roster[] = [
      {
        ...baseRoster,
        officers: [...baseRoster.officers, { id: unknown, owned: false }],
      },
      {
        ...baseRoster,
        officers: [...baseRoster.officers, { id: unknown, owned: true, level: 1, rank: 1, promotions: 0 }],
      },
    ];

    for (const roster of rosters) {
      assert.throws(
        () => analyzeProgression({ database, roster }),
        (err: unknown) => err instanceof Error && err.message === formatUnknownOfficerError(unknown),
      );
    }
  });

  it("detects high-value missing officers", () => {
    const officers = [
      officer("miner", ["mining_rate", "cargo_capacity"], [], ["mining_set"]),
      officer("tank", ["hostile_mitigation"], [], ["mining_set"]),
    ];

    const database = {
      officers,
      byId: new Map(officers.map((entry) => [entry.id, entry])),
      getOfficerById: (id: string) => {
        const found = officers.find((entry) => entry.id === id);
        if (!found) throw new Error(`missing ${id}`);
        return found;
      },
    };

    const roster: Roster = {
      account: "tiny",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [{ id: "tank", owned: true, level: 55, rank: 3, promotions: 2 }],
    };

    const result = analyzeProgression({ database, roster });
    assert.equal(result.missing_high_value[0]?.officer_id, "miner");
    assert.deepEqual(result.missing_high_value[0]?.top_task_classes, ["mining"]);
    assert.deepEqual(result.missing_high_value[0]?.synergy_with_owned, ["mining_set"]);
  });

  it("orders suggested promotions by priority", () => {
    const officers = [
      officer("specialist", ["mining_rate", "hostile_crit"]),
      officer("generalist", ["dispatch_speed"]),
    ];

    const database = {
      officers,
      byId: new Map(officers.map((entry) => [entry.id, entry])),
      getOfficerById: (id: string) => {
        const found = officers.find((entry) => entry.id === id);
        if (!found) throw new Error(`missing ${id}`);
        return found;
      },
    };

    const roster: Roster = {
      account: "tiny",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [
        { id: "specialist", owned: true, level: 20, rank: 1, promotions: 0 },
        { id: "generalist", owned: true, level: 45, rank: 3, promotions: 2 },
      ],
    };

    const result = analyzeProgression({ database, roster });
    assert.equal(result.suggested_promotion_order[0]?.officer_id, "specialist");
    assert.ok((result.suggested_promotion_order[0]?.priority_score ?? 0) > (result.suggested_promotion_order[1]?.priority_score ?? 0));
  });

  it("aggregates gaps across multiple task classes", () => {
    const officers = [
      officer("miner", ["mining_rate"]),
      officer("fighter", ["hostile_crit"]),
      officer("armada", ["armada_damage"]),
    ];

    const database = {
      officers,
      byId: new Map(officers.map((entry) => [entry.id, entry])),
      getOfficerById: (id: string) => {
        const found = officers.find((entry) => entry.id === id);
        if (!found) throw new Error(`missing ${id}`);
        return found;
      },
    };

    const roster: Roster = {
      account: "tiny",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [{ id: "fighter", owned: true, level: 70, rank: 4, promotions: 3 }],
    };

    const result = analyzeProgression({ database, roster });
    const miningGap = result.task_class_gaps.find((gap) => gap.task_class === "mining");
    const armadaGap = result.task_class_gaps.find((gap) => gap.task_class === "armada");

    assert.equal(miningGap?.covered_by_owned, 0);
    assert.equal(armadaGap?.covered_by_owned, 0);
    assert.ok((miningGap?.missing_high_value ?? 0) >= 1);
    assert.ok((armadaGap?.missing_high_value ?? 0) >= 1);
  });
});
