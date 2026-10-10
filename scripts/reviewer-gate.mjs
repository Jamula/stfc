import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REVIEW_GATE_CONTEXT = "Squad reviewer gate";

const VERDICT_HEADER_RE = /^\s*\*\*(APPROVE|CHANGES_REQUESTED)\*\*/i;
const REVIEWER_LINE_RE = /^\s*\*\*Reviewer:\*\*\s*(.+?)\s*$/im;
const HEAD_LINE_RE = /^\s*\*\*Head:\*\*\s*`([0-9a-f]{40})`\s*$/im;
const REVIEWER_SECTION_RE =
  /(?:^|\n)## Reviewer lanes\s*\n([\s\S]*?)(?=\n##\s|\s*$)/i;
const REVIEWER_BULLET_RE = /^-\s+\*\*([^*]+)\*\*/gm;

function normalizeReviewerName(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isPlaceholderReviewer(value) {
  return /[<>]/.test(value) || /^(reviewer|name|tbd|todo)$/i.test(value.trim());
}

export function extractReviewerLanes(prBody) {
  const match = REVIEWER_SECTION_RE.exec(prBody ?? "");
  if (!match) return [];

  const lanes = [];
  const seen = new Set();
  for (const bullet of match[1].matchAll(REVIEWER_BULLET_RE)) {
    const reviewer = bullet[1].trim();
    if (!reviewer || isPlaceholderReviewer(reviewer)) continue;
    const key = normalizeReviewerName(reviewer);
    if (seen.has(key)) continue;
    seen.add(key);
    lanes.push(reviewer);
  }
  return lanes;
}

export function parseVerdictComment(comment) {
  const body = comment.body ?? "";
  const header = VERDICT_HEADER_RE.exec(body);
  if (!header) return null;

  const reviewerMatch = REVIEWER_LINE_RE.exec(body);
  const headMatch = HEAD_LINE_RE.exec(body);
  const timestampText = comment.created_at;
  const timestamp = Date.parse(timestampText ?? "");
  const errors = [];

  if (!reviewerMatch || isPlaceholderReviewer(reviewerMatch?.[1] ?? "")) {
    errors.push("missing or placeholder **Reviewer:** line");
  }
  if (!headMatch) {
    errors.push("missing full 40-character **Head:** SHA line");
  }
  if (!Number.isFinite(timestamp)) {
    errors.push("missing or invalid comment creation timestamp");
  }

  return {
    commentId: String(comment.id ?? ""),
    verdict: header[1].toUpperCase(),
    reviewer: reviewerMatch?.[1]?.trim() ?? null,
    headSha: headMatch?.[1]?.toLowerCase() ?? null,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    errors,
  };
}

function compareVerdicts(left, right) {
  const timeDelta = (left.timestamp ?? -1) - (right.timestamp ?? -1);
  if (timeDelta !== 0) return timeDelta;
  const leftId = Number(left.commentId);
  const rightId = Number(right.commentId);
  if (Number.isSafeInteger(leftId) && Number.isSafeInteger(rightId)) {
    return leftId - rightId;
  }
  return left.commentId.localeCompare(right.commentId);
}

export function evaluateReviewerGate({
  prBody,
  headSha,
  comments,
  pullRequestAuthor,
}) {
  const normalizedHead = String(headSha ?? "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedHead)) {
    throw new Error("Reviewer gate requires the PR's full 40-character head SHA.");
  }
  if (!Array.isArray(comments)) {
    throw new Error("Reviewer gate requires an issue-comment array.");
  }
  if (pullRequestAuthor === "dependabot[bot]") {
    return {
      ok: true,
      state: "success",
      description: "Reviewer verdicts are not required for Dependabot pull requests.",
      headSha: normalizedHead,
      requiredLanes: [],
      laneResults: [],
      errors: [],
    };
  }

  const requiredLanes = extractReviewerLanes(prBody);
  const parsed = comments
    .map(parseVerdictComment)
    .filter((verdict) => verdict !== null);
  const globalErrors = parsed
    .filter((verdict) => verdict.errors.length > 0)
    .map(
      (verdict) =>
        `comment ${verdict.commentId || "<unknown>"}: ${verdict.errors.join(", ")}`,
    );
  const laneResults = [];

  if (requiredLanes.length === 0) {
    globalErrors.push(
      "PR body must declare at least one non-placeholder reviewer under ## Reviewer lanes.",
    );
  }

  for (const lane of requiredLanes) {
    const laneKey = normalizeReviewerName(lane);
    const verdicts = parsed
      .filter(
        (verdict) =>
          verdict.reviewer &&
          normalizeReviewerName(verdict.reviewer) === laneKey &&
          verdict.errors.length === 0,
      )
      .sort(compareVerdicts);
    const latest = verdicts.at(-1);

    if (!latest) {
      laneResults.push({
        reviewer: lane,
        ok: false,
        reason: "missing a valid verdict",
      });
      continue;
    }
    if (latest.headSha !== normalizedHead) {
      laneResults.push({
        reviewer: lane,
        ok: false,
        reason: `latest verdict targets stale head ${latest.headSha}`,
      });
      continue;
    }
    if (latest.verdict !== "APPROVE") {
      laneResults.push({
        reviewer: lane,
        ok: false,
        reason: "latest verdict is CHANGES_REQUESTED",
      });
      continue;
    }

    laneResults.push({
      reviewer: lane,
      ok: true,
      reason: `approved head ${normalizedHead}`,
    });
  }

  const ok =
    requiredLanes.length > 0 &&
    globalErrors.length === 0 &&
    laneResults.every((lane) => lane.ok);
  const failedLanes = laneResults.filter((lane) => !lane.ok);
  const description = ok
    ? `Approved for ${requiredLanes.length} reviewer lane(s) at ${normalizedHead.slice(0, 12)}.`
    : `Blocked: ${globalErrors.length} invalid verdict(s), ${failedLanes.length} reviewer lane(s) pending.`;

  return {
    ok,
    state: ok ? "success" : "failure",
    description,
    headSha: normalizedHead,
    requiredLanes,
    laneResults,
    errors: globalErrors,
  };
}

export function getPullRequestNumber(eventPayload) {
  const number =
    eventPayload?.pull_request?.number ??
    (eventPayload?.issue?.pull_request ? eventPayload.issue.number : null);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(
      "Reviewer gate only supports pull_request_target and pull-request issue_comment events.",
    );
  }
  return number;
}

