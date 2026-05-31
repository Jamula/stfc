import { promises as fs } from "node:fs";
import { OfficerDatabaseSchema, type Officer } from "./schemas.ts";

export const DEFAULT_OFFICER_DATABASE_PATH = "data/crew/officers.json";

const UNKNOWN_OFFICER_TEMPLATE =
  "ERROR: roster references officer '%s' which is not in data/crew/officers.json. " +
  "Add the officer (PR welcomed) or remove it from the roster.";

export class OfficerDatabaseError extends Error {
  override readonly name = "OfficerDatabaseError";
}

export interface OfficerDatabase {
  officers: Officer[];
  byId: ReadonlyMap<string, Officer>;
  getOfficerById: (officerId: string) => Officer;
}

export function formatUnknownOfficerError(officerId: string): string {
  return UNKNOWN_OFFICER_TEMPLATE.replace("%s", officerId);
}

export function requireKnownOfficerId(
  database: Pick<OfficerDatabase, "byId">,
  officerId: string,
): Officer {
  const officer = database.byId.get(officerId);
  if (!officer) {
    throw new OfficerDatabaseError(formatUnknownOfficerError(officerId));
  }
  return officer;
}

export async function loadOfficerDatabase(
  filePath: string = DEFAULT_OFFICER_DATABASE_PATH,
): Promise<OfficerDatabase> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new OfficerDatabaseError(
      `Could not read officer database ${filePath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new OfficerDatabaseError(
      `Malformed JSON in officer database ${filePath}: ${(err as Error).message}`,
    );
  }

  const validated = OfficerDatabaseSchema.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const issuePath = issue?.path.length ? issue.path.join(".") : "(root)";
    const issueMessage = issue?.message ?? validated.error.message;
    throw new OfficerDatabaseError(
      `Officer database schema mismatch in ${filePath} at ${issuePath}: ${issueMessage}`,
    );
  }

  const officers = validated.data;
  const byId = new Map<string, Officer>();
  for (const officer of officers) {
    byId.set(officer.id, officer);
  }

  return {
    officers,
    byId,
    getOfficerById: (officerId: string) => requireKnownOfficerId({ byId }, officerId),
  };
}
