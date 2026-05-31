import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OfficerDatabaseSchema,
  OfficerSchema,
  RosterEntrySchema,
  RosterSchema,
  TaskDefinitionSchema,
} from "../../src/crew/schemas.ts";

describe("crew schemas", () => {
  it("accepts a valid officer", () => {
    const result = OfficerSchema.safeParse({
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
    });
    assert.equal(result.success, true);
  });

  it("rejects malformed officer cases", () => {
    const badTag = OfficerSchema.safeParse({
      id: "kirk",
      name: "James T. Kirk",
      faction: "federation",
      synergy_groups: ["enterprise_crew"],
      captain_maneuver: { text: "Morale boost.", tags: ["not_a_tag"] },
      officer_ability: { text: "Damage boost.", tags: ["pvp_damage"] },
      bda_role: "captain",
      rank_curve: "back_loaded",
      added_in_patch: "M90",
      source: "x",
    });

    assert.equal(badTag.success, false);

    const badSynergy = OfficerSchema.safeParse({
      id: "kirk",
      name: "James T. Kirk",
      faction: "federation",
      synergy_groups: ["Enterprise Crew"],
      captain_maneuver: { text: "Morale boost.", tags: ["morale_recovery"] },
      officer_ability: { text: "Damage boost.", tags: ["pvp_damage"] },
      bda_role: "captain",
      rank_curve: "back_loaded",
      added_in_patch: "M90",
      source: "x",
    });
    assert.equal(badSynergy.success, false);

    const duplicateTags = OfficerSchema.safeParse({
      id: "kirk",
      name: "James T. Kirk",
      faction: "federation",
      synergy_groups: ["enterprise_crew"],
      captain_maneuver: { text: "Morale boost.", tags: ["morale_recovery", "morale_recovery"] },
      officer_ability: { text: "Damage boost.", tags: ["pvp_damage"] },
      bda_role: "captain",
      rank_curve: "back_loaded",
      added_in_patch: "M90",
      source: "x",
    });
    assert.equal(duplicateTags.success, false);
  });

  it("rejects duplicate officer ids in officer database", () => {
    const duplicateIds = OfficerDatabaseSchema.safeParse([
      {
        id: "kirk",
        name: "James T. Kirk",
        faction: "federation",
        synergy_groups: ["enterprise_crew"],
        captain_maneuver: { text: "Morale boost.", tags: ["morale_recovery"] },
        officer_ability: { text: "Damage boost.", tags: ["pvp_damage"] },
        bda_role: "captain",
        rank_curve: "back_loaded",
        added_in_patch: "M90",
        source: "x",
      },
      {
        id: "kirk",
        name: "Alt Kirk",
        faction: "federation",
        synergy_groups: ["enterprise_crew"],
        captain_maneuver: { text: "Morale boost.", tags: ["morale_recovery"] },
        officer_ability: { text: "Damage boost.", tags: ["pvp_damage"] },
        bda_role: "captain",
        rank_curve: "back_loaded",
        added_in_patch: "M90",
        source: "x",
      },
    ]);
    assert.equal(duplicateIds.success, false);
  });

  it("accepts and rejects roster entry discriminated union correctly", () => {
    const owned = RosterEntrySchema.safeParse({
      id: "kirk",
      owned: true,
      level: 50,
      rank: 3,
      promotions: 2,
    });
    assert.equal(owned.success, true);

    const missingOwnedFields = RosterEntrySchema.safeParse({
      id: "kirk",
      owned: true,
    });
    assert.equal(missingOwnedFields.success, false);

    const extraUnownedField = RosterEntrySchema.safeParse({
      id: "kirk",
      owned: false,
      level: 1,
    });
    assert.equal(extraUnownedField.success, false);
  });

  it("validates task schema and rejects malformed task cases", () => {
    const validTask = TaskDefinitionSchema.safeParse({
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
    });
    assert.equal(validTask.success, true);

    const badTagKey = TaskDefinitionSchema.safeParse({
      id: "mining-g3",
      name: "G3 Mining Run",
      description: "Mining test",
      slots: {
        captain: { bda_role: "captain" },
        officer_a: { bda_role: "officer" },
        officer_b: { bda_role: "officer" },
      },
      tag_weights: { nope: 10 },
      synergy_bonus: 0,
      constraints: { exclude_officers: [] },
    });
    assert.equal(badTagKey.success, false);

    const trivialScoring = TaskDefinitionSchema.safeParse({
      id: "mining-g3",
      name: "G3 Mining Run",
      description: "Mining test",
      slots: {
        captain: { bda_role: "captain" },
        officer_a: { bda_role: "officer" },
        officer_b: { bda_role: "officer" },
      },
      tag_weights: {},
      synergy_bonus: 0,
      constraints: { exclude_officers: [] },
    });
    assert.equal(trivialScoring.success, false);

    const badSlots = TaskDefinitionSchema.safeParse({
      id: "mining-g3",
      name: "G3 Mining Run",
      description: "Mining test",
      slots: {
        captain: { bda_role: "officer" },
        officer_a: { bda_role: "captain" },
        officer_b: { bda_role: "captain" },
      },
      tag_weights: { mining_rate: 10 },
      synergy_bonus: 1,
      constraints: { exclude_officers: [] },
    });
    assert.equal(badSlots.success, false);
  });

  it("rejects duplicate roster ids and bad staleness thresholds", () => {
    const duplicateRoster = RosterSchema.safeParse({
      account: "demo",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [
        { id: "kirk", owned: false },
        { id: "kirk", owned: false },
      ],
    });
    assert.equal(duplicateRoster.success, false);

    const badStaleness = RosterSchema.safeParse({
      account: "demo",
      last_updated: "2026-05-31T20:25:00Z",
      staleness_overrides: { warn: 14, error: 7 },
      officers: [{ id: "kirk", owned: false }],
    });
    assert.equal(badStaleness.success, false);
  });
});
