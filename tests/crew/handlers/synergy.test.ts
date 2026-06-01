import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSynergy } from "../../../src/crew/handlers/synergy.ts";
import { makeCommand, makeDeps } from "./helpers.ts";

describe("crew synergy handler", () => {
  it("renders exact case-insensitive snake_case group membership", async () => {
    const output = await handleSynergy(
      makeCommand("synergy", { _: "ENTERPRISE_CREW", _0: "ENTERPRISE_CREW", account: "tiny" }),
      makeDeps(),
    );

    assert.match(output, /\*\*Synergy:\*\* `enterprise_crew` — tiny/);
    assert.match(output, /Members \(2\):/);
    assert.match(output, /James T\. Kirk \(`kirk`\)/);
    assert.match(output, /Spock \(`spock`\)/);
  });

  it("returns a zero-member fallback for a valid missing group", async () => {
    const output = await handleSynergy(
      makeCommand("synergy", { _: "unknown_group", _0: "unknown_group", account: "tiny" }),
      makeDeps(),
    );

    assert.equal(output, "**Synergy:** `unknown_group` — tiny\n0 members found.");
  });

  it("rejects non-snake_case group names", async () => {
    await assert.rejects(
      () => handleSynergy(makeCommand("synergy", { _: "enterprise crew", _0: "enterprise", account: "tiny" }), makeDeps()),
      /Usage: !crew synergy <snake_case_group> --account X/,
    );
  });

  it("requires an explicit account", async () => {
    await assert.rejects(
      () => handleSynergy(makeCommand("synergy", { _: "enterprise_crew", _0: "enterprise_crew" }), makeDeps()),
      /--account required\. Available: alt, tiny\./,
    );
  });
});
