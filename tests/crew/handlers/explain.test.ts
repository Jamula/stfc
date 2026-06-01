import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleExplain } from "../../../src/crew/handlers/explain.ts";
import { makeCommand, makeDeps } from "./helpers.ts";

describe("crew explain handler", () => {
  it("renders an officer detail card by id", async () => {
    const output = await handleExplain(makeCommand("explain", { _: "kirk", _0: "kirk", account: "tiny" }), makeDeps());

    assert.match(output, /^\*\*Officer:\*\* James T\. Kirk \(`kirk`\) — tiny/m);
    assert.match(output, /Captain maneuver: Morale grants crew-wide offensive momentum/);
    assert.match(output, /Officer ability: Raises group damage while morale is active/);
    assert.match(output, /Synergy: `enterprise_crew`/);
  });

  it("falls back to a case-insensitive name match", async () => {
    const output = await handleExplain(makeCommand("explain", { _: "spock", _0: "spock", account: "tiny" }), makeDeps());

    assert.match(output, /\*\*Officer:\*\* Spock \(`spock`\)/);
  });

  it("requires an explicit account and lists discovered roster files", async () => {
    await assert.rejects(
      () => handleExplain(makeCommand("explain", { _: "kirk", _0: "kirk" }), makeDeps()),
      /--account required\. Available: alt, tiny\./,
    );
  });

  it("reports a missing officer", async () => {
    await assert.rejects(
      () => handleExplain(makeCommand("explain", { _: "bones", _0: "bones", account: "tiny" }), makeDeps()),
      /Officer 'bones' not found\./,
    );
  });
});
