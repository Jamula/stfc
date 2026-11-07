import { app } from "@azure/functions";

app.http("internal", {
  handler: async (request) => {
    return { status: 200, jsonBody: { ok: true } };
  },
});
