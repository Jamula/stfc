import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { formatUnknownOfficerError, loadOfficerDatabase } from "../../src/crew/database.ts";
import { loadRoster, validateRosterOfficerIds } from "../../src/crew/roster.ts";
import { loadTaskDefinitions } from "../../src/crew/tasks.ts";

describe("crew real data validation", () => {
  it("validates committed officers, tasks, and example roster against schemas", async () => {
    const officerDb = await loadOfficerDatabase(path.join(process.cwd(), "data/crew/officers.json"));
    const tasks = await loadTaskDefinitions(path.join(process.cwd(), "data/crew/tasks"));
    const exampleRoster = await loadRoster(path.join(process.cwd(), "data/crew/roster/example.yaml"));

    assert.ok(officerDb.officers.length >= 30);
    assert.ok(tasks.length >= 4);
    assert.equal(exampleRoster.account, "demo");
    assert.ok(officerDb.byId.has("kirk"));
    assert.ok(officerDb.byId.has("spock"));

    const known = validateRosterOfficerIds(exampleRoster, officerDb);
    assert.equal(known.length, exampleRoster.officers.length);
    assert.ok(
      known.some((officer) => officer.bda_role === "either"),
      "example roster should include at least one 'either' role officer",
    );
  });

  it("fails when roster references an unknown officer", async () => {
    const officerDb = await loadOfficerDatabase(path.join(process.cwd(), "data/crew/officers.json"));
    const exampleRoster = await loadRoster(path.join(process.cwd(), "data/crew/roster/example.yaml"));
    const unknown = "definitely-not-real";
    const brokenRoster = {
      ...exampleRoster,
      officers: [...exampleRoster.officers, { id: unknown, owned: false as const }],
    };

    assert.throws(
      () => validateRosterOfficerIds(brokenRoster, officerDb),
      (err: unknown) => err instanceof Error && err.message === formatUnknownOfficerError(unknown),
    );
  });
});
