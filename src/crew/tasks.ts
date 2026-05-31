import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { TaskDefinitionSchema, type TaskDefinition } from "./schemas.ts";

export const DEFAULT_TASK_DIRECTORY = "data/crew/tasks";

export class TaskDefinitionError extends Error {
  override readonly name = "TaskDefinitionError";
}

async function parseTaskFile(filePath: string, expectedId: string): Promise<TaskDefinition> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new TaskDefinitionError(`Could not read task definition ${filePath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    throw new TaskDefinitionError(`Malformed YAML in task definition ${filePath}: ${(err as Error).message}`);
  }

  const validated = TaskDefinitionSchema.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const issuePath = issue?.path.length ? issue.path.join(".") : "(root)";
    throw new TaskDefinitionError(
      `Task schema mismatch in ${filePath} at ${issuePath}: ${issue?.message ?? validated.error.message}`,
    );
  }

  if (validated.data.id !== expectedId) {
    throw new TaskDefinitionError(
      `Task id mismatch in ${filePath}: id '${validated.data.id}' must match filename '${expectedId}'`,
    );
  }

  return validated.data;
}

export async function loadTaskDefinitions(dir: string = DEFAULT_TASK_DIRECTORY): Promise<TaskDefinition[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    throw new TaskDefinitionError(`Could not read task directory ${dir}: ${(err as Error).message}`);
  }

  const taskFiles = entries.filter((name) => name.endsWith(".yaml")).sort();
  return Promise.all(
    taskFiles.map((fileName) => {
      const expectedId = path.basename(fileName, ".yaml");
      const filePath = path.join(dir, fileName);
      return parseTaskFile(filePath, expectedId);
    }),
  );
}

export async function loadTask(id: string, dir: string = DEFAULT_TASK_DIRECTORY): Promise<TaskDefinition> {
  const filePath = path.join(dir, `${id}.yaml`);
  return parseTaskFile(filePath, id);
}
