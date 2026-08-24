import { readFile } from "node:fs/promises";
import { joinSession } from "@github/copilot-sdk/extension";

const configUrl = new URL("../../mcp.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));
const squadState = config.mcpServers?.squad_state;

if (!squadState) {
  throw new Error(`${configUrl.pathname} does not declare mcpServers.squad_state`);
}

await joinSession({
  mcpServers: {
    squad_state: squadState,
  },
});
