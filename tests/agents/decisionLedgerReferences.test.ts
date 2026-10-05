import { describe, it } from "node:test";
import {
  assertBackendAwareDecisionsReference,
  assertDecisionsReference,
  readCharter,
} from "./helpers.ts";

describe("Decision ledger references", () => {
  for (const agent of [
    { name: "O'Brien", slug: "obrien" },
    { name: "Fact Checker", slug: "fact-checker" },
  ]) {
    it(`${agent.name} charter follows the backend-aware ledger contract`, () => {
      const charter = readCharter(agent.slug);
      assertDecisionsReference(charter);
      assertBackendAwareDecisionsReference(charter);
    });
  }
});
