// T019 [US1] — curated stoplist for the precision-first code extractor.
//
// Every entry is a string that matches the core regex `^[A-Z][A-Z0-9]{3,19}$`
// but is NOT a real STFC promo code. Three categories:
//
//   1. Format-example placeholders that appear in documentation
//      (spec § Edge Cases: "the code format is `XXXXX-YYYYY`").
//   2. Common ALL-CAPS abbreviations players use conversationally
//      (HTTP/JSON, gaming acronyms like LFG/WTB, chat shorthand like LOL).
//   3. Frequent ALL-CAPS English words that occasionally appear in shouty
//      chat (THE/AND/YOU) — kept short on purpose because anything 4+ chars
//      that's a real English word is rare.
//
// Membership is checked AFTER normalization (uppercase, decoration stripped).
// Adding an entry costs O(1) lookup; the table is exported so tests can
// assert membership directly.

export const STOPLIST: ReadonlySet<string> = new Set<string>([
  // (1) Format-example placeholders
  "XXXXX",
  "YYYYY",
  "XXXXXYYYYY",
  "ZZZZZ",
  "AAAAA",

  // (2) Tech abbreviations / acronyms
  "HTTP",
  "HTTPS",
  "HTTP2",
  "HTTP3",
  "JSON",
  "HTML",
  "HTML5",
  "CSS",
  "CSS3",
  "URL",
  "URI",
  "API",
  "SDK",
  "JWT",
  "REST",
  "GRPC",
  "TCP",
  "UDP",
  "DNS",
  "SSL",
  "TLS",
  "YAML",
  "TOML",
  "REGEX",
  "REPO",
  "CICD",
  // Common conversational words that match the regex but aren't promo codes
  "CODE",
  "GAME",
  "TEXT",
  "DATA",
  "INFO",
  "FILE",
  "TYPE",
  "LIST",
  "LINK",
  "ITEM",

  // (2) Gaming / STFC chat acronyms
  "STFC",
  "MMO",
  "RPG",
  "NPC",
  "PVE",
  "PVP",
  "LFG",
  "LFM",
  "WTB",
  "WTS",
  "AFK",
  "BRB",
  "OMW",
  "DPS",
  "BUFF",
  "NERF",
  "RAID",
  "FLEET",
  "ARMADA",
  "WAVE",
  "MIRROR",

  // (2) Chat shorthand
  "LOL",
  "ROFL",
  "LMAO",
  "ASAP",
  "FYI",
  "IDK",
  "IIRC",
  "TLDR",
  "TLDW",
  "AFAIK",
  "IMHO",
  "TBH",
  "BTW",
  "OMG",
  "OOF",
  "MEME",
  "NICE",
  "COOL",
  "GOOD",
  "OKAY",
  "YEAH",

  // (3) High-frequency ALL-CAPS English words
  "THE",
  "AND",
  "YOU",
  "WHAT",
  "WHEN",
  "WHERE",
  "WHY",
  "HERE",
  "THERE",
  "THIS",
  "THAT",
  "WITH",
  "FROM",
  "JUST",
  "WILL",
  "WOULD",
  "COULD",
  "SHOULD",
  "HAVE",
  "BEEN",
  "THEY",
  "THEM",
  "THEIR",
  "OURS",
  "YOUR",
  "MINE",
  "ABOUT",
  "AFTER",
  "BEFORE",
  "AGAIN",
]);

export function isOnStoplist(candidate: string): boolean {
  return STOPLIST.has(candidate.toUpperCase());
}
