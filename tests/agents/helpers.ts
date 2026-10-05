import { readFileSync } from "fs";
import { resolve } from "path";
import assert from "node:assert/strict";

/**
 * Read a repo file with line endings normalized to LF.
 *
 * This repo is worked on from both Linux (Codespaces) and Windows, and
 * `core.autocrlf=true` means a Windows checkout materializes these files with
 * CRLF. The table parsers below split on "\n" and anchor with `$`, so a
 * trailing "\r" silently makes every row fail to match and every routing
 * assertion fail. Normalize once, here, so the tests are checkout-independent.
 */
function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8").replace(/\r\n/g, "\n");
}

/** Read and return the raw text of an agent's charter.md. */
export function readCharter(agentName: string): string {
  return readRepoFile(`.squad/agents/${agentName}/charter.md`);
}

/** Read and return the raw text of .squad/routing.md. */
export function readRouting(): string {
  return readRepoFile(".squad/routing.md");
}

/** Read and return the raw text of .github/copilot-instructions.md. */
export function readRules(): string {
  return readRepoFile(".github/copilot-instructions.md");
}

/** Assert that the charter text mentions every string in `expectedOwns`. */
export function assertOwnership(
  charter: string,
  expectedOwns: string[],
): void {
  for (const term of expectedOwns) {
    assert.ok(
      charter.toLowerCase().includes(term.toLowerCase()),
      `Charter should declare ownership of "${term}"`,
    );
  }
}

/**
 * Assert that a charter declares handling certain things and NOT others.
 * Checks the "Boundaries" section (case-insensitive substring match).
 */
export function assertBoundaries(
  charter: string,
  handles: string[],
  doesNotHandle: string[],
): void {
  const boundariesMatch = charter.match(
    /## Boundaries[\s\S]*?(?=\n## |\n# |$)/,
  );
  assert.ok(boundariesMatch, "Charter must have a ## Boundaries section");
  const boundaries = boundariesMatch[0];

  for (const h of handles) {
    assert.ok(
      boundaries.toLowerCase().includes(h.toLowerCase()),
      `Boundaries should declare handling "${h}"`,
    );
  }
  for (const nh of doesNotHandle) {
    const handleLine = boundaries
      .split("\n")
      .find((l) => /I (don't )?handle/i.test(l) && l.toLowerCase().includes(nh.toLowerCase()));
    if (handleLine) {
      assert.ok(
        /don't handle/i.test(handleLine),
        `"${nh}" should appear only in the "don't handle" clause, but found in: ${handleLine}`,
      );
    }
  }
}

export interface RoutingEntry {
  workType: string;
  routeTo: string;
  examples: string;
}

export interface IssueRoutingEntry {
  label: string;
  action: string;
  who: string;
}

/** Parse the "Routing Table" from routing.md into structured entries. */
export function parseRoutingTable(routing: string): RoutingEntry[] {
  const entries: RoutingEntry[] = [];
  const tableSection = routing.match(
    /## Routing Table[\s\S]*?(?=\n## |\n# |$)/,
  );
  if (!tableSection) return entries;

  for (const line of tableSection[0].split("\n")) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (m && !/^-+$/.test(m[1]!.trim()) && !/Work Type/i.test(m[1]!)) {
      entries.push({
        workType: m[1]!.trim(),
        routeTo: m[2]!.trim(),
        examples: m[3]!.trim(),
      });
    }
  }
  return entries;
}

/** Parse the "Issue Routing" table from routing.md. */
export function parseIssueRouting(routing: string): IssueRoutingEntry[] {
  const entries: IssueRoutingEntry[] = [];
  const section = routing.match(/## Issue Routing[\s\S]*?(?=\n## [^#]|\n# |$)/);
  if (!section) return entries;

  for (const line of section[0].split("\n")) {
    const m = line.match(/^\|\s*`(.+?)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (m) {
      entries.push({
        label: m[1]!.trim(),
        action: m[2]!.trim(),
        who: m[3]!.trim(),
      });
    }
  }
  return entries;
}

/** Assert a routing entry exists where workType includes `keyword` and routeTo includes `agent`. */
export function assertRoutedTo(
  entries: RoutingEntry[],
  keyword: string,
  agent: string,
): void {
  const match = entries.find(
    (e) =>
      e.workType.toLowerCase().includes(keyword.toLowerCase()) ||
      e.examples.toLowerCase().includes(keyword.toLowerCase()),
  );
  assert.ok(match, `Routing table should have an entry matching "${keyword}"`);
  assert.ok(
    match.routeTo.toLowerCase().includes(agent.toLowerCase()),
    `"${keyword}" should route to ${agent}, but routes to "${match.routeTo}"`,
  );
}

/** Assert an issue-routing entry maps the given label to the expected agent. */
export function assertIssueRoutedTo(
  entries: IssueRoutingEntry[],
  label: string,
  agent: string,
): void {
  const match = entries.find((e) => e.label === label);
  assert.ok(match, `Issue routing should have an entry for label "${label}"`);
  assert.ok(
    match.who.toLowerCase().includes(agent.toLowerCase()),
    `Label "${label}" should route to ${agent}, but routes to "${match.who}"`,
  );
}

/** Assert that NO routing entry for `keyword` routes to `agent`. */
export function assertNotRoutedTo(
  entries: RoutingEntry[],
  keyword: string,
  agent: string,
): void {
  const matches = entries.filter(
    (e) =>
      e.workType.toLowerCase().includes(keyword.toLowerCase()) ||
      e.examples.toLowerCase().includes(keyword.toLowerCase()),
  );
  for (const m of matches) {
    assert.ok(
      !m.routeTo.toLowerCase().includes(agent.toLowerCase()),
      `"${keyword}" should NOT route to ${agent}, but found: "${m.routeTo}"`,
    );
  }
}

/** Assert charter declares a specific preferred model. */
export function assertModelPreference(
  charter: string,
  expectedModel: string,
): void {
  const modelSection = charter.match(/## Model[\s\S]*?(?=\n## |\n# |$)/);
  assert.ok(modelSection, "Charter must have a ## Model section");
  assert.ok(
    modelSection[0].includes(expectedModel),
    `Model section should declare "${expectedModel}"`,
  );
}

/** Assert charter references the canonical local decisions ledger (in any section). */
export function assertDecisionsReference(charter: string): void {
  assert.ok(
    charter.includes(".squad/decisions/decisions.md"),
    "Charter should reference .squad/decisions/decisions.md",
  );
}

/** Assert charter drops decisions to the expected inbox path pattern. */
export function assertDecisionInbox(
  charter: string,
  agentName: string,
): void {
  const pattern = `.squad/decisions/inbox/${agentName}-`;
  assert.ok(
    charter.includes(pattern),
    `Charter should reference decision inbox pattern "${pattern}"`,
  );
}
