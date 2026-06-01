import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import {
  loadTaskDefinitionsForCommand,
  requireAccount,
  type HandlerDeps,
} from "./shared.ts";

export async function handleTasks(command: CrewCommand, deps: HandlerDeps = {}): Promise<string> {
  const account = await requireAccount(command, deps);
  const tasks = (await loadTaskDefinitionsForCommand(deps)).sort((a, b) => a.id.localeCompare(b.id));

  if (tasks.length === 0) {
    return `No crew tasks found for \`${account}\`.`;
  }

  return [
    `**Crew tasks for \`${account}\`**`,
    ...tasks.map((task) => `- \`${task.id}\` — ${task.name}: ${task.description}`),
  ].join("\n");
}
