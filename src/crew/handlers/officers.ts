import type { RosterEntry } from "../schemas.ts";
import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import {
  formatGroupList,
  isFlagEnabled,
  loadOfficerDatabaseForCommand,
  loadRosterForCommand,
  requireAccount,
  truncateLines,
  type HandlerDeps,
} from "./shared.ts";

export async function handleOfficers(command: CrewCommand, deps: HandlerDeps = {}): Promise<string> {
  const account = await requireAccount(command, deps);
  const database = await loadOfficerDatabaseForCommand(deps);
  const roster = await loadRosterForCommand(account, deps);
  const rosterById = new Map(roster.officers.map((entry) => [entry.id, entry]));
  const ownedOnly = isFlagEnabled(command.args.owned);
  const faction = command.args.faction?.trim().toLowerCase();

  const officers = database.officers
    .filter((officer) => !ownedOnly || rosterById.get(officer.id)?.owned === true)
    .filter((officer) => faction === undefined || officer.faction.toLowerCase() === faction)
    .sort((a, b) => a.id.localeCompare(b.id));

  const filters = [
    `account \`${account}\``,
    ownedOnly ? "owned only" : undefined,
    faction ? `faction \`${faction}\`` : undefined,
  ].filter((value): value is string => value !== undefined);
  const heading = `**Officers** (${officers.length}) — ${filters.join(", ")}`;

  if (officers.length === 0) {
    return `${heading}\nNo officers found.`;
  }

  const lines = officers.map((officer) => {
    const rosterEntry = rosterById.get(officer.id);
    return `- ${officer.name} (\`${officer.id}\`) — ${officer.faction}, ${officer.bda_role}; ${formatRosterState(
      rosterEntry,
    )}; synergy ${formatGroupList(officer.synergy_groups)}`;
  });

  return truncateLines(heading, lines);
}

function formatRosterState(entry: RosterEntry | undefined): string {
  if (!entry) return "not in roster";
  if (!entry.owned) return "unowned";
  return `owned L${entry.level} R${entry.rank} P${entry.promotions}`;
}
