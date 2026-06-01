// Fixture: compliant handler with the canonical `try { … } catch (e) { errorResponse(e) }`
// wrap. The hardened gate (Garak P0#1) must descend into the leading `try {` block and
// recognise the auth guard call as the first non-trivial statement INSIDE the try body.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { requireAllowedUser } from "./_lib/auth.js";

app.http("goodTryWrapHandler", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const p = requireAllowedUser(req);
      return { status: 200, body: `hi ${p}` };
    } catch (_e) {
      return { status: 500, body: "err" };
    }
  },
});
