import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { requireOwner } from "../_lib/auth.js";
import { errorResponse } from "../_lib/respond.js";

const REPOSITORY = "Jamula/stfc";
const WORKFLOW = "redeem.yml";
const REF = "main";

function response(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
    jsonBody: body,
  };
}

export async function handler(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireOwner(req);
    if (req.method !== "POST") return response(405, { error: "Method not allowed." });

    if (req.headers.get("x-stfc-pwa-action") !== "trigger-redeem") {
      return response(403, { error: "Cross-origin requests are not allowed." });
    }

    const token = process.env["PWA_GITHUB_DISPATCH_TOKEN"];
    if (!token) return response(503, { error: "Discord command service is not configured." });

    let result: Response;
    try {
      result = await fetch(
        `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ ref: REF }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      return response(502, { error: "The redeem workflow could not be reached." });
    }
    if (!result.ok) {
      context.error("PWA redeem workflow dispatch failed", result.status);
      return response(502, { error: "The redeem workflow could not be started." });
    }
    return response(202, { accepted: true, workflow: "redeem", ref: REF });
  } catch (error) {
    context.error("Discord command request failed", error instanceof Error ? error.name : "UnknownError");
    return errorResponse(error);
  }
}

app.http("discord-command", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "discord-command/trigger-redeem",
  handler,
});
