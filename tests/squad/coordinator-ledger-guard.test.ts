import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const skillPath = ".squad/templates/skills/coordinator-source-of-truth/SKILL.md";

function assertLedgerGuard(content: string): void {
  const ledger = content.split(/\r?\n/).find((line) => line.startsWith("| `decisions.md` (state key) |"));
  assert.ok(ledger, `${skillPath}: missing decision ledger row`);
  assert.match(ledger, /runtime-owned.*do not assume an on-disk path/i);
  assert.match(ledger, /No writes until cross-process serialization is verified/i);
  assert.match(content, /Do not consolidate, rewrite, or append to the decision ledger until cross-process serialization is verified/i);
  assert.match(content, /Retain all inbox entries; do not delete them/i);
  assert.match(content, /Create proposals as unique inbox entries through `squad_state_create_if_absent`/i);
  assert.doesNotMatch(content, /authorized specialist.{0,80}(?:append|records? accepted decisions)/i);
}

test("source-of-truth skill blocks ledger writes and retains inbox entries", () => {
  const content = readFileSync(skillPath, "utf8");
  assertLedgerGuard(content);

  const unsafeWriter = content.replace(
    "No writes until cross-process serialization is verified",
    "Authorized specialist — append only through the state bridge",
  );
  assert.notEqual(unsafeWriter, content);
  assert.throws(() => assertLedgerGuard(unsafeWriter));

  const unsafeInbox = content.replace("Retain all inbox entries; do not delete them", "Delete inbox entries after consolidation");
  assert.notEqual(unsafeInbox, content);
  assert.throws(() => assertLedgerGuard(unsafeInbox));
});
