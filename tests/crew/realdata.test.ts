// T100 real-data validation per specs/004-crew-optimizer/plan.md.
// This suite deliberately loads committed data/crew/ files (not fixtures) to catch
// schema drift between code changes and seed data. Do NOT add CLI-style mutating
// tests here; those belong in skill:roster tests and must use per-test scratch dirs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { formatUnknownOfficerError, loadOfficerDatabase } from "../../src/crew/database.ts";
import { loadRoster, toRosterYaml, validateRosterOfficerIds } from "../../src/crew/roster.ts";
import { loadTaskDefinitions } from "../../src/crew/tasks.ts";

describe("crew real data validation", () => {
  it("validates committed officers, tasks, and demo roster against schemas", async () => {
    const officerDb = await loadOfficerDatabase(path.join(process.cwd(), "data/crew/officers.json"));
    const tasks = await loadTaskDefinitions(path.join(process.cwd(), "data/crew/tasks"));
    const demoRoster = await loadRoster(path.join(process.cwd(), "data/crew/roster/demo.yaml"));

    assert.ok(officerDb.officers.length >= 30);
    assert.ok(tasks.length >= 4);
    assert.equal(demoRoster.account, "demo");
    assert.ok(officerDb.byId.has("kirk"));
    assert.ok(officerDb.byId.has("spock"));

    const known = validateRosterOfficerIds(demoRoster, officerDb);
    assert.equal(known.length, demoRoster.officers.length);
    assert.ok(
      known.some((officer) => officer.bda_role === "either"),
      "demo roster should include at least one 'either' role officer",
    );
  });

  it("round-trips the committed demo roster byte-for-byte", async () => {
    const rosterPath = path.join(process.cwd(), "data/crew/roster/demo.yaml");
    const source = fs.readFileSync(rosterPath, "utf8");
    const roster = await loadRoster(rosterPath);

    assert.equal(toRosterYaml(roster), source);
  });

  it("fails when roster references an unknown officer", async () => {
    const officerDb = await loadOfficerDatabase(path.join(process.cwd(), "data/crew/officers.json"));
    const demoRoster = await loadRoster(path.join(process.cwd(), "data/crew/roster/demo.yaml"));
    const unknown = "definitely-not-real";
    const brokenRoster = {
      ...demoRoster,
      officers: [...demoRoster.officers, { id: unknown, owned: false as const }],
    };

    assert.throws(
      () => validateRosterOfficerIds(brokenRoster, officerDb),
      (err: unknown) => err instanceof Error && err.message === formatUnknownOfficerError(unknown),
    );
  });
});
