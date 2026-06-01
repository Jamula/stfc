import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import {
  loadOfficerDatabaseForCommand,
  requireAccount,
  type HandlerDeps,
} from "./shared.ts";

const SNAKE_CASE_GROUP = /^[a-z0-9]+(?:_[a-z0-9]+)*$/i;

export async function handleSynergy(command: CrewCommand, deps: HandlerDeps = {}): Promise<string> {
  const account = await requireAccount(command, deps);
  const input = command.args._?.trim();
  if (!input || !SNAKE_CASE_GROUP.test(input)) {
    throw new Error("Usage: !crew synergy <snake_case_group> --account X");
  }

  const normalized = input.toLowerCase();
  const database = await loadOfficerDatabaseForCommand(deps);
  const canonicalGroup =
    [...new Set(database.officers.flatMap((officer) => officer.synergy_groups))]
      .sort((a, b) => a.localeCompare(b))
      .find((group) => group.toLowerCase() === normalized) ?? normalized;
  const members = database.officers
    .filter((officer) => officer.synergy_groups.some((group) => group.toLowerCase() === normalized))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (members.length === 0) {
    return `**Synergy:** \`${canonicalGroup}\` — ${account}\n0 members found.`;
  }

  return [
    `**Synergy:** \`${canonicalGroup}\` — ${account}`,
    `Members (${members.length}):`,
    ...members.map((officer) => `- ${officer.name} (\`${officer.id}\`) — ${officer.faction}, ${officer.bda_role}`),
  ].join("\n");
}
