export const REVIEW_GATE_CONTEXT: "Squad reviewer gate";

export interface IssueComment {
  id?: number | string;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ParsedVerdict {
  commentId: string;
  verdict: string;
  reviewer: string | null;
  headSha: string | null;
  timestamp: number | null;
  errors: string[];
}

export interface ReviewerLaneResult {
  reviewer: string;
  ok: boolean;
  reason: string;
}

export interface ReviewerGateResult {
  ok: boolean;
  state: "success" | "failure";
  description: string;
  headSha: string;
  requiredLanes: string[];
  laneResults: ReviewerLaneResult[];
  errors: string[];
}

export function extractReviewerLanes(prBody: string | null | undefined): string[];
export function parseVerdictComment(comment: IssueComment): ParsedVerdict | null;
export function evaluateReviewerGate(input: {
  prBody: string | null | undefined;
  headSha: string;
  comments: IssueComment[];
}): ReviewerGateResult;
export function getPullRequestNumber(eventPayload: unknown): number;
export function runReviewerGate(input: {
  eventPayload: unknown;
  token: string;
  repository: string;
  apiUrl?: string;
  targetUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<ReviewerGateResult & { pullNumber: number }>;
