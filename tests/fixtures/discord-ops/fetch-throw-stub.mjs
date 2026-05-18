// Test fixture: replace global fetch with a stub that ALWAYS throws,
// simulating a transport-level failure (DNS, TCP, TLS — anything that
// makes `await fetch(...)` reject rather than return a Response).
//
// Use to exercise the `discordPatch` catch-clause that re-throws a
// plain `Error` (NOT `DiscordApiError`), which the CLI loop maps to
// exit code 1 (operator/infra) per the USAGE exit-code table.
//
// The stub writes nothing to stderr — the script's own redacted error
// message is what we want to observe.

globalThis.fetch = async () => {
  throw new TypeError("getaddrinfo ENOTFOUND discord.invalid");
};
