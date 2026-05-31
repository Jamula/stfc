import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadOfficerDatabase } from "../../src/crew/database.ts";
import { optimizeCrew, type OptimizerTaskInput } from "../../src/crew/optimizer.ts";
import { loadRoster } from "../../src/crew/roster.ts";
import { loadTask } from "../../src/crew/tasks.ts";
import type { Officer, Roster } from "../../src/crew/schemas.ts";

const tinyOfficersPath = path.join(process.cwd(), "tests/crew/fixtures/tiny-officers.json");
const tinyRosterPath = path.join(process.cwd(), "tests/crew/fixtures/tiny.yaml");
const tinyTaskDir = path.join(process.cwd(), "tests/crew/fixtures/tiny-tasks");

function withOwned(roster: Roster, id: string, level = 40, rank = 3, promotions = 2): Roster {
  return {
    ...roster,
    officers: roster.officers.map((entry) => {
      if (entry.id !== id) return entry;
      return { id, owned: true, level, rank, promotions };
    }),
  };
}

function officer(
  id: string,
  role: Officer["bda_role"],
  tags: Officer["officer_ability"]["tags"],
  captainTags: Officer["captain_maneuver"]["tags"] = [],
): Officer {
  return {
    id,
    name: id,
    faction: "federation",
    synergy_groups: [],
    captain_maneuver: { text: `${id} captain`, tags: captainTags },
    officer_ability: { text: `${id} ability`, tags },
    bda_role: role,
    rank_curve: "linear",
    added_in_patch: "M90",
    source: "test",
  };
}

describe("crew optimizer", () => {
  it("applies synergy bonus when a full group is present", async () => {
    const database = await loadOfficerDatabase(tinyOfficersPath);
    const baseRoster = await loadRoster(tinyRosterPath);
    const roster = withOwned(baseRoster, "spock", 45, 3, 2);

    const task: OptimizerTaskInput = {
      id: "pvp",
      name: "PVP",
      tag_weights: { pvp_damage: 2 },
      synergy_bonus: 7,
      slot_constraints: { captain: 1, bridge: 2, below_deck: 0 },
      constraints: { exclude_officers: [] },
    };

    const result = optimizeCrew({ database, roster, task, top: 1 });
    assert.equal(result.ranked_crews[0]?.score, 11);
    assert.deepEqual(result.ranked_crews[0]?.rationale.synergy_matches, [
      {
        group: "enterprise_crew",
        members: ["kirk", "spock"],
        bonus: 7,
      },
    ]);
  });

  it("enforces slot legality and degrades gracefully when roster is short", async () => {
    const database = await loadOfficerDatabase(tinyOfficersPath);
    const roster = {
      account: "tiny",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [
        { id: "kirk", owned: true, level: 60, rank: 4, promotions: 3 },
        { id: "chen", owned: true, level: 28, rank: 2, promotions: 1 },
      ],
    } satisfies Roster;

    const task: OptimizerTaskInput = {
      id: "tight-slots",
      name: "tight-slots",
      tag_weights: {},
      synergy_bonus: 0,
      slot_constraints: { captain: 1, bridge: 2, below_deck: 0 },
      constraints: { exclude_officers: [] },
    };

    const result = optimizeCrew({ database, roster, task, top: 1 });
    const first = result.ranked_crews[0];
    assert.ok(first);
    assert.equal(first.crew.captain, "kirk");
    assert.deepEqual(first.crew.bridge, ["chen"]);
    assert.equal(first.completeness.missingSlots.bridge, 1);
  });

  it("returns deterministic rankings for identical inputs", async () => {
    const database = await loadOfficerDatabase(tinyOfficersPath);
    const roster = withOwned(await loadRoster(tinyRosterPath), "spock", 45, 3, 2);
    const task = await loadTask("mining-g3", tinyTaskDir);

    const runA = optimizeCrew({ database, roster, task, top: 3 });
    const runB = optimizeCrew({ database, roster, task, top: 3 });

    assert.deepEqual(runA, runB);
    assert.equal(JSON.stringify(runA), JSON.stringify(runB));
  });

  it("breaks ties predictably by lexicographic crew key", () => {
    const officers: Officer[] = [
      officer("cap", "captain", [], ["pvp_damage"]),
      officer("alpha", "officer", ["hostile_crit"]),
      officer("beta", "officer", ["hostile_crit"]),
      officer("gamma", "officer", ["hostile_crit"]),
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
        { id: "cap", owned: true, level: 50, rank: 3, promotions: 2 },
        { id: "alpha", owned: true, level: 20, rank: 2, promotions: 1 },
        { id: "beta", owned: true, level: 25, rank: 2, promotions: 1 },
        { id: "gamma", owned: true, level: 30, rank: 2, promotions: 1 },
      ],
    };

    const task: OptimizerTaskInput = {
      id: "tie",
      name: "tie",
      tag_weights: { hostile_crit: 1 },
      synergy_bonus: 0,
      slot_constraints: { captain: 1, bridge: 2, below_deck: 0 },
      constraints: { exclude_officers: [] },
    };

    const result = optimizeCrew({ database, roster, task, top: 3 });
    const keys = result.ranked_crews.map((crew) => [crew.crew.captain, ...crew.crew.bridge].sort().join("+"));
    assert.deepEqual(keys, ["alpha+beta+cap", "alpha+cap+gamma", "beta+cap+gamma"]);
  });

  it("handles an empty roster without throwing", async () => {
    const database = await loadOfficerDatabase(tinyOfficersPath);
    const roster: Roster = {
      account: "tiny",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [],
    };

    const task = await loadTask("mining-g3", tinyTaskDir);
    const result = optimizeCrew({ database, roster, task, top: 1 });
    const first = result.ranked_crews[0];
    assert.ok(first);
    assert.equal(first.crew.captain, null);
    assert.deepEqual(first.crew.bridge, []);
    assert.equal(first.completeness.missingSlots.captain, 1);
    assert.equal(first.completeness.missingSlots.bridge, 2);
  });

  it("matches exact ranked output for tiny fixture mining-g3", async () => {
    const database = await loadOfficerDatabase(tinyOfficersPath);
    const roster = await loadRoster(tinyRosterPath);
    const task = await loadTask("mining-g3", tinyTaskDir);

    const result = optimizeCrew({ database, roster, task, top: 1 });

    assert.deepEqual(result, {
      task_id: "mining-g3",
      ranked_crews: [
        {
          rank: 1,
          score: 0,
          crew: {
            captain: "kirk",
            bridge: ["chen"],
            below_deck: [],
          },
          completeness: {
            requiredSlots: { captain: 1, bridge: 2, below_deck: 0 },
            filledSlots: { captain: 1, bridge: 1, below_deck: 0 },
            missingSlots: { captain: 0, bridge: 1, below_deck: 0 },
          },
          rationale: {
            matched_tags: [],
            synergy_matches: [],
            faction_bonus: 0,
            captain_maneuver: "Morale grants crew-wide offensive momentum.",
            officer_abilities: [
              "Bridge survivability bonus against hostiles.",
              "Raises group damage while morale is active.",
            ],
          },
        },
      ],
    });
  });
});
