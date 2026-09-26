// Behavioral tests for .squad/templates/ralph-triage.js's round-start retro
// gate (issue #245; #248 Garak finding 1 — "wire the actual authoritative
// round-start dispatcher... and test that dispatcher with a fake queue/spawn
// boundary"; #248 Kirk finding — "the gate is unsatisfiable in the only
// place it actually enforces"; #248 Garak round-3 finding 1 — "evaluated:
// false is a bypass, not fail-loud"; finding 4 — "export/inject main()
// dependencies and assert actual main-level queue fetch/build suppression,
// not predicate reimplementation").
//
// squad-heartbeat.yml runs this script as a real GitHub Actions job on real
// triggers and builds a real work queue (the triage `results` array) before
// that queue is acted on — this is the one genuine, testable "before queue
// construction" process boundary in this repository.
//
// Covers:
//   - evaluateRetroGate as a REAL spawn boundary against the actual
//     scripts/check-retro-overdue.mjs child process, fed by an injectable
//     fetchRetroSignalImpl standing in for the real GitHub retro-action
//     issue lookup (satisfiability fix: the signal is no longer
//     `.squad/log/`, which is gitignored and unobservable from a fresh CI
//     checkout — see ceremonies.md/SKILL.md for the full rationale).
//   - runRound as the REAL main()-level entry point, called directly (not
//     reimplemented) with injected fetchRetroSignalImpl/fetchSquadIssuesImpl,
//     proving overdue/unevaluated genuinely suppress queue construction at
//     the actual call site.
//   - The fail-closed contract: canProceed is true ONLY when
//     evaluated===true && overdue===false; every other combination
//     (unevaluated, fault, confirmed overdue) blocks the round.
//   - The honest non-local-backend boundary: evaluated:false, never
//     fabricated, for orphan/two-layer/git-notes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

interface RetroGateResult {
  evaluated: boolean;
  backend: string;
  overdue: boolean;
  reason?: string;
  windowDays?: number;
  signalDate?: string | null;
}

interface RalphTriageModule {
  evaluateRetroGate: (opts: {
    repoRoot: string;
    squadDir: string;
    owner?: string;
    repo?: string;
    token?: string;
    windowDays?: number;
    execFileSyncImpl?: (...a: unknown[]) => string;
    fetchRetroSignalImpl?: (opts: { owner?: string; repo?: string; token?: string }) => Promise<string | null>;
  }) => Promise<RetroGateResult>;
  buildTriageQueue: (
    issues: Array<{ number: number; title: string; body: string; labels: string[] }>,
    rules: unknown[],
    modules: unknown[],
    roster: Array<{ name: string; role: string; label: string }>,
  ) => Array<{ issueNumber: number; assignTo: string; label: string; reason: string; source: string }>;
  runRound: (opts: {
    squadDir: string;
    repoRoot: string;
    token?: string;
    owner?: string;
    repo?: string;
    windowDays?: number;
    execFileSyncImpl?: (...a: unknown[]) => string;
    fetchRetroSignalImpl?: (opts: unknown) => Promise<string | null>;
    fetchSquadIssuesImpl?: (owner: string, repo: string, token: string) => Promise<unknown[]>;
  }) => Promise<{ retroGate: RetroGateResult; results: unknown[]; canProceed: boolean }>;
  readStateBackend: (squadDir: string) => string;
  fetchLatestRetroCompletionDate: (opts: {
    owner: string;
    repo: string;
    token: string;
    githubRequestJsonImpl?: (pathname: string, token: string) => Promise<unknown>;
  }) => Promise<string | null>;
  validateOverdueResult: (parsed: unknown, expectedBackend: string) => { ok: boolean; reason?: string };
}

const ralphTriage = require(path.join(repoRoot, ".squad", "templates", "ralph-triage.js")) as RalphTriageModule;

