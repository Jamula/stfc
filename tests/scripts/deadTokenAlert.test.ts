// Executable behaviour tests for scripts/dead-token-alert.mjs.
//
// The previous version of this coverage only regex-matched YAML substrings in
// .github/workflows/redeem.yml, which cannot distinguish a correct predicate
// from a semantically broken one that happens to contain the same text (and
// cannot see a single `gh issue close` sitting inside a loop). These tests run
// the real selection and close path against fixture `gh issue list --json
// number,title,labels` output with `gh` stubbed, so the invariants that matter
// are proven rather than pinned:
//
//   - an unrelated issue can never be closed,
//   - an issue with the right title but missing a required label is not the alert,
//   - at most ONE issue is ever closed, and it is the oldest exact match,
//   - lookup/close failure is non-fatal, so cleanup cannot fail a run that
//     already claimed gifts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const TITLE = "STFC token rejected — redemption is stopped until STFC_ACCOUNTS is refreshed";
const REQUIRED = ["bug", "priority:p1"];

const mod = await import("../../scripts/dead-token-alert.mjs");
const { parseIssues, selectAlertIssues, findAlertIssue, resolveDeadTokenAlert } = mod;

/** Shape returned by `gh issue list --json number,title,labels`. */
function issue(
  number: number,
  title: string,
  labels: string[],
): { number: number; title: string; labels: Array<{ name: string }> } {
  return { number, title, labels: labels.map((name) => ({ name })) };
}

// Fixture: a realistic open-issue list. Only #101 and #140 are the alert.
const FIXTURE = [
  // Decoy: a retro issue that *quotes* the alert title. `gh --search` is
  // fuzzy, so this really does come back from the API.
  issue(88, `Retro: why did "${TITLE}" go unnoticed for 11 days?`, ["bug", "priority:p1"]),
  // Decoy: exact title, but only one of the two required labels.
  issue(95, TITLE, ["bug"]),
  // Real alert, oldest. Carries extra mutable squad:* labels — identity is a
  // superset test, so reassignment must not orphan the alert.
  issue(101, TITLE, ["squad", "squad:uhura", "bug", "priority:p1"]),
  // Decoy: unrelated issue that carries both required labels.
  issue(120, "Redeem workflow push retries are unbounded", ["bug", "priority:p1"]),
  // Real alert, duplicate filed later.
  issue(140, TITLE, ["bug", "priority:p1", "squad"]),
];

