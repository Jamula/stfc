import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Functions entrypoint", () => {
  it("registers the token session route when the entrypoint loads", () => {
    const script = `
      import { createRequire } from "node:module";
      const require = createRequire(new URL("./api/package.json", import.meta.url));
      const { app } = require("@azure/functions");
      const registrations = [];
      app.http = (name, options) => registrations.push({
        name, route: options.route, methods: options.methods,
        authLevel: options.authLevel, handlerType: typeof options.handler,
      });
      await import("./api/src/index.ts");
      console.log(JSON.stringify(registrations));
    `;
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "--input-type=module", "--eval", script,
    ], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
    const registrations = JSON.parse(output) as unknown[];
    assert.deepEqual(registrations.find((entry) =>
      typeof entry === "object" && entry !== null && "name" in entry && entry.name === "token-session"
    ), {
      name: "token-session",
      route: "token-session/{action}",
      methods: ["GET", "POST"],
      authLevel: "anonymous",
      handlerType: "function",
    });
  });
});
