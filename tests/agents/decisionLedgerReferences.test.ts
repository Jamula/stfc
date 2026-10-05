import { describe, it } from "node:test";
import { assertDecisionsReference, readCharter } from "./helpers.ts";

describe("Decision ledger references", () => {
  for (const agent of [
    { name: "O'Brien", slug: "obrien" },
    { name: "Fact Checker", slug: "fact-checker" },
  ]) {
    it(`${agent.name} charter references the canonical local ledger`, () => {
      assertDecisionsReference(readCharter(agent.slug));
    });
  }
});
