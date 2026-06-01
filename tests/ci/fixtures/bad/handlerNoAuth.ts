// Fixture: non-compliant handler — imports @azure/functions but does NOT call requireAllowedUser.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

app.http("handlerNoAuth", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    return { status: 200, body: "missing auth!" };
  },
});
