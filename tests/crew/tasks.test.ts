import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadTask, loadTaskDefinitions, TaskDefinitionError } from "../../src/crew/tasks.ts";

const tinyTaskDir = path.join(process.cwd(), "tests/crew/fixtures/tiny-tasks");

function validTaskYaml(overrides: string[] = []): string {
  const lines = [
    "id: broken",
    "name: Broken Task",
    "description: Exercises loader validation.",
    "slots:",
    "  captain:",
    "    bda_role: captain",
    "  officer_a:",
    "    bda_role: officer",
    "  officer_b:",
    "    bda_role: officer",
    "tag_weights:",
    "  mining_rate: 10",
    "synergy_bonus: 1",
    "constraints:",
    "  exclude_officers: []",
    "",
  ];
  return [...lines, ...overrides].join("\n");
}

describe("crew tasks", () => {
  it("loads all task definitions from a directory", async () => {
    const tasks = await loadTaskDefinitions(tinyTaskDir);
    assert.equal(tasks.length, 4);
    assert.deepEqual(
      tasks.map((task) => task.id),
      ["armada-25", "hostile-grind", "mining-g3", "station-defense"],
    );
  });

  it("loads a single task by id", async () => {
    const task = await loadTask("mining-g3", tinyTaskDir);
    assert.equal(task.name, "Tiny G3 Mining");
  });

  it("reports file path and zod path for invalid tag_weights keys", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-task-"));
    try {
      const badPath = path.join(dir, "broken.yaml");
      fs.writeFileSync(
        badPath,
        validTaskYaml().replace("  mining_rate: 10", "  not_a_tag: 10"),
        "utf8",
      );

      await assert.rejects(
        () => loadTask("broken", dir),
        (err: unknown) =>
          err instanceof TaskDefinitionError &&
          err.message.includes(badPath) &&
          err.message.includes("tag_weights.not_a_tag"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports file path and zod path for missing slots", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-task-"));
    try {
      const badPath = path.join(dir, "broken.yaml");
      fs.writeFileSync(
        badPath,
        [
          "id: broken",
          "name: Broken Task",
          "description: Exercises loader validation.",
          "tag_weights:",
          "  mining_rate: 10",
          "synergy_bonus: 1",
          "constraints:",
          "  exclude_officers: []",
          "",
        ].join("\n"),
        "utf8",
      );

      await assert.rejects(
        () => loadTask("broken", dir),
        (err: unknown) =>
          err instanceof TaskDefinitionError && err.message.includes(badPath) && err.message.includes("slots"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects id mismatch between YAML body and filename", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-task-"));
    try {
      const badPath = path.join(dir, "armada-25.yaml");
      fs.writeFileSync(
        badPath,
        [
          "id: station-defense",
          "name: Broken",
          "description: mismatch",
          "slots:",
          "  captain:",
          "    bda_role: captain",
          "  officer_a:",
          "    bda_role: officer",
          "  officer_b:",
          "    bda_role: officer",
          "tag_weights:",
          "  station_defense: 4",
          "synergy_bonus: 1",
          "constraints:",
          "  exclude_officers: []",
          "",
        ].join("\n"),
        "utf8",
      );

      await assert.rejects(() => loadTask("armada-25", dir), /must match filename 'armada-25'/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws read error for missing task file", async () => {
    await assert.rejects(
      () => loadTask("missing-task", tinyTaskDir),
      /Could not read task definition/,
    );
  });

  it("rejects malformed task YAML", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-task-"));
    try {
      const badPath = path.join(dir, "mining-g3.yaml");
      fs.writeFileSync(badPath, "id: [unclosed", "utf8");

      await assert.rejects(
        () => loadTask("mining-g3", dir),
        /Malformed YAML in task definition/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws read error when task directory is missing", async () => {
    await assert.rejects(
      () => loadTaskDefinitions(path.join(process.cwd(), "tests/crew/fixtures/no-task-dir")),
      /Could not read task directory/,
    );
  });
});