describe("ralph-triage.js and squad-heartbeat.yml integration", () => {
  const heartbeatWorkflow = fs
    .readFileSync(path.join(repoRoot, ".github", "workflows", "squad-heartbeat.yml"), "utf8")
    .replace(/\r\n/g, "\n");

  it("uses the dispatcher's JSON artifact as a fail-closed retro-gate input", () => {
    assert.match(
      heartbeatWorkflow,
      /node \.squad\/templates\/ralph-triage\.js[\s\S]*--output triage-results\.json/,
    );

    const gateStepIndex = heartbeatWorkflow.indexOf("Ralph — Check retro gate");
    const applyStepIndex = heartbeatWorkflow.indexOf("Ralph — Apply triage decisions");
    const gateStep = heartbeatWorkflow.slice(gateStepIndex, applyStepIndex);

    assert.ok(gateStepIndex !== -1 && applyStepIndex > gateStepIndex);
    assert.match(gateStep, /const path = "triage-results\.json"/);
    assert.match(gateStep, /let canProceed = false/);
    assert.match(gateStep, /canProceed = data\.canProceed === true/);
    assert.match(
      heartbeatWorkflow,
      /steps\.retro-gate\.outputs\.can_proceed == 'true'/,
    );
  });
});

function makeSquadDir(root: string, stateBackend: string): string {
  const squadDir = path.join(root, ".squad");
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, "config.json"), JSON.stringify({ stateBackend }));
  return squadDir;
}

function isoNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const FRESH_RETRO_ISSUE_DATE = () => isoNDaysAgo(1);
const STALE_RETRO_ISSUE_DATE = () => isoNDaysAgo(30);

