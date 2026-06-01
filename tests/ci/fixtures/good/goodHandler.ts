// Fixture: compliant handler — imports @azure/functions + calls requireAllowedUser.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { requireAllowedUser } from "./_lib/auth.js";

app.http("goodHandler", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    requireAllowedUser(req);
    return { status: 200, body: "ok" };
  },
});
