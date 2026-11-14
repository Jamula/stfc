import { AzureConditionalAccountBlob } from "./azure-account-blob.js";
import { createTokenApiServer } from "./http-server.js";
import { TokenAccountStore } from "../../shared/token-accounts.js";

const apiKey = process.env["PWA_TOKEN_API_KEY"];
const browserKey = process.env["PWA_BROWSER_KEY"];
const browserUrl = process.env["PWA_BROWSER_URL"];
if (!apiKey || apiKey.length < 32 || !browserKey || browserKey.length < 32 || !browserUrl) {
  throw new Error("Token API configuration is incomplete.");
}

const port = Number(process.env["PORT"] ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");

const store = new TokenAccountStore(AzureConditionalAccountBlob.fromEnvironment());
createTokenApiServer({ apiKey, browserUrl, browserKey, store }).listen(port, "0.0.0.0");
