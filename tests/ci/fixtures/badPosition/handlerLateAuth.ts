// Fixture: non-compliant handler — imports + calls requireAllowedUser, BUT
// executes side-effecting code before the auth guard. The hardened gate
// must flag this even though both the import and the call
// are present (the legacy presence-only gate let this slip through).
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { requireAllowedUser } from "./_lib/auth.js";

app.http("handlerLateAuth", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    const log = console.log; // ← arbitrary statement BEFORE auth — must trip the gate
    log("about to authenticate");
    requireAllowedUser(req);
    return { status: 200, body: "leaked" };
  },
});
