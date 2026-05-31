import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OfficerDatabaseSchema,
  OfficerSchema,
  RosterEntrySchema,
  RosterSchema,
  TaskDefinitionSchema,
} from "../../src/crew/schemas.ts";

type Fixture = Record<string, unknown>;

function validOfficer(overrides: Fixture = {}): Fixture {
  return {
    id: "kirk",
    name: "James T. Kirk",
    faction: "federation",
    synergy_groups: ["enterprise_crew"],
    captain_maneuver: { text: "Morale boost.", tags: ["morale_recovery"] },
    officer_ability: { text: "Damage boost.", tags: ["pvp_damage"] },
    bda_role: "captain",
    rank_curve: "back_loaded",
    added_in_patch: "M90",
    source: "hand-curated from docs/stfc-game-knowledge.md + community knowledge",
    ...overrides,
  };
}

function validOwnedRosterEntry(overrides: Fixture = {}): Fixture {
  return {
    id: "kirk",
    owned: true,
    level: 50,
    rank: 3,
    promotions: 2,
    ...overrides,
  };
}

function validRoster(overrides: Fixture = {}): Fixture {
  return {
    account: "demo",
    last_updated: "2026-05-31T20:25:00Z",
    officers: [validOwnedRosterEntry()],
    ...overrides,
  };
}

function validTask(overrides: Fixture = {}): Fixture {
  return {
    id: "mining-g3",
    name: "G3 Mining Run",
    description: "Mining test",
    slots: {
      captain: { bda_role: "captain" },
      officer_a: { bda_role: "officer" },
      officer_b: { bda_role: "officer" },
    },
    tag_weights: { mining_rate: 10 },
    synergy_bonus: 1,
    constraints: { exclude_officers: [] },
    ...overrides,
  };
}

function withoutField(source: Fixture, field: string): Fixture {
  const next = { ...source };
  delete next[field];
  return next;
}