async function githubRequest({
  token,
  apiUrl,
  repository,
  route,
  method = "GET",
  body,
  fetchImpl,
}) {
  const response = await fetchImpl(
    `${apiUrl}/repos/${repository}${route}`,
    {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "stfc-squad-reviewer-gate",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${route} failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function fetchAllIssueComments(options, pullNumber) {
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubRequest({
      ...options,
      route: `/issues/${pullNumber}/comments?per_page=100&page=${page}`,
    });
    if (!Array.isArray(batch)) {
      throw new Error("GitHub issue-comments response was not an array.");
    }
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
  throw new Error(
    "Reviewer gate refuses to truncate a PR with more than 2,000 issue comments.",
  );
}

export async function runReviewerGate({
  eventPayload,
  token,
  repository,
  apiUrl = "https://api.github.com",
  targetUrl,
  fetchImpl = globalThis.fetch,
}) {
  if (!token) throw new Error("REVIEW_GATE_TOKEN is required.");
  if (!/^[^/]+\/[^/]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_REPOSITORY must be in owner/repo form.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const pullNumber = getPullRequestNumber(eventPayload);
  const requestOptions = { token, apiUrl, repository, fetchImpl };
  const pull = await githubRequest({
    ...requestOptions,
    route: `/pulls/${pullNumber}`,
  });
  const headSha = pull?.head?.sha;

  let result;
  try {
    const comments = await fetchAllIssueComments(requestOptions, pullNumber);
    result = evaluateReviewerGate({
      prBody: pull?.body ?? "",
      headSha,
      comments,
      pullRequestAuthor: pull?.user?.login,
    });
  } catch (error) {
    if (/^[0-9a-f]{40}$/i.test(headSha ?? "")) {
      await githubRequest({
        ...requestOptions,
        route: `/statuses/${headSha}`,
        method: "POST",
        body: {
          state: "error",
          context: REVIEW_GATE_CONTEXT,
          description: "Reviewer gate could not evaluate the current PR head.",
          target_url: targetUrl,
        },
      });
    }
    throw error;
  }

  await githubRequest({
    ...requestOptions,
    route: `/statuses/${result.headSha}`,
    method: "POST",
    body: {
      state: result.state,
      context: REVIEW_GATE_CONTEXT,
      description: result.description.slice(0, 140),
      target_url: targetUrl,
    },
  });

  return { pullNumber, ...result };
}

async function main() {
  const eventPath = process.argv[2];
  if (!eventPath) {
    throw new Error("Usage: node scripts/reviewer-gate.mjs <event-payload.json>");
  }
  const eventPayload = JSON.parse(await readFile(eventPath, "utf8"));
  const targetUrl =
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
  const result = await runReviewerGate({
    eventPayload,
    token: process.env.REVIEW_GATE_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
    targetUrl,
  });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