describe("ralph-triage.js: readStateBackend", () => {
  it("reads stateBackend from .squad/config.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "two-layer");
      assert.equal(ralphTriage.readStateBackend(squadDir), "two-layer");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults to local when config.json is missing (ENOENT only)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      fs.mkdirSync(path.join(root, ".squad"), { recursive: true });
      assert.equal(ralphTriage.readStateBackend(path.join(root, ".squad")), "local");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws (does NOT silently default to local) when config.json exists but is malformed JSON (#248 Copilot review finding)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = path.join(root, ".squad");
      fs.mkdirSync(squadDir, { recursive: true });
      fs.writeFileSync(path.join(squadDir, "config.json"), "{ not valid json");
      assert.throws(() => ralphTriage.readStateBackend(squadDir), /not valid JSON/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluateRetroGate reports evaluated:false (not a fabricated local-backend result) when config.json is malformed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = path.join(root, ".squad");
      fs.mkdirSync(squadDir, { recursive: true });
      fs.writeFileSync(path.join(squadDir, "config.json"), "{ not valid json");
      const result = await ralphTriage.evaluateRetroGate({ repoRoot, squadDir, owner: "o", repo: "r", token: "t" });
      assert.equal(result.evaluated, false);
      assert.match(result.reason ?? "", /could not determine stateBackend/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ralph-triage.js: fetchLatestRetroCompletionDate — injectable GitHub API call", () => {
  it("returns the created_at of the newest matching issue", async () => {
    const githubRequestJsonImpl = async (pathname: string) => {
      assert.match(pathname, /labels=retro-complete/);
      assert.match(pathname, /state=all/);
      assert.match(pathname, /sort=created/);
      assert.match(pathname, /direction=desc/);
      assert.match(pathname, /[?&]page=1\b/);
      return [{ created_at: "2026-08-24T02:17:11Z", number: 246 }];
    };
    const date = await ralphTriage.fetchLatestRetroCompletionDate({
      owner: "o",
      repo: "r",
      token: "t",
      githubRequestJsonImpl,
    });
    assert.equal(date, "2026-08-24T02:17:11Z");
  });

  it("returns null when there are no matching issues", async () => {
    const date = await ralphTriage.fetchLatestRetroCompletionDate({
      owner: "o",
      repo: "r",
      token: "t",
      githubRequestJsonImpl: async () => [],
    });
    assert.equal(date, null);
  });

  it("skips a labeled pull request and uses the newest genuine issue instead (#248 Copilot review finding)", async () => {
    // The REST Issues endpoint returns PRs too (a PR is "an issue" in
    // GitHub's API model); a fresh retro-complete-labeled PR must not
    // unblock the gate, since only a real Issue counts as the ceremony's
    // completion marker.
    const githubRequestJsonImpl = async () => [
      { created_at: "2026-08-24T10:00:00Z", number: 300, pull_request: { url: "https://example.com/pr/300" } },
      { created_at: "2026-08-23T02:17:11Z", number: 246 }, // the real issue, older than the PR above
    ];
    const date = await ralphTriage.fetchLatestRetroCompletionDate({
      owner: "o",
      repo: "r",
      token: "t",
      githubRequestJsonImpl,
    });
    assert.equal(date, "2026-08-23T02:17:11Z");
  });

  it("returns null when only pull requests carry the label, not falling back to a PR's date", async () => {
    const githubRequestJsonImpl = async () => [
      { created_at: "2026-08-24T10:00:00Z", number: 301, pull_request: { url: "https://example.com/pr/301" } },
    ];
    const date = await ralphTriage.fetchLatestRetroCompletionDate({
      owner: "o",
      repo: "r",
      token: "t",
      githubRequestJsonImpl,
    });
    assert.equal(date, null);
  });

  it("paginates past a full page of labeled PRs to find a genuine issue on a later page (#248 Copilot review finding, second pass)", async () => {
    const fullPageOfPrs = Array.from({ length: 100 }, (_, i) => ({
      created_at: "2026-08-24T10:00:00Z",
      number: 400 + i,
      pull_request: { url: "https://example.com/pr" },
    }));
    const genuineIssue = { created_at: "2026-08-20T00:00:00Z", number: 246, pull_request: undefined };

    const calls: number[] = [];
    const githubRequestJsonImpl = async (pathname: string) => {
      const pageMatch = /[?&]page=(\d+)/.exec(pathname);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      calls.push(page);
      if (page === 1) return fullPageOfPrs;
      if (page === 2) return [genuineIssue];
      return [];
    };

    const date = await ralphTriage.fetchLatestRetroCompletionDate({
      owner: "o",
      repo: "r",
      token: "t",
      githubRequestJsonImpl,
    });
    assert.equal(date, "2026-08-20T00:00:00Z");
    assert.deepEqual(calls, [1, 2], "must fetch page 2 after page 1 was entirely PRs");
  });

  it("returns null (not fabricated) after exhausting the page cap without finding a genuine issue", async () => {
    let pagesRequested = 0;
    const githubRequestJsonImpl = async () => {
      pagesRequested++;
      // Always return a full page of PR-only results, forcing the
      // function to paginate all the way to its safety cap.
      return Array.from({ length: 100 }, (_, i) => ({
        created_at: "2026-08-24T10:00:00Z",
        number: 500 + i,
        pull_request: { url: "https://example.com/pr" },
      }));
    };
    const date = await ralphTriage.fetchLatestRetroCompletionDate({
      owner: "o",
      repo: "r",
      token: "t",
      githubRequestJsonImpl,
    });
    assert.equal(date, null);
    assert.ok(pagesRequested >= 2, "must have paginated at least once before giving up");
    assert.ok(pagesRequested <= 10, "must respect the pagination safety cap, not loop forever");
  });
});

describe("ralph-triage.js: validateOverdueResult — reject malformed/mismatched child JSON before trusting it", () => {
  it("accepts a well-formed result", () => {
    assert.equal(ralphTriage.validateOverdueResult({ evaluated: true, overdue: false, backend: "local" }, "local").ok, true);
  });

  it("rejects when evaluated is not literally true", () => {
    assert.equal(ralphTriage.validateOverdueResult({ evaluated: "true", overdue: false, backend: "local" }, "local").ok, false);
  });

  it("rejects when overdue is not a boolean", () => {
    assert.equal(ralphTriage.validateOverdueResult({ evaluated: true, overdue: "false", backend: "local" }, "local").ok, false);
  });

  it("rejects a backend mismatch", () => {
    assert.equal(ralphTriage.validateOverdueResult({ evaluated: true, overdue: false, backend: "worktree" }, "local").ok, false);
  });

  it("rejects a non-object", () => {
    assert.equal(ralphTriage.validateOverdueResult(null, "local").ok, false);
    assert.equal(ralphTriage.validateOverdueResult("not an object", "local").ok, false);
  });
});

describe("ralph-triage.js: evaluateRetroGate — real spawn boundary, satisfiable via the GitHub retro-action signal", () => {
  it("evaluated:true, overdue:true when the fake retro-action fetcher returns a stale date", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => STALE_RETRO_ISSUE_DATE(),
      });
      assert.equal(result.evaluated, true);
      assert.equal(result.backend, "local");
      assert.equal(result.overdue, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluated:true, overdue:false when the fake retro-action fetcher returns a fresh date", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "worktree");
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(),
      });
      assert.equal(result.evaluated, true);
      assert.equal(result.overdue, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluated:true, overdue:true when no retro-action issue exists at all", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => null,
      });
      assert.equal(result.evaluated, true);
      assert.equal(result.overdue, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("REGRESSION (satisfiability, #248 Kirk): this dispatcher's signal is NOT .squad/log/, which is gitignored and unobservable from a fresh CI checkout", () => {
    // Pin the actual repo policy so this can never silently regress back
    // to the unsatisfiable filesystem-only design.
    const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /\.squad\/log\//, "expected .squad/log/ to remain gitignored — if this changes, re-validate the CI-visibility assumption this fix depends on");
    const source = fs.readFileSync(path.join(repoRoot, ".squad", "templates", "ralph-triage.js"), "utf8");
    assert.match(
      source,
      /fetchLatestRetroCompletionDate/,
      "evaluateRetroGate must use the GitHub retro-completion issue signal, not a .squad/log/ directory scan",
    );
    assert.doesNotMatch(
      source.slice(source.indexOf("async function evaluateRetroGate")),
      /path\.join\(squadDir, ['"]log['"]\)/,
      "evaluateRetroGate must not read .squad/log/ directly — that path is gitignored and never present in a fresh CI checkout",
    );
  });

  it("a fresh retrospective (simulated as a new retro-action issue) genuinely unblocks the queue — regression for Kirk's finding", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const before = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => null, // no retro yet
      });
      assert.equal(before.overdue, true);

      const after = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(), // retro just happened
      });
      assert.equal(after.overdue, false, "a fresh retrospective must unblock the gate");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("honestly reports evaluated:false (never fabricated) for a non-local backend", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "two-layer");
      const result = await ralphTriage.evaluateRetroGate({ repoRoot, squadDir, owner: "o", repo: "r", token: "t" });
      assert.equal(result.evaluated, false);
      assert.equal(result.overdue, false, "an unevaluated gate must never report overdue:true either — it must be visibly unevaluated");
      assert.match(result.reason ?? "", /cannot be evaluated/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluated:false when fetching the retro-completion signal itself fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => {
          throw new Error("simulated GitHub API failure");
        },
      });
      assert.equal(result.evaluated, false);
      assert.match(result.reason ?? "", /failed to fetch retro-completion issue signal/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluated:false when the check-retro-overdue.mjs spawn itself faults", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const throwingExecFileSync = () => {
        throw new Error("simulated spawn failure");
      };
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(),
        execFileSyncImpl: throwingExecFileSync,
      });
      assert.equal(result.evaluated, false);
      assert.match(result.reason ?? "", /invocation failed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluated:false when check-retro-overdue.mjs's output is malformed (validated, not trusted blindly)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const bogusExecFileSync = () => "not json at all";
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(),
        execFileSyncImpl: bogusExecFileSync,
      });
      assert.equal(result.evaluated, false);
      assert.match(result.reason ?? "", /unparseable output/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evaluated:false when check-retro-overdue.mjs returns a backend mismatch (validated)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-triage-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      const mismatchedExecFileSync = () => JSON.stringify({ evaluated: true, overdue: false, backend: "worktree" });
      const result = await ralphTriage.evaluateRetroGate({
        repoRoot,
        squadDir,
        owner: "o",
        repo: "r",
        token: "t",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(),
        execFileSyncImpl: mismatchedExecFileSync,
      });
      assert.equal(result.evaluated, false);
      assert.match(result.reason ?? "", /unexpected result/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ralph-triage.js: buildTriageQueue — fake queue (issue #245; Garak finding 1)", () => {
  const roster = [
    { name: "Dallas", role: "Lead / Architect", label: "squad:dallas" },
    { name: "Ripley", role: "Backend Dev", label: "squad:ripley" },
  ];

  it("builds a normal queue from a fake issue list", () => {
    const fakeIssues = [
      { number: 101, title: "API endpoint returns 500", body: "backend issue", labels: [] },
      { number: 102, title: "Something else entirely", body: "", labels: [] },
    ];
    const queue = ralphTriage.buildTriageQueue(fakeIssues, [], [], roster);
    assert.ok(queue.length >= 1);
    const assigned = queue.find((q) => q.issueNumber === 101);
    assert.ok(assigned);
    assert.equal(assigned!.assignTo, "Ripley");
  });
});

describe("ralph-triage.js: runRound — the REAL main()-level entry point, executed directly (#248 Garak finding 4)", () => {
  // Every test in this describe block calls the actual exported `runRound`
  // — the same function `main()` calls — with injected dependencies. This
  // is main()-level execution, not a reimplemented `if` predicate.

  function setupTeamFiles(squadDir: string) {
    fs.writeFileSync(
      path.join(squadDir, "team.md"),
      "## Members\n\n| Name | Role |\n|------|------|\n| Ripley | Backend Dev |\n",
    );
    fs.writeFileSync(path.join(squadDir, "routing.md"), "");
  }

  const fakeIssues = [{ number: 501, title: "backend api bug", body: "", labels: [{ name: "squad" }] }];

  it("an overdue retro gate produces an EMPTY results array and canProceed:false via runRound itself", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-round-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      setupTeamFiles(squadDir);

      let fetchSquadIssuesCalled = false;
      const { retroGate, results, canProceed } = await ralphTriage.runRound({
        squadDir,
        repoRoot,
        token: "t",
        owner: "o",
        repo: "r",
        fetchRetroSignalImpl: async () => STALE_RETRO_ISSUE_DATE(),
        fetchSquadIssuesImpl: async () => {
          fetchSquadIssuesCalled = true;
          return fakeIssues;
        },
      });

      assert.equal(retroGate.overdue, true);
      assert.equal(canProceed, false);
      assert.deepEqual(results, []);
      assert.equal(fetchSquadIssuesCalled, false, "runRound must not even fetch issues when the gate is overdue");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("a not-overdue retro gate builds a real, non-empty queue via runRound itself", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-round-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      setupTeamFiles(squadDir);

      const { retroGate, results, canProceed } = await ralphTriage.runRound({
        squadDir,
        repoRoot,
        token: "t",
        owner: "o",
        repo: "r",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(),
        fetchSquadIssuesImpl: async () => fakeIssues,
      });

      assert.equal(retroGate.overdue, false);
      assert.equal(canProceed, true);
      assert.equal(results.length, 1);
      assert.equal((results[0] as { issueNumber: number }).issueNumber, 501);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fail-closed: an UNEVALUATED gate (non-local backend) also blocks the round via runRound — not just a confirmed overdue", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-round-"));
    try {
      const squadDir = makeSquadDir(root, "two-layer");
      setupTeamFiles(squadDir);

      let fetchSquadIssuesCalled = false;
      const { retroGate, results, canProceed } = await ralphTriage.runRound({
        squadDir,
        repoRoot,
        token: "t",
        owner: "o",
        repo: "r",
        fetchSquadIssuesImpl: async () => {
          fetchSquadIssuesCalled = true;
          return fakeIssues;
        },
      });

      assert.equal(retroGate.evaluated, false);
      assert.equal(canProceed, false, "an unevaluated gate must fail closed, exactly like a confirmed-overdue gate");
      assert.deepEqual(results, []);
      assert.equal(fetchSquadIssuesCalled, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fail-closed: a spawn FAULT also blocks the round via runRound — a fault must never be treated as 'not overdue'", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-round-"));
    try {
      const squadDir = makeSquadDir(root, "local");
      setupTeamFiles(squadDir);

      let fetchSquadIssuesCalled = false;
      const { canProceed, results } = await ralphTriage.runRound({
        squadDir,
        repoRoot,
        token: "t",
        owner: "o",
        repo: "r",
        fetchRetroSignalImpl: async () => FRESH_RETRO_ISSUE_DATE(),
        execFileSyncImpl: () => {
          throw new Error("simulated spawn failure");
        },
        fetchSquadIssuesImpl: async () => {
          fetchSquadIssuesCalled = true;
          return fakeIssues;
        },
      });

      assert.equal(canProceed, false);
      assert.deepEqual(results, []);
      assert.equal(fetchSquadIssuesCalled, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
