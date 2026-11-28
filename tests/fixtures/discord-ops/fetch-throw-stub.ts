// Test fixture: replace global fetch with a stub that ALWAYS throws.

globalThis.fetch = async (): Promise<Response> => {
  throw new TypeError("getaddrinfo ENOTFOUND discord.invalid");
};
