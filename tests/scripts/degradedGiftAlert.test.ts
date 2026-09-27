import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEGRADED_ALERT_LABELS,
  DEGRADED_ALERT_TITLE,
  PERSISTENT_TRANSIENT_RUNS,
  parseDegradedState,
  syncDegradedGiftAlert,
} from "../../scripts/degraded-gift-alert.mjs";

const repeatedGift = {
  version: 2,
  accounts: {
    accountHash: {
      "771": { streak: PERSISTENT_TRANSIENT_RUNS, title: "30 Day Loyalty Chest" },
    },
  },
};

describe("degraded-gift-alert", () => {
  it("only selects failures that persisted for the configured run threshold", () => {
    assert.deepEqual(
      parseDegradedState(
        JSON.stringify({
          version: 1,
          accounts: {
            one: { transient: 1, persistent: 3 },
            two: { alsoPersistent: 4 },
          },
        }),
      ),
      [
        { gift: "persistent", streak: 3 },
        { gift: "alsoPersistent", streak: 4 },
      ],
    );
  });

  it("keeps duplicate gift titles separate by bundle identifier", () => {
    assert.deepEqual(
      parseDegradedState(
        JSON.stringify({
          version: 2,
          accounts: {
            one: {
              "771": { streak: PERSISTENT_TRANSIENT_RUNS, title: "Loyalty Chest" },
              "772": { streak: PERSISTENT_TRANSIENT_RUNS, title: "Loyalty Chest" },
            },
          },
        }),
      ),
      [
        { gift: "Loyalty Chest", giftId: "771", streak: PERSISTENT_TRANSIENT_RUNS },
        { gift: "Loyalty Chest", giftId: "772", streak: PERSISTENT_TRANSIENT_RUNS },
      ],
    );
  });

  it("rejects malformed persisted state instead of treating it as recovery", () => {
    assert.throws(() => parseDegradedState("{}"), /invalid state file shape/);
    assert.throws(
      () => parseDegradedState(JSON.stringify({ version: 1, accounts: { one: { gift: 0 } } })),
      /positive integers/,
    );
  });

  it("does not alert for a transient streak below threshold", () => {
    const calls: string[] = [];
    const result = syncDegradedGiftAlert({
      state: { version: 1, accounts: { accountHash: { gift: PERSISTENT_TRANSIENT_RUNS - 1 } } },
      listIssues: () => {
        calls.push("lookup");
        return [];
      },
      createIssue: () => calls.push("create"),
      closeIssue: () => calls.push("close"),
      log: () => {},
    });

    assert.deepEqual(result, { status: "none", persistentCount: 0 });
    assert.deepEqual(calls, ["lookup"]);
  });

  it("creates one exact issue after the threshold and refreshes an existing alert", () => {
    const calls: Array<{ title: string; labels: readonly string[]; body: string }> = [];
    const updates: Array<{ number: number; body: string }> = [];
    const created = syncDegradedGiftAlert({
      state: repeatedGift,
      runUrl: "https://github.com/Jamula/stfc/actions/runs/10",
      listIssues: (title) => {
        assert.equal(title, DEGRADED_ALERT_TITLE);
        return [];
      },
      createIssue: (title, labels, body) => calls.push({ title, labels, body }),
      log: () => {},
    });
    const alreadyOpen = syncDegradedGiftAlert({
      state: {
        version: 2,
        accounts: {
          accountHash: {
            "772": { streak: PERSISTENT_TRANSIENT_RUNS + 1, title: "Localized Loyalty Chest" },
          },
        },
      },
      runUrl: "https://github.com/Jamula/stfc/actions/runs/12",
      listIssues: () => [{ number: 42, title: DEGRADED_ALERT_TITLE, labels: DEGRADED_ALERT_LABELS }],
      createIssue: () => assert.fail("an existing alert must not be duplicated"),
      updateIssue: (number, body) => updates.push({ number, body }),
      log: () => {},
    });

    assert.equal(created.status, "created");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.title, DEGRADED_ALERT_TITLE);
    assert.deepEqual(calls[0]!.labels, DEGRADED_ALERT_LABELS);
    assert.match(calls[0]!.body, /30 Day Loyalty Chest \(bundle 771\) — 3 consecutive runs/);
    assert.match(calls[0]!.body, /actions\/runs\/10/);
    assert.equal(alreadyOpen.status, "already-open");
    assert.equal(alreadyOpen.number, 42);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]!.number, 42);
    assert.match(updates[0]!.body, /Localized Loyalty Chest \(bundle 772\) — 4 consecutive runs/);
    assert.match(updates[0]!.body, /actions\/runs\/12/);
  });

  it("auto-resolves the alert when no gift remains persistently degraded", () => {
    const closeCalls: Array<{ number: number; comment: string }> = [];
    const result = syncDegradedGiftAlert({
      state: { version: 1, accounts: {} },
      runUrl: "https://github.com/Jamula/stfc/actions/runs/11",
      listIssues: () => [{ number: 42, title: DEGRADED_ALERT_TITLE, labels: DEGRADED_ALERT_LABELS }],
      closeIssue: (number, comment) => closeCalls.push({ number, comment }),
      log: () => {},
    });

    assert.equal(result.status, "resolved");
    assert.deepEqual(closeCalls, [
      {
        number: 42,
        comment: "No gift claim failure has persisted for 3 consecutive runs as of https://github.com/Jamula/stfc/actions/runs/11 — closing automatically.",
      },
    ]);
  });

  it("keeps lookup failures visible but non-fatal", () => {
    const lines: string[] = [];
    let created = false;
    const result = syncDegradedGiftAlert({
      state: repeatedGift,
      listIssues: () => {
        throw new Error("API unavailable");
      },
      createIssue: () => {
        created = true;
      },
      log: (line) => lines.push(line),
    });

    assert.equal(result.status, "lookup-failed");
    assert.equal(created, false);
    assert.match(lines.join("\n"), /::warning::Persistent degraded-gift alert lookup failed/);
  });

  it("keeps alert update failures visible but non-fatal", () => {
    const lines: string[] = [];
    const result = syncDegradedGiftAlert({
      state: repeatedGift,
      listIssues: () => [{ number: 42, title: DEGRADED_ALERT_TITLE, labels: DEGRADED_ALERT_LABELS }],
      updateIssue: () => {
        throw new Error("API unavailable");
      },
      log: (line) => lines.push(line),
    });

    assert.deepEqual(result, { status: "update-failed", number: 42, persistentCount: 1 });
    assert.match(lines.join("\n"), /::warning::Persistent degraded-gift alert could not be updated/);
  });
});
