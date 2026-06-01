// Fixture: opted-out anonymous handler with justification comment.
// @auth-anonymous-justification: public health check endpoint, no user context needed
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

app.http("anonHandler", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    return { status: 200, body: "healthy" };
  },
});
