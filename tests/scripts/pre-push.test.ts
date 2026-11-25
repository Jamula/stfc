/**
 * Tests for the pre-push rebase guard (scripts/pre-push.mjs).
 *
 * Validates the exported helper functions that determine whether
 * a push targets main and drive the rebase logic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { isPushToMain } = await import("../../scripts/pre-push.mjs");

/* ── isPushToMain ──────────────────────────────────────────────────── */

describe("isPushToMain", () => {
  it("returns true when remote ref is refs/heads/main", () => {
    const stdin =
      "refs/heads/main abc123 refs/heads/main def456\n";
    assert.equal(isPushToMain(stdin), true);
  });

  it("returns true when one of several lines targets main", () => {
    const stdin = [
      "refs/heads/feat abc123 refs/heads/feat def456",
      "refs/heads/main 111111 refs/heads/main 222222",
    ].join("\n");
    assert.equal(isPushToMain(stdin), true);
  });

  it("returns false for a feature branch push", () => {
    const stdin =
      "refs/heads/feature/11-prepush abc123 refs/heads/feature/11-prepush def456\n";
    assert.equal(isPushToMain(stdin), false);
  });

  it("returns false for empty stdin", () => {
    assert.equal(isPushToMain(""), false);
  });

  it("returns false when ref contains main as substring", () => {
    const stdin =
      "refs/heads/main-fix abc123 refs/heads/main-fix def456\n";
    assert.equal(isPushToMain(stdin), false);
  });

  it("handles trailing newlines gracefully", () => {
    const stdin =
      "refs/heads/main abc123 refs/heads/main def456\n\n\n";
    assert.equal(isPushToMain(stdin), true);
  });
});