describe("crew schemas", () => {
  it("accepts a valid officer", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer()).success, true);
  });

  for (const field of [
    "id",
    "name",
    "faction",
    "synergy_groups",
    "captain_maneuver",
    "officer_ability",
    "bda_role",
    "rank_curve",
    "added_in_patch",
    "source",
  ]) {
    it(`rejects officer missing required field ${field}`, () => {
      assert.equal(OfficerSchema.safeParse(withoutField(validOfficer(), field)).success, false);
    });
  }

  it("rejects officer id that is not kebab-case", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer({ id: "James Kirk" })).success, false);
  });

  it("rejects officer faction outside the closed enum", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer({ faction: "section_31" })).success, false);
  });

  it("rejects officer synergy group members that are not snake_case", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer({ synergy_groups: ["Enterprise Crew"] })).success, false);
  });

  it("rejects captain maneuver tags outside the closed enum", () => {
    assert.equal(
      OfficerSchema.safeParse(
        validOfficer({ captain_maneuver: { text: "Morale boost.", tags: ["not_a_tag"] } }),
      ).success,
      false,
    );
  });

  it("rejects officer ability tags outside the closed enum", () => {
    assert.equal(
      OfficerSchema.safeParse(
        validOfficer({ officer_ability: { text: "Damage boost.", tags: ["not_a_tag"] } }),
      ).success,
      false,
    );
  });

  it("rejects officer bda_role outside the closed enum", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer({ bda_role: "admiral" })).success, false);
  });

  it("rejects officer rank_curve outside the closed enum", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer({ rank_curve: "random" })).success, false);
  });

  it("rejects empty officer provenance source", () => {
    assert.equal(OfficerSchema.safeParse(validOfficer({ source: "" })).success, false);
  });

  it("rejects duplicate tags within one ability block", () => {
    assert.equal(
      OfficerSchema.safeParse(
        validOfficer({ captain_maneuver: { text: "Morale boost.", tags: ["morale_recovery", "morale_recovery"] } }),
      ).success,
      false,
    );
  });

  it("rejects duplicate officer ids in officer database", () => {
    assert.equal(
      OfficerDatabaseSchema.safeParse([validOfficer(), validOfficer({ name: "Alt Kirk" })]).success,
      false,
    );
  });

  it("accepts a valid owned roster entry", () => {
    assert.equal(RosterEntrySchema.safeParse(validOwnedRosterEntry()).success, true);
  });

  it("accepts a valid unowned roster entry", () => {
    assert.equal(RosterEntrySchema.safeParse({ id: "spock", owned: false }).success, true);
  });

  it("rejects roster entry missing id", () => {
    assert.equal(RosterEntrySchema.safeParse({ owned: false }).success, false);
  });

  it("rejects roster entry missing owned discriminator", () => {
    assert.equal(RosterEntrySchema.safeParse({ id: "kirk" }).success, false);
  });

  for (const field of ["level", "rank", "promotions"]) {
    it(`rejects owned roster entry missing required field ${field}`, () => {
      assert.equal(RosterEntrySchema.safeParse(withoutField(validOwnedRosterEntry(), field)).success, false);
    });
  }

  it("rejects extra progression fields on unowned roster entries", () => {
    assert.equal(RosterEntrySchema.safeParse({ id: "kirk", owned: false, level: 1 }).success, false);
  });

  it("rejects roster entry rank below 1", () => {
    assert.equal(RosterEntrySchema.safeParse(validOwnedRosterEntry({ rank: 0 })).success, false);
  });

  it("rejects roster entry rank above 5", () => {
    assert.equal(RosterEntrySchema.safeParse(validOwnedRosterEntry({ rank: 6 })).success, false);
  });

  it("rejects negative roster entry promotions", () => {
    assert.equal(RosterEntrySchema.safeParse(validOwnedRosterEntry({ promotions: -1 })).success, false);
  });

  it("accepts a valid roster", () => {
    assert.equal(RosterSchema.safeParse(validRoster()).success, true);
  });

  for (const field of ["account", "last_updated", "officers"]) {
    it(`rejects roster missing required field ${field}`, () => {
      assert.equal(RosterSchema.safeParse(withoutField(validRoster(), field)).success, false);
    });
  }

  it("rejects roster last_updated that is not an ISO-8601 UTC timestamp", () => {
    assert.equal(RosterSchema.safeParse(validRoster({ last_updated: "2026-05-31 20:25:00" })).success, false);
  });

  it("rejects duplicate roster officer ids", () => {
    assert.equal(
      RosterSchema.safeParse(
        validRoster({ officers: [{ id: "kirk", owned: false }, { id: "kirk", owned: false }] }),
      ).success,
      false,
    );
  });

  it("rejects staleness error threshold below warn threshold", () => {
    assert.equal(RosterSchema.safeParse(validRoster({ staleness_overrides: { warn: 14, error: 7 } })).success, false);
  });

  it("accepts a valid task definition", () => {
    assert.equal(TaskDefinitionSchema.safeParse(validTask()).success, true);
  });

  for (const field of ["id", "name", "description", "slots", "tag_weights", "synergy_bonus"]) {
    it(`rejects task missing required field ${field}`, () => {
      assert.equal(TaskDefinitionSchema.safeParse(withoutField(validTask(), field)).success, false);
    });
  }

  for (const slot of ["captain", "officer_a", "officer_b"]) {
    it(`rejects task slots missing required field ${slot}`, () => {
      assert.equal(
        TaskDefinitionSchema.safeParse(
          validTask({ slots: withoutField(validTask().slots as Fixture, slot) }),
        ).success,
        false,
      );
    });
  }

  it("rejects task slot bda_role outside the closed enum", () => {
    assert.equal(
      TaskDefinitionSchema.safeParse(
        validTask({ slots: { captain: { bda_role: "pilot" }, officer_a: { bda_role: "officer" }, officer_b: { bda_role: "officer" } } }),
      ).success,
      false,
    );
  });

  it("rejects task tag_weights keys outside the closed tag enum", () => {
    assert.equal(TaskDefinitionSchema.safeParse(validTask({ tag_weights: { not_a_tag: 10 } })).success, false);
  });

  it("rejects task faction_bonus keys outside the closed faction enum", () => {
    assert.equal(TaskDefinitionSchema.safeParse(validTask({ faction_bonus: { section_31: 10 } })).success, false);
  });

  it("rejects negative task synergy_bonus", () => {
    assert.equal(TaskDefinitionSchema.safeParse(validTask({ synergy_bonus: -1 })).success, false);
  });

  it("rejects task definitions with no non-trivial scoring inputs", () => {
    assert.equal(TaskDefinitionSchema.safeParse(validTask({ tag_weights: {}, synergy_bonus: 0 })).success, false);
  });

  it("rejects invalid task exclude_officers ids", () => {
    assert.equal(
      TaskDefinitionSchema.safeParse(validTask({ constraints: { exclude_officers: ["Bad Id"] } })).success,
      false,
    );
  });
});
