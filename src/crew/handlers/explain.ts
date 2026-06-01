import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import {
  formatGroupList,
  formatTags,
  loadOfficerDatabaseForCommand,
  requireAccount,
  type HandlerDeps,
} from "./shared.ts";

export async function handleExplain(command: CrewCommand, deps: HandlerDeps = {}): Promise<string> {
  const account = await requireAccount(command, deps);
  const query = command.args._?.trim();
  if (!query) {
    throw new Error("Usage: !crew explain <officer> --account X");
  }

  const database = await loadOfficerDatabaseForCommand(deps);
  const officer =
    database.byId.get(query) ??
    database.officers.find((candidate) => candidate.name.toLowerCase() === query.toLowerCase());

  if (!officer) {
    throw new Error(`Officer '${query}' not found.`);
  }

  return [
    `**Officer:** ${officer.name} (\`${officer.id}\`) — ${account}`,
    `- Faction: ${officer.faction}`,
    `- Role: ${officer.bda_role}`,
    `- Synergy: ${formatGroupList(officer.synergy_groups)}`,
    `- Captain maneuver: ${officer.captain_maneuver.text} (${formatTags(officer.captain_maneuver.tags)})`,
    `- Officer ability: ${officer.officer_ability.text} (${formatTags(officer.officer_ability.tags)})`,
    `- Rank curve: ${officer.rank_curve}`,
    `- Added: ${officer.added_in_patch}`,
    `- Source: ${officer.source}`,
  ].join("\n");
}
