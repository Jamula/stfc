import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  assertBackendAwareDecisionsReference,
  assertDecisionsReference,
  readCharter,
} from "./helpers.ts";

describe("Decision ledger references", () => {
  it("charter template follows the backend-aware ledger contract", () => {
    const template = readFileSync(
      resolve(process.cwd(), ".squad/templates/charter.md"),
      "utf-8",
    )
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/\s+/g, " ");

    assert.match(
      template,
      /logical state key decisions\/decisions\.md with squad_state_read when state tools are available/,
    );
    assert.match(
      template,
      /if that key is unavailable or not found, read \.squad\/decisions\/decisions\.md only for local\/worktree backends/,
    );
    assert.match(
      template,
      /for orphan, two-layer, or git-notes backends, do not fall back to a checkout snapshot; follow the state-backend handshake and report a missing bridge/,
    );
  });

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