function recorder(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

function closeRecorder(): {
  calls: Array<{ number: number; comment: string }>;
  closeIssue: (number: number, comment: string) => void;
} {
  const calls: Array<{ number: number; comment: string }> = [];
  return { calls, closeIssue: (number, comment) => calls.push({ number, comment }) };
}

describe("dead-token-alert — selection", () => {
  it("returns nothing when no issue matches", () => {
    const matches = selectAlertIssues(
      [issue(120, "Redeem workflow push retries are unbounded", REQUIRED)],
      { title: TITLE, requiredLabels: REQUIRED },
    );
    assert.deepEqual(matches, []);
  });

  it("rejects an exact title that is missing a required label", () => {
    const matches = selectAlertIssues([issue(95, TITLE, ["bug"])], {
      title: TITLE,
      requiredLabels: REQUIRED,
    });
    assert.deepEqual(matches, [], "priority:p1 is part of alert identity");
  });

  it("rejects an unrelated title even when it carries every required label", () => {
    const matches = selectAlertIssues([issue(120, "Something else entirely", REQUIRED)], {
      title: TITLE,
      requiredLabels: REQUIRED,
    });
    assert.deepEqual(matches, []);
  });

  it("rejects an issue that merely quotes the alert title", () => {
    const matches = selectAlertIssues([FIXTURE[0]!], { title: TITLE, requiredLabels: REQUIRED });
    assert.deepEqual(matches, [], "fuzzy gh --search results must be filtered to exact titles");
  });

  it("accepts one exact match that carries extra mutable labels", () => {
    const matches = selectAlertIssues([FIXTURE[2]!], { title: TITLE, requiredLabels: REQUIRED });
    assert.deepEqual(
      matches.map((m) => m.number),
      [101],
    );
  });

  it("returns multiple exact matches oldest-first, ignoring every decoy", () => {
    const matches = selectAlertIssues(FIXTURE, { title: TITLE, requiredLabels: REQUIRED });
    assert.deepEqual(
      matches.map((m) => m.number),
      [101, 140],
    );
  });

  it("sorts by issue number rather than API order", () => {
    const matches = selectAlertIssues([FIXTURE[4]!, FIXTURE[2]!], {
      title: TITLE,
      requiredLabels: REQUIRED,
    });
    assert.deepEqual(
      matches.map((m) => m.number),
      [101, 140],
    );
  });

  it("parses raw gh --json output and tolerates a genuine empty array", () => {
    const raw = JSON.stringify(FIXTURE);
    assert.deepEqual(
      selectAlertIssues(parseIssues(raw), { title: TITLE, requiredLabels: REQUIRED }).map(
        (m) => m.number,
      ),
      [101, 140],
    );
    assert.deepEqual(parseIssues("[]"), []);
  });

  it("throws on empty or non-array output instead of silently treating it as no issues", () => {
    // Fail-open here would let a broken `gh` call (nothing on stdout, or an
    // unexpected JSON shape) masquerade as "no alert exists yet" and file a
    // duplicate P1 — only a genuine parsed `[]` may mean that.
    assert.throws(() => parseIssues(""), /expected a JSON array.*empty output/);
    assert.throws(() => parseIssues(undefined), /expected a JSON array.*empty output/);
    assert.throws(() => parseIssues(null), /expected a JSON array.*empty output/);
    assert.throws(() => parseIssues("{}"), /expected a JSON array.*got object/);
    assert.throws(() => parseIssues("null"), /expected a JSON array.*got object/);
  });

  it("refuses to select without a title (never matches everything)", () => {
    assert.throws(() => selectAlertIssues(FIXTURE, { title: "" }), /non-empty title/);
  });
});

describe("dead-token-alert — lookup-shape failures propagate on find, are swallowed on resolve", () => {
  // listIssues stands in for the whole "fetch + parseIssues" combo (see the
  // real ghListIssues), so these route raw output through parseIssues itself
  // to reproduce the actual failure the create/resolve steps would see.
  it("find (create side) throws when gh returns empty output — it must never look like 'no alert'", () => {
    assert.throws(
      () =>
        findAlertIssue({
          title: TITLE,
          requiredLabels: REQUIRED,
          listIssues: () => parseIssues(""),
          log: () => {},
        }),
      /expected a JSON array.*empty output/,
    );
  });

  it("find (create side) throws when gh returns a non-array JSON shape", () => {
    assert.throws(
      () =>
        findAlertIssue({
          title: TITLE,
          requiredLabels: REQUIRED,
          listIssues: () => parseIssues("{}"),
          log: () => {},
        }),
      /expected a JSON array.*got object/,
    );
  });

  for (const [description, invalidOutput] of [
    ["empty output", ""],
    ["a non-array JSON shape", "{}"],
  ] as const) {
    it(`resolve (cleanup side) reports ${description} as a non-fatal lookup failure`, () => {
      const { lines, log } = recorder();
      const result = resolveDeadTokenAlert({
        title: TITLE,
        requiredLabels: REQUIRED,
        listIssues: () => parseIssues(invalidOutput),
        log,
        closeIssue: () => {
          throw new Error("must not be called");
        },
      });

      assert.equal(result.status, "lookup-failed");
      assert.match(lines.join("\n"), /::warning::Dead-token alert lookup failed/);
    });
  }
});

describe("dead-token-alert — find", () => {
  it("returns the oldest exact match and warns about duplicates", () => {
    const { lines, log } = recorder();
    const result = findAlertIssue({
      title: TITLE,
      requiredLabels: REQUIRED,
      listIssues: () => FIXTURE,
      log,
    });

    assert.equal(result.number, 101);
    assert.equal(result.matchCount, 2);
    assert.equal(lines.filter((l) => l.startsWith("::warning::")).length, 1);
    assert.match(lines.join("\n"), /Found 2 matching dead-token alerts; using oldest #101\./);
  });

  it("stays idempotent across a burst of queued runs (queue: max, PR #266)", () => {
    // .github/workflows/redeem.yml now serializes on `stfc-gift-redeemer`
    // with `queue: max`, so up to 100 redeem runs can queue and then execute
    // back-to-back where the old `queue: single` silently dropped all but the
    // newest pending one. A burst of consecutive exit-2 runs must therefore
    // still converge on the SAME single alert issue — every run resolves the
    // oldest exact match, so the create step's "already open, don't file a
    // duplicate" branch is taken every time after the first.
    const seen = new Set<number | undefined>();
    for (let run = 0; run < 25; run += 1) {
      const result = findAlertIssue({
        title: TITLE,
        requiredLabels: REQUIRED,
        listIssues: () => FIXTURE,
        log: () => {},
      });
      seen.add(result.number);
    }
    assert.deepEqual([...seen], [101], "a queued burst must not fan out across alert issues");
  });

  it("routes its default diagnostics to stderr, never stdout", () => {
    // The workflow's create step captures this function's stdout with
    // `existing=$(node scripts/dead-token-alert.mjs find)` to get a single
    // issue number. If the default logger wrote the duplicate warning to
    // stdout too, `existing` would become a multi-line value and corrupt the
    // downstream `gh issue comment "$existing"` call.
    const originalLog = console.log;
    const originalError = console.error;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    console.log = (line?: unknown) => stdoutLines.push(String(line));
    console.error = (line?: unknown) => stderrLines.push(String(line));
    try {
      const result = findAlertIssue({
        title: TITLE,
        requiredLabels: REQUIRED,
        listIssues: () => FIXTURE,
      });
      assert.equal(result.number, 101);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.deepEqual(stdoutLines, [], "duplicate-alert diagnostics must never reach stdout");
    assert.equal(stderrLines.filter((l) => l.startsWith("::warning::")).length, 1);
  });

  it("returns undefined and does not warn when nothing matches", () => {
    const { lines, log } = recorder();
    const result = findAlertIssue({
      title: TITLE,
      requiredLabels: REQUIRED,
      listIssues: () => [FIXTURE[0]!, FIXTURE[1]!, FIXTURE[3]!],
      log,
    });

    assert.equal(result.number, undefined);
    assert.equal(result.matchCount, 0);
    assert.deepEqual(lines, []);
  });

  it("propagates a lookup failure so the create side fails visibly", () => {
    // The create side must NOT swallow this: guessing "no alert open" after a
    // failed lookup files a duplicate P1 every 10 minutes.
    assert.throws(
      () =>
        findAlertIssue({
          title: TITLE,
          requiredLabels: REQUIRED,
          listIssues: () => {
            throw new Error("gh: API rate limit exceeded");
          },
          log: () => {},
        }),
      /rate limit/,
    );
  });

  it("searches on the alert title", () => {
    const seen: string[] = [];
    findAlertIssue({
      title: TITLE,
      requiredLabels: REQUIRED,
      listIssues: (title: string) => {
        seen.push(title);
        return [];
      },
      log: () => {},
    });
    assert.deepEqual(seen, [TITLE]);
  });
});

describe("dead-token-alert — resolve", () => {
  it("closes exactly one issue — the oldest exact match — and never a decoy", () => {
    const { calls, closeIssue } = closeRecorder();
    const { log } = recorder();

    const result = resolveDeadTokenAlert({
      title: TITLE,
      requiredLabels: REQUIRED,
      runUrl: "https://github.com/Jamula/stfc/actions/runs/1",
      listIssues: () => FIXTURE,
      closeIssue,
      log,
    });

    assert.equal(result.status, "closed");
    assert.equal(result.number, 101);
    assert.equal(calls.length, 1, "at most one issue may ever be closed");
    assert.equal(calls[0]!.number, 101);
    assert.match(
      calls[0]!.comment,
      /Token accepted again as of https:\/\/github\.com\/Jamula\/stfc\/actions\/runs\/1 — closing automatically\./,
    );
    // The decoys and the duplicate are all still open.
    assert.deepEqual(
      calls.map((c) => c.number).filter((n) => n !== 101),
      [],
    );
  });

  it("closes nothing when only decoys are open", () => {
    const { calls, closeIssue } = closeRecorder();
    const { lines, log } = recorder();

    const result = resolveDeadTokenAlert({
      title: TITLE,
      requiredLabels: REQUIRED,
      runUrl: "https://example.com/run",
      listIssues: () => [FIXTURE[0]!, FIXTURE[1]!, FIXTURE[3]!],
      closeIssue,
      log,
    });

    assert.equal(result.status, "none");
    assert.equal(calls.length, 0);
    assert.match(lines.join("\n"), /nothing to resolve/);
  });

  it("is non-fatal when the lookup fails, and closes nothing", () => {
    const { calls, closeIssue } = closeRecorder();
    const { lines, log } = recorder();

    const result = resolveDeadTokenAlert({
      title: TITLE,
      requiredLabels: REQUIRED,
      runUrl: "https://example.com/run",
      listIssues: () => {
        throw new Error("gh: API rate limit exceeded");
      },
      closeIssue,
      log,
    });

    assert.equal(result.status, "lookup-failed");
    assert.equal(calls.length, 0, "a failed lookup must not close a guessed issue");
    assert.match(lines.join("\n"), /::warning::Dead-token alert lookup failed/);
  });

  it("is non-fatal when the close fails", () => {
    const { lines, log } = recorder();
    let attempts = 0;

    const result = resolveDeadTokenAlert({
      title: TITLE,
      requiredLabels: REQUIRED,
      runUrl: "https://example.com/run",
      listIssues: () => FIXTURE,
      closeIssue: () => {
        attempts += 1;
        throw new Error("gh: 403 Resource not accessible by integration");
      },
      log,
    });

    assert.equal(result.status, "close-failed");
    assert.equal(result.number, 101);
    assert.equal(attempts, 1, "a failed close must not be retried into a loop");
    assert.match(lines.join("\n"), /::warning::Failed to close dead-token alert #101/);
  });

  it("uses the same identity rule as the create side", () => {
    // Symmetry is structural: both workflow halves call findAlertIssue, so the
    // number the create step treats as "already open" is exactly the number
    // the resolve step closes.
    const { calls, closeIssue } = closeRecorder();
    const found = findAlertIssue({
      title: TITLE,
      requiredLabels: REQUIRED,
      listIssues: () => FIXTURE,
      log: () => {},
    });
    const resolved = resolveDeadTokenAlert({
      title: TITLE,
      requiredLabels: REQUIRED,
      runUrl: "https://example.com/run",
      listIssues: () => FIXTURE,
      closeIssue,
      log: () => {},
    });

    assert.equal(found.number, resolved.number);
    assert.equal(calls.length, 1);
  });
});
