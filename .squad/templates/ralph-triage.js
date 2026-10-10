#!/usr/bin/env node
/**
 * Ralph Triage Script — Standalone CJS implementation
 *
 * ⚠️ SYNC NOTICE: This file ports triage logic from the SDK source:
 *   packages/squad-sdk/src/ralph/triage.ts
 *
 * Any changes to routing/triage logic MUST be applied to BOTH files.
 * The SDK module is the canonical implementation; this script exists
 * for zero-dependency use in GitHub Actions workflows.
 *
 * To verify parity: npm test -- test/ralph-triage.test.ts
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execSync, execFileSync } = require('node:child_process');

function parseArgs(argv) {
  let squadDir = '.squad';
  let output = 'triage-results.json';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--squad-dir') {
      squadDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output') {
      output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!squadDir) throw new Error('--squad-dir requires a value');
  if (!output) throw new Error('--output requires a value');

  return { squadDir, output };
}

function printUsage() {
  console.log('Usage: node .squad/templates/ralph-triage.js --squad-dir .squad --output triage-results.json');
}

function normalizeEol(content) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function slugify(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function parseRoutingRules(routingMd) {
  const table = parseTableSection(routingMd, /^##\s*work\s*type\s*(?:→|->)\s*agent\b/i);
  if (!table) return [];

  const workTypeIndex = findColumnIndex(table.headers, ['work type', 'type']);
  const agentIndex = findColumnIndex(table.headers, ['agent', 'route to', 'route']);
  const examplesIndex = findColumnIndex(table.headers, ['examples', 'example']);

  if (workTypeIndex < 0 || agentIndex < 0) return [];

  const rules = [];
  for (const row of table.rows) {
    const workType = cleanCell(row[workTypeIndex] || '');
    const agentName = cleanCell(row[agentIndex] || '');
    const keywords = splitKeywords(examplesIndex >= 0 ? row[examplesIndex] : '');
    if (!workType || !agentName) continue;
    rules.push({ workType, agentName, keywords });
  }

  return rules;
}

function parseModuleOwnership(routingMd) {
  const table = parseTableSection(routingMd, /^##\s*module\s*ownership\b/i);
  if (!table) return [];

  const moduleIndex = findColumnIndex(table.headers, ['module', 'path']);
  const primaryIndex = findColumnIndex(table.headers, ['primary']);
  const secondaryIndex = findColumnIndex(table.headers, ['secondary']);

  if (moduleIndex < 0 || primaryIndex < 0) return [];

  const modules = [];
  for (const row of table.rows) {
    const modulePath = normalizeModulePath(row[moduleIndex] || '');
    const primary = cleanCell(row[primaryIndex] || '');
    const secondaryRaw = cleanCell(secondaryIndex >= 0 ? row[secondaryIndex] || '' : '');
    const secondary = normalizeOptionalOwner(secondaryRaw);

    if (!modulePath || !primary) continue;
    modules.push({ modulePath, primary, secondary });
  }

  return modules;
}

function parseRoster(teamMd) {
  const table =
    parseTableSection(teamMd, /^##\s*members\b/i) ||
    parseTableSection(teamMd, /^##\s*team\s*roster\b/i);

  if (!table) return [];

  const nameIndex = findColumnIndex(table.headers, ['name']);
  const roleIndex = findColumnIndex(table.headers, ['role']);
  if (nameIndex < 0 || roleIndex < 0) return [];

  const excluded = new Set(['scribe', 'ralph']);
  const members = [];

  for (const row of table.rows) {
    const name = cleanCell(row[nameIndex] || '');
    const role = cleanCell(row[roleIndex] || '');
    if (!name || !role) continue;
    if (excluded.has(name.toLowerCase())) continue;

    members.push({
      name,
      role,
      label: `squad:${slugify(name)}`,
    });
  }

  return members;
}

function triageIssue(issue, rules, modules, roster) {
  const issueText = `${issue.title}\n${issue.body || ''}`.toLowerCase();
  const normalizedIssueText = normalizeTextForPathMatch(issueText);

  const bestModule = findBestModuleMatch(normalizedIssueText, modules);
  if (bestModule) {
    const primaryMember = findMember(bestModule.primary, roster);
    if (primaryMember) {
      return {
        agent: primaryMember,
        reason: `Matched module path "${bestModule.modulePath}" to primary owner "${bestModule.primary}"`,
        source: 'module-ownership',
        confidence: 'high',
      };
    }

    if (bestModule.secondary) {
      const secondaryMember = findMember(bestModule.secondary, roster);
      if (secondaryMember) {
        return {
          agent: secondaryMember,
          reason: `Matched module path "${bestModule.modulePath}" to secondary owner "${bestModule.secondary}"`,
          source: 'module-ownership',
          confidence: 'medium',
        };
      }
    }
  }

  const bestRule = findBestRuleMatch(issueText, rules);
  if (bestRule) {
    const agent = findMember(bestRule.rule.agentName, roster);
    if (agent) {
      return {
        agent,
        reason: `Matched routing keyword(s): ${bestRule.matchedKeywords.join(', ')}`,
        source: 'routing-rule',
        confidence: bestRule.matchedKeywords.length >= 2 ? 'high' : 'medium',
      };
    }
  }

  const roleMatch = findRoleKeywordMatch(issueText, roster);
  if (roleMatch) {
    return {
      agent: roleMatch.agent,
      reason: roleMatch.reason,
      source: 'role-keyword',
      confidence: 'medium',
    };
  }

  const lead = findLeadFallback(roster);
  if (!lead) return null;

  return {
    agent: lead,
    reason: 'No module, routing, or role keyword match — routed to Lead/Architect',
    source: 'lead-fallback',
    confidence: 'low',
  };
}

function parseTableSection(markdown, sectionHeader) {
  const lines = normalizeEol(markdown).split('\n');
  let inSection = false;
  const tableLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inSection && sectionHeader.test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(trimmed)) break;
    if (inSection && trimmed.startsWith('|')) tableLines.push(trimmed);
  }

  if (tableLines.length === 0) return null;

  let headers = null;
  const rows = [];

  for (const line of tableLines) {
    const cells = parseTableLine(line);
    if (cells.length === 0) continue;
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;

    if (!headers) {
      headers = cells;
      continue;
    }

    rows.push(cells);
  }

  if (!headers) return null;
  return { headers, rows };
}

function parseTableLine(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map((header) => cleanCell(header).toLowerCase());
  for (const candidate of candidates) {
    const index = normalizedHeaders.findIndex((header) => header.includes(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

function cleanCell(value) {
  return value
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function splitKeywords(examplesCell) {
  if (!examplesCell) return [];
  return examplesCell
    .split(',')
    .map((keyword) => cleanCell(keyword))
    .filter((keyword) => keyword.length > 0);
}

function normalizeOptionalOwner(owner) {
  if (!owner) return null;
  if (/^[-—–]+$/.test(owner)) return null;
  return owner;
}

function normalizeModulePath(modulePath) {
  return cleanCell(modulePath).replace(/\\/g, '/').toLowerCase();
}

function normalizeTextForPathMatch(text) {
  return text.replace(/\\/g, '/').replace(/`/g, '');
}

function normalizeName(value) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[^\w@\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMember(target, roster) {
  const normalizedTarget = normalizeName(target);
  if (!normalizedTarget) return null;

  for (const member of roster) {
    if (normalizeName(member.name) === normalizedTarget) return member;
  }

  for (const member of roster) {
    if (normalizeName(member.role) === normalizedTarget) return member;
  }

  for (const member of roster) {
    const memberName = normalizeName(member.name);
    if (normalizedTarget.includes(memberName) || memberName.includes(normalizedTarget)) {
      return member;
    }
  }

  for (const member of roster) {
    const memberRole = normalizeName(member.role);
    if (normalizedTarget.includes(memberRole) || memberRole.includes(normalizedTarget)) {
      return member;
    }
  }

  return null;
}

function findBestModuleMatch(issueText, modules) {
  let best = null;
  let bestLength = -1;

  for (const module of modules) {
    const modulePath = normalizeModulePath(module.modulePath);
    if (!modulePath) continue;
    if (!issueText.includes(modulePath)) continue;

    if (modulePath.length > bestLength) {
      best = module;
      bestLength = modulePath.length;
    }
  }

  return best;
}

function findBestRuleMatch(issueText, rules) {
  let best = null;
  let bestScore = 0;

  for (const rule of rules) {
    const matchedKeywords = rule.keywords
      .map((keyword) => keyword.toLowerCase())
      .filter((keyword) => keyword.length > 0 && issueText.includes(keyword));

    if (matchedKeywords.length === 0) continue;

    const score =
      matchedKeywords.length * 100 + matchedKeywords.reduce((sum, keyword) => sum + keyword.length, 0);
    if (score > bestScore) {
      best = { rule, matchedKeywords };
      bestScore = score;
    }
  }

  return best;
}

function findRoleKeywordMatch(issueText, roster) {
  for (const member of roster) {
    const role = member.role.toLowerCase();

    if (
      (role.includes('frontend') || role.includes('ui')) &&
      (issueText.includes('ui') || issueText.includes('frontend') || issueText.includes('css'))
    ) {
      return { agent: member, reason: 'Matched frontend/UI role keywords' };
    }

    if (
      (role.includes('backend') || role.includes('api') || role.includes('server')) &&
      (issueText.includes('api') || issueText.includes('backend') || issueText.includes('database'))
    ) {
      return { agent: member, reason: 'Matched backend/API role keywords' };
    }

    if (
      (role.includes('test') || role.includes('qa')) &&
      (issueText.includes('test') || issueText.includes('bug') || issueText.includes('fix'))
    ) {
      return { agent: member, reason: 'Matched testing/QA role keywords' };
    }
  }

  return null;
}

function findLeadFallback(roster) {
  return (
    roster.find((member) => {
      const role = member.role.toLowerCase();
      return role.includes('lead') || role.includes('architect');
    }) || null
  );
}

/**
 * Real, executable round-start gate (#245; #248 Garak finding 1 — "the
 * retro still is not wired into the real coordinator lifecycle"; #248
 * Kirk finding — "the gate is unsatisfiable in the only place it actually
 * enforces").
 *
 * squad-heartbeat.yml → this script is the one place in this repository
 * where "before queue construction" is an actual process boundary, not
 * prose read by an LLM: it runs as a GitHub Actions job on real triggers
 * (issue closed/labeled, PR closed, workflow_dispatch) and constructs a
 * real work queue (the triage `results` array) before that queue is acted
 * on. Wiring the retro-overdue check in HERE, before `buildTriageQueue` is
 * called, is genuine lifecycle enforcement — unlike the LLM coordinator's
 * own "Core Logic" prose, which no external test can prove a live session
 * actually executes.
 *
 * Satisfiability fix (Kirk, round 3): the first version of this gate
 * scanned `.squad/log/` for a `*retrospective*` file. That directory is
 * gitignored (see `.gitignore`), so a fresh `actions/checkout` — which
 * contains only committed files — can NEVER see a newly-written retro log,
 * even after a real retrospective runs. That made the gate permanently
 * "overdue" on this dispatcher: a false gate is exactly the failure class
 * #245 exists to eliminate. The fix uses a source this CI checkout CAN
 * see: the creation date of the most recent GitHub Issue carrying the
 * dedicated `retro-complete` marker label, applied only as the FINAL step
 * of a completed retrospective — after its log is written and every
 * action item has been verified as filed (see `RETRO_COMPLETION_LABEL`
 * below; this is deliberately NOT the `retro-action` label those action
 * items themselves carry — using an in-progress action-item issue as the
 * completion signal would race this workflow's own `issues: labeled`
 * trigger, resuming triage before the retro actually finished). GitHub
 * Issues are reachable via the REST API regardless of what a checkout
 * contains.
 *
 * Backend note: the retro signal is a GitHub Issue label, which is
 * independent of the state backend, so every known backend (local,
 * worktree, orphan, two-layer, git-notes) is evaluated from it. An unknown
 * backend value fails closed with `evaluated: false`.
 */
