# Playwright MCP

This repo ships a project-local Copilot CLI MCP config at
[`.copilot/mcp-config.json`](../.copilot/mcp-config.json) that registers
Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp)
server. It's useful if you want to drive a real browser from a Copilot
prompt to **explore** the STFC web store interactively (e.g. inspect a new
endpoint, debug a layout change, or screenshot a flow for a bug report).

## Launching Copilot CLI with the MCP loaded

The project MCP config is opt-in per session — it doesn't pollute your
global `~/.copilot/mcp-config.json`. Start the CLI like this:

```bash
copilot --additional-mcp-config @.copilot/mcp-config.json
```

The `@` prefix tells Copilot to read the file (instead of treating the
argument as a literal JSON string). Once the session starts, run
`/mcp` to confirm the `playwright` server is loaded, or `/env` to see
all sources of context.

The first time the MCP runs, it will download Chromium via npx. Subsequent
launches reuse the cached binary.

## Example prompts

Once the MCP is loaded, you can ask Copilot things like:

- *"Open the STFC store with playwright, take a screenshot, and tell me
  which login providers are offered."*
- *"Use playwright to navigate to the store, inspect the page's
  localStorage keys after I log in, and report what's there."*
- *"Use playwright to monitor network traffic on the store's gifts page
  for 30 seconds and tell me which API endpoints get called."*

## ⚠️ Do NOT use the MCP for credential capture

Use **`npm run capture-token`** instead — it's a standalone script that
writes the JWT directly to your local `.env` (and optionally to the
GitHub secret via `gh`) **without ever exposing the token to an AI
transcript or any other process**.

If you ask Copilot to capture your token via the MCP, the JWT will
flow through the LLM context and may end up in:

- the Copilot CLI session log (~/.copilot/logs/)
- any session transcript you `/share`
- the model provider's request/response logs
- your terminal scrollback

The dedicated `capture-token` script avoids all of that by handling the
token exclusively in the Node process and piping it directly to `gh`'s
stdin (so it never touches the command line either).

See [SETUP.md](./SETUP.md) for the full token-capture workflow.

## Removing the MCP from a running session

`/mcp remove playwright` from inside Copilot. Or just restart the CLI
without the `--additional-mcp-config` flag — the project MCP only loads
when you explicitly opt in.
