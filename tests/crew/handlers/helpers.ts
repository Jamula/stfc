import type { CrewCommand } from "../../../src/discord/crewCommandParser.ts";
import type { DiscordMessage } from "../../../src/discord/schemas.ts";
import type { OfficerDatabase } from "../../../src/crew/database.ts";
import type { HandlerDeps } from "../../../src/crew/handlers/shared.ts";
import type { Officer, Roster, TaskDefinition } from "../../../src/crew/schemas.ts";

const CHANNEL_ID = "111111111111111111";
const GUILD_ID = "509679626763632640";
const USER_ID = "333333333333333333";

export const tinyOfficers: Officer[] = [
  {
    id: "kirk",
    name: "James T. Kirk",
    faction: "federation",
    synergy_groups: ["enterprise_crew"],
    captain_maneuver: { text: "Morale grants crew-wide offensive momentum.", tags: ["morale_recovery", "pvp_damage"] },
    officer_ability: { text: "Raises group damage while morale is active.", tags: ["pvp_damage"] },
    bda_role: "captain",
    rank_curve: "back_loaded",
    added_in_patch: "M90",
    source: "fixture",
  },
  {
    id: "chen",
    name: "Cadet Chen",
    faction: "federation",
    synergy_groups: ["hostile_grind_early", "cadet_crew"],
    captain_maneuver: { text: "Mitigates hostile energy-weapon pressure.", tags: ["hostile_mitigation"] },
    officer_ability: { text: "Bridge survivability bonus against hostiles.", tags: ["hostile_mitigation"] },
    bda_role: "officer",
    rank_curve: "linear",
    added_in_patch: "M90",
    source: "fixture",
  },
  {
    id: "spock",
    name: "Spock",
    faction: "federation",
    synergy_groups: ["enterprise_crew"],
    captain_maneuver: { text: "Reinforces shields and tactical consistency.", tags: ["pvp_mitigation", "morale_recovery"] },
    officer_ability: { text: "Improves bridge performance and defense.", tags: ["pvp_mitigation"] },
    bda_role: "either",
    rank_curve: "front_loaded",
    added_in_patch: "M90",
    source: "fixture",
  },
];

export const tinyRoster: Roster = {
  account: "tiny",
  last_updated: "2026-05-31T20:25:00Z",
  officers: [
    { id: "kirk", owned: true, level: 60, rank: 4, promotions: 3 },
    { id: "chen", owned: true, level: 28, rank: 2, promotions: 1 },
    { id: "spock", owned: false },
  ],
};

export const tinyTasks: TaskDefinition[] = [
  {
    id: "hostile-grind",
    name: "Hostile Grind",
    description: "Clear hostiles efficiently.",
    slots: { captain: { bda_role: "captain" }, officer_a: { bda_role: "officer" }, officer_b: { bda_role: "officer" } },
    tag_weights: { hostile_crit: 4, hostile_mitigation: 3 },
    synergy_bonus: 2,
    constraints: { exclude_officers: [] },
  },
  {
    id: "mining-g3",
    name: "G3 Mining",
    description: "Mine grade 3 materials.",
    slots: { captain: { bda_role: "captain" }, officer_a: { bda_role: "officer" }, officer_b: { bda_role: "officer" } },
    tag_weights: { mining_rate: 5, cargo_capacity: 2 },
    synergy_bonus: 1,
    constraints: { exclude_officers: [] },
  },
];

export function makeDatabase(officers: Officer[] = tinyOfficers): OfficerDatabase {
  const byId = new Map(officers.map((officer) => [officer.id, officer]));
  return {
    officers,
    byId,
    getOfficerById: (officerId: string) => {
      const officer = byId.get(officerId);
      if (!officer) throw new Error(`missing ${officerId}`);
      return officer;
    },
  };
}

export function makeDeps(overrides: HandlerDeps = {}): HandlerDeps {
  return {
    discoverRosterAccounts: async () => ["alt", "tiny"],
    loadOfficerDatabase: async () => makeDatabase(),
    loadRoster: async () => tinyRoster,
    loadTaskDefinitions: async () => tinyTasks,
    ...overrides,
  };
}

export function makeCommand(subcommand: string, args: Record<string, string> = {}): CrewCommand {
  return {
    subcommand,
    args,
    raw: `!crew ${subcommand}`,
    message: makeMessage(`!crew ${subcommand}`),
  };
}

export function makeMessage(content: string, overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: overrides.id ?? "444444444444444444",
    guild_id: overrides.guild_id ?? GUILD_ID,
    channel_id: overrides.channel_id ?? CHANNEL_ID,
    content,
    timestamp: overrides.timestamp ?? "2026-06-01T04:10:00Z",
    edited_timestamp: null,
    author: overrides.author ?? {
      id: USER_ID,
      username: "tester",
      bot: false,
    },
    type: 0,
  };
}

export const commandAllowlist = [
  { guild_id: GUILD_ID, channel_id: CHANNEL_ID, account: "tiny", notes: "test" },
];