function readStateBackend(squadDir) {
  const configPath = path.join(squadDir, 'config.json');
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 'local'; // no config.json at all -> local is the documented default
    throw new Error(`could not read ${configPath}: ${err.message}`);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${configPath} is not valid JSON: ${err.message}`);
  }
  return typeof config.stateBackend === 'string' ? config.stateBackend : 'local';
}

const RETRO_GATE_KNOWN_BACKENDS = new Set(['local', 'worktree', 'orphan', 'two-layer', 'git-notes']);

// The retro ceremony's postcondition marker: a dedicated label applied to a
// GitHub Issue ONLY as the final step of a completed retrospective, after
// its log is written and every action item has been verified as filed
// (#248 Copilot review finding, second pass — "using the creation time of
// any retro-action issue as the completion signal creates a race with this
// workflow's issues: labeled trigger: creating/labeling the FIRST action
// item during a retrospective can start a heartbeat that sees the fresh
// issue and resumes triage before the retro log and remaining action items
// have been verified"). `retro-action` issues are still required and still
// filed throughout the ceremony (Action Item Enforcement, unchanged); this
// gate no longer reads that in-progress signal. See ceremonies.md's
// "Retrospective with Enforcement" agenda and SKILL.md's Action Item
// Enforcement section for the documented postcondition step that creates
// this marker.
const RETRO_COMPLETION_LABEL = 'retro-complete';
// Safety cap on pagination so a pathological result set (thousands of
// labeled PRs with no genuine issue among them) cannot loop indefinitely
// or hammer the API; 10 pages of 100 is already far beyond any realistic
// backlog for this signal.
const MAX_RETRO_SIGNAL_PAGES = 10;

/**
 * The CI-observable retro signal: the creation timestamp of the most
 * recent GitHub Issue carrying the retro-completion marker label, or
 * `null` if none exists. Injectable (`githubRequestJsonImpl`) so tests can
 * simulate a fresh or stale/absent retro without a network call.
 *
 * The REST Issues endpoint also returns pull requests carrying the same
 * label (a PR is "an issue" in GitHub's API model), and `isUntriagedIssue`
 * elsewhere in this file already has to account for that. This paginates
 * (up to `MAX_RETRO_SIGNAL_PAGES`) and skips any entry carrying a
 * `pull_request` field until it finds a genuine Issue or exhausts the
 * result set — a single page is not enough: if more labeled PRs exist than
 * fit on one page, a genuine issue on a later page must not be missed and
 * silently reported as "no retro signal" (#248 Copilot review finding).
 */
async function fetchLatestRetroCompletionDate({ owner, repo, token, githubRequestJsonImpl = githubRequestJson }) {
  for (let page = 1; page <= MAX_RETRO_SIGNAL_PAGES; page++) {
    const query = new URLSearchParams({
      labels: RETRO_COMPLETION_LABEL,
      state: 'all',
      sort: 'created',
      direction: 'desc',
      per_page: '100',
      page: String(page),
    });
    const items = await githubRequestJsonImpl(`/repos/${owner}/${repo}/issues?${query.toString()}`, token);
    if (!Array.isArray(items) || items.length === 0) return null;

    const issue = items.find((item) => item && !item.pull_request);
    if (issue) {
      const createdAt = issue.created_at;
      return typeof createdAt === 'string' ? createdAt : null;
    }

    if (items.length < 100) return null; // last page, and every entry was a PR
  }
  return null; // exhausted MAX_RETRO_SIGNAL_PAGES without finding a genuine issue
}

/**
 * Validate the JSON emitted by check-retro-overdue.mjs before trusting it
 * (#248 Garak finding 1: "validate the child JSON... before accepting
 * it"). Anything that does not match the exact expected shape is treated
 * as a fault, never silently coerced into a domain result.
 */
function validateOverdueResult(parsed, expectedBackend) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'result is not a JSON object' };
  if (parsed.evaluated !== true) return { ok: false, reason: `evaluated is not true (${JSON.stringify(parsed.evaluated)})` };
  if (typeof parsed.overdue !== 'boolean') return { ok: false, reason: `overdue is not a boolean (${JSON.stringify(parsed.overdue)})` };
  if (parsed.backend !== expectedBackend) {
    return { ok: false, reason: `backend mismatch: expected "${expectedBackend}", got ${JSON.stringify(parsed.backend)}` };
  }
  return { ok: true };
}

async function evaluateRetroGate({
  repoRoot,
  squadDir,
  owner,
  repo,
  token,
  windowDays = 7,
  execFileSyncImpl = execFileSync,
  fetchRetroSignalImpl = fetchLatestRetroCompletionDate,
}) {
  let backend;
  try {
    backend = readStateBackend(squadDir);
  } catch (err) {
    // A malformed/unreadable config.json (as opposed to a simply-missing
    // one) must never silently default to "local" — that would let a
    // repository actually running a governed backend fail OPEN through a
    // fresh retro-completion signal. Report unevaluated instead.
    return { evaluated: false, backend: 'unknown', overdue: false, reason: `could not determine stateBackend: ${err.message}` };
  }

  if (!RETRO_GATE_KNOWN_BACKENDS.has(backend)) {
    return { evaluated: false, backend, overdue: false, reason: `unknown stateBackend "${backend}" - round-start retro gate cannot be evaluated (fail closed)` };
  }

  let signalDate;
  try {
    signalDate = await fetchRetroSignalImpl({ owner, repo, token });
  } catch (err) {
    return { evaluated: false, backend, overdue: false, reason: `failed to fetch retro-completion issue signal: ${err.message}` };
  }

  const scriptPath = path.join(repoRoot, 'scripts', 'check-retro-overdue.mjs');
  // Synthesize a filename check-retro-overdue.mjs's parser understands, so
  // the SAME tested overdue-window logic (UTC parsing, future-date
  // rejection, fail-closed-on-ambiguity) is reused for this signal rather
  // than duplicated. GitHub's `created_at` is `YYYY-MM-DDTHH:MM:SSZ` (no
  // fractional seconds) — truncate to whole seconds defensively (in case
  // any caller/mock supplies a value with milliseconds) before swapping
  // colons for dashes, so the synthesized filename always matches
  // check-retro-overdue.mjs's strict ISO_TIMESTAMP_RE (exactly HH-MM-SSZ,
  // never a fractional-seconds suffix). A signalDate that fails to parse
  // as a real Date yields no entry at all — the same fail-closed handling
  // check-retro-overdue.mjs already applies to any unparseable filename.
  let entries = [];
  if (signalDate) {
    const parsedDate = new Date(signalDate);
    if (!Number.isNaN(parsedDate.getTime())) {
      entries = [`${parsedDate.toISOString().slice(0, 19).replace(/:/g, '-')}Z-retrospective.md`];
    }
  }

  let output;
  try {
    output = execFileSyncImpl(
      process.execPath,
      [scriptPath, 'overdue', '--backend', backend, '--entries-stdin', '--window-days', String(windowDays)],
      { encoding: 'utf8', input: JSON.stringify({ entries }) },
    );
  } catch (err) {
    // A nonzero exit from check-retro-overdue.mjs here is a dispatcher
    // fault (bad args, unreadable script) — never silently treated as
    // "not overdue".
    return { evaluated: false, backend, overdue: false, reason: `check-retro-overdue.mjs invocation failed: ${err.message}` };
  }

  const lastLine = output.trim().split('\n').filter(Boolean).pop() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(lastLine);
  } catch (err) {
    return { evaluated: false, backend, overdue: false, reason: `check-retro-overdue.mjs produced unparseable output: ${err.message}` };
  }

  const validation = validateOverdueResult(parsed, backend);
  if (!validation.ok) {
    return { evaluated: false, backend, overdue: false, reason: `check-retro-overdue.mjs returned an unexpected result: ${validation.reason}` };
  }

  return { evaluated: true, backend, overdue: parsed.overdue, windowDays, signalDate };
}

/**
 * Pure queue-construction step, extracted so tests can call it directly
 * with a fake issue list (a "fake queue/spawn boundary") without touching
 * the GitHub API. Called from `main()` AFTER `evaluateRetroGate` — when the
 * gate reports overdue, `main()` does not call this at all, which is the
 * "block other work" semantic from the retro-enforcement skill's
 * documented Blocking Semantics.
 */
function buildTriageQueue(untriagedIssues, rules, modules, roster) {
  const results = [];
  for (const issue of untriagedIssues) {
    const decision = triageIssue(issue, rules, modules, roster);
    if (!decision) continue;
    results.push({
      issueNumber: issue.number,
      assignTo: decision.agent.name,
      label: decision.agent.label,
      reason: decision.reason,
      source: decision.source,
    });
  }
  return results;
}

function parseOwnerRepoFromRemote(remoteUrl) {
  const sshMatch = remoteUrl.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  if (remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://') || remoteUrl.startsWith('ssh://')) {
    const parsed = new URL(remoteUrl);
    const parts = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  }

  throw new Error(`Unable to parse owner/repo from remote URL: ${remoteUrl}`);
}

function getOwnerRepoFromGit() {
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  return parseOwnerRepoFromRemote(remoteUrl);
}

/**
 * Resolve the GitHub REST API base URL from the environment, so triage
 * works on GitHub Enterprise as well as github.com.
 *
 * Order: GITHUB_API_URL (set by Actions on both github.com and GHE runners)
 * > GITHUB_SERVER_URL + /api/v3 (GHE without an explicit API URL)
 * > https://api.github.com (fallback for local/non-Actions runs).
 */
function resolveGithubApiBase() {
  const apiUrl = process.env.GITHUB_API_URL;
  if (apiUrl) return apiUrl.replace(/\/+$/, '');

  const serverUrl = process.env.GITHUB_SERVER_URL;
  if (serverUrl) return `${serverUrl.replace(/\/+$/, '')}/api/v3`;

  return 'https://api.github.com';
}

function githubRequestJson(pathname, token) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(`${resolveGithubApiBase()}${pathname}`);
    const req = https.request(
      requestUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'squad-ralph-triage',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Failed to parse GitHub response: ${error.message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchSquadIssues(owner, repo, token) {
  const all = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const query = new URLSearchParams({
      state: 'open',
      labels: 'squad',
      per_page: String(perPage),
      page: String(page),
    });
    const issues = await githubRequestJson(`/repos/${owner}/${repo}/issues?${query.toString()}`, token);
    if (!Array.isArray(issues) || issues.length === 0) break;
    all.push(...issues);
    if (issues.length < perPage) break;
    page += 1;
  }

  return all;
}

function issueHasLabel(issue, labelName) {
  const target = labelName.toLowerCase();
  return (issue.labels || []).some((label) => {
    if (!label) return false;
    const name = typeof label === 'string' ? label : label.name;
    return typeof name === 'string' && name.toLowerCase() === target;
  });
}

function isUntriagedIssue(issue, memberLabels) {
  if (issue.pull_request) return false;
  if (!issueHasLabel(issue, 'squad')) return false;
  return !memberLabels.some((label) => issueHasLabel(issue, label));
}

/**
 * The full round, with every externally-effectful dependency injectable
 * (#248 Garak finding 4: "export/inject main() dependencies and assert
 * actual main-level queue fetch/build suppression" — not a reimplemented
 * predicate). `main()` below is a thin CLI wrapper around this.
 *
 * Fail-closed contract (#248 Garak/Kirk finding 1): queue construction
 * proceeds ONLY when `retroGate.evaluated === true && retroGate.overdue
 * === false`. Any other outcome — unsupported backend, fetch/spawn fault,
 * malformed/invalid child JSON, or a confirmed overdue result — blocks
 * this round's triage. `canProceed` is written to the output file so
 * squad-heartbeat.yml can gate the later "Assign @copilot issues" step on
 * the exact same condition, not just empty `results`.
 */
async function runRound({
  squadDir,
  repoRoot,
  token,
  owner,
  repo,
  windowDays = 7,
  execFileSyncImpl = execFileSync,
  fetchRetroSignalImpl = fetchLatestRetroCompletionDate,
  fetchSquadIssuesImpl = fetchSquadIssues,
}) {
  const teamMd = fs.readFileSync(path.join(squadDir, 'team.md'), 'utf8');
  const routingMd = fs.readFileSync(path.join(squadDir, 'routing.md'), 'utf8');

  const roster = parseRoster(teamMd);
  const rules = parseRoutingRules(routingMd);
  const modules = parseModuleOwnership(routingMd);

  // Round-start retro gate, evaluated BEFORE any queue construction
  // (#245; #248 Garak finding 1).
  const retroGate = await evaluateRetroGate({
    repoRoot,
    squadDir,
    owner,
    repo,
    token,
    windowDays,
    execFileSyncImpl,
    fetchRetroSignalImpl,
  });

  const canProceed = retroGate.evaluated === true && retroGate.overdue === false;

  let results = [];
  if (canProceed) {
    const openSquadIssues = await fetchSquadIssuesImpl(owner, repo, token);
    const memberLabels = roster.map((member) => member.label);
    const untriaged = openSquadIssues
      .filter((issue) => isUntriagedIssue(issue, memberLabels))
      .map((issue) => ({ number: issue.number, title: issue.title || '', body: issue.body || '', labels: [] }));

    results = buildTriageQueue(untriaged, rules, modules, roster);
  } else if (retroGate.evaluated && retroGate.overdue) {
    console.log(`[RETRO] Overdue — skipping issue triage this round (backend: ${retroGate.backend}).`);
  } else {
    console.log(
      `[RETRO] Round-start gate not confirmed satisfied for backend "${retroGate.backend}" — blocking this ` +
        `round's triage rather than proceeding open (fail closed). Reason: ${retroGate.reason || 'unknown'}`,
    );
  }

  return { retroGate, results, canProceed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const squadDir = path.resolve(process.cwd(), args.squadDir);
  const repoRoot = path.resolve(squadDir, '..');
  const { owner, repo } = getOwnerRepoFromGit();

  const { retroGate, results, canProceed } = await runRound({ squadDir, repoRoot, token, owner, repo });

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ retroGate, results, canProceed }, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  resolveGithubApiBase,
  readStateBackend,
  fetchLatestRetroCompletionDate,
  validateOverdueResult,
  evaluateRetroGate,
  buildTriageQueue,
  runRound,
  triageIssue,
  isUntriagedIssue,
  parseRoster,
  parseRoutingRules,
  parseModuleOwnership,
};
