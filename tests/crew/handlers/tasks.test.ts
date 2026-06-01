import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleTasks } from "../../../src/crew/handlers/tasks.ts";
import { makeCommand, makeDeps } from "./helpers.ts";

describe("crew tasks handler", () => {
  it("lists known task definitions for the account", async () => {
    const output = await handleTasks(makeCommand("tasks", { account: "tiny" }), makeDeps());

    assert.match(output, /^\*\*Crew tasks for `tiny`\*\*/);
    assert.match(output, /- `hostile-grind` — Hostile Grind: Clear hostiles efficiently\./);
    assert.match(output, /- `mining-g3` — G3 Mining: Mine grade 3 materials\./);
  });

  it("requires an explicit account", async () => {
    await assert.rejects(
      () => handleTasks(makeCommand("tasks"), makeDeps()),
      /--account required\. Available: alt, tiny\./,
    );
  });

  it("renders an empty task-directory fallback", async () => {
    const output = await handleTasks(
      makeCommand("tasks", { account: "tiny" }),
      makeDeps({ loadTaskDefinitions: async () => [] }),
    );

    assert.equal(output, "No crew tasks found for `tiny`.");
  });

  it("surfaces task loader failures to the dispatcher", async () => {
    await assert.rejects(
      () =>
        handleTasks(
          makeCommand("tasks", { account: "tiny" }),
          makeDeps({ loadTaskDefinitions: async () => { throw new Error("task directory missing"); } }),
        ),
      /task directory missing/,
    );
  });
});
