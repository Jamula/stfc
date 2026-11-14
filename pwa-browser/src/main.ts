import { LoginSessionManager } from "./login-sessions.js";
import { PlaywrightLoginFactory } from "./playwright-login.js";
import { createBrowserRelayServer } from "./server.js";

const secret = process.env["PWA_BROWSER_KEY"];
if (!secret || secret.length < 32) throw new Error("PWA_BROWSER_KEY must contain at least 32 characters.");

const port = Number(process.env["PORT"] ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");

const service = new LoginSessionManager(new PlaywrightLoginFactory());
const server = createBrowserRelayServer(service, secret);
server.listen(port, "0.0.0.0");
