// Endpoint-narrowing pinning test for
// `scripts/discord-ops/set-discord-app-metadata.mjs`.
//
// Garak PR #71 MED-1: the constitution v1.5.0 carve-out narrows the
// /api/v10 write surface to exactly two endpoints. The constitution
// test (`tests/constitution/discord-ops-carveout.test.ts`) pins the
// prose side. This file pins the IMPLEMENTATION side — the actual
// script must not learn to PATCH any other endpoint without first
// requiring an amendment.
//
// Strategy:
//   (a) the base URL constant is exactly `https://discord.com/api/v10`
//       (with NO trailing path segment),
//   (b) every `path:` literal passed to `discordPatch` is one of
//       `/users/@me` or `/applications/@me`,
//   (c) no other Discord REST endpoint string (e.g. `/channels/...`,
//       `/guilds/...`, `/webhooks/...`, `/applications/{id}/emojis`)
//       appears anywhere in the script source.
//
// Why source-grep rather than runtime instrumentation: the script is
// a single-file mjs with zero deps, so the set of paths it can possibly
// PATCH is bounded by the string literals. A grep guard is precise and
// cheap, and the same regex can be re-used by future audit tooling.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "discord-ops",
  "set-discord-app-metadata.mjs",
);

const scriptExists = fs.existsSync(SCRIPT);
const scriptText = scriptExists ? fs.readFileSync(SCRIPT, "utf8") : undefined;

// Discord REST path prefixes we explicitly forbid in this script. Each
// would represent a broader-than-authorized write surface and demand
// a constitution amendment per repository governance docs.
const FORBIDDEN_PREFIXES = [
  "/channels/",
  "/guilds/",
  "/webhooks/",
  "/interactions/",
  "/stage-instances/",
  "/invites/",
  "/stickers/",
  "/teams/",
  "/gateway",
  "/oauth2/",
  // `/applications/{id}/emojis`, `/applications/{id}/commands`, etc.
  // The narrow grant is ONLY `/applications/@me` (singular, owner
  // scope). Any path under `/applications/<id>/` other than the bare
  // `/applications/@me` requires a constitution amendment.
];

describe(
  "scripts/discord-ops/set-discord-app-metadata.mjs — endpoint narrowing (Garak MED-1)",
  { skip: !scriptExists },
  () => {
    it("DISCORD_API_BASE is exactly `https://discord.com/api/v10` (no trailing path)", () => {
      // The base URL must be the bare /api/v10 root. If a future edit
      // baked a path into the base (e.g. `.../api/v10/users`) the
      // forbidden-prefix check below would miss it.
      assert.match(
        scriptText!,
        /DISCORD_API_BASE\s*=\s*"https:\/\/discord\.com\/api\/v10"\s*;?/,
        "DISCORD_API_BASE must be the bare https://discord.com/api/v10 root",
      );
    });

    it("every `path:` literal handed to discordPatch is exactly /users/@me or /applications/@me", () => {
      // Grep for `path: "<value>"` literals inside the script source.
      // The constructor of `plannedCalls` uses this shape; any future
      // call site that adds a new path: literal MUST be one of the two.
      const allowed = new Set(["/users/@me", "/applications/@me"]);
      const RE = /\bpath:\s*"([^"]+)"/g;
      const seen = new Set<string>();
      for (const m of scriptText!.matchAll(RE)) {
        if (m[1] !== undefined) seen.add(m[1]);
      }
      assert.ok(seen.size > 0, "expected at least one `path:` literal in the script");
      for (const p of seen) {
        assert.ok(
          allowed.has(p),
          `path literal ${JSON.stringify(p)} is outside the authorized surface ` +
            `(only /users/@me and /applications/@me are granted by Principle V)`,
        );
      }
      // And we expect BOTH endpoints to be present — the script's
      // purpose is to update both bot identity and app metadata.
      assert.ok(seen.has("/users/@me"), "expected `/users/@me` path literal");
      assert.ok(
        seen.has("/applications/@me"),
        "expected `/applications/@me` path literal",
      );
    });

    it("no forbidden Discord REST path prefix appears anywhere in the source", () => {
      // Belt-and-suspenders. Even if a future edit doesn't use a
      // `path:` shorthand (e.g. someone writes `const url = ...;
      // await fetch(url)`), the forbidden prefix would still show up
      // as a string literal somewhere. Catch it here.
      for (const forbidden of FORBIDDEN_PREFIXES) {
        assert.ok(
          !scriptText!.includes(forbidden),
          `forbidden Discord REST prefix ${JSON.stringify(forbidden)} appears in ` +
            `scripts/discord-ops/set-discord-app-metadata.mjs — broader writes ` +
            "require a constitution amendment under repository governance rules",
        );
      }
    });

    it("no `discord.com/api/v10/<other-path>` literal appears in the source", () => {
      // Tightest possible enumeration test: any string in the source
      // that includes the api/v10 path followed by anything other than
      // the two allowed endpoints is a smoking gun.
      // Regex: api/v10/<segment> where <segment> is NOT (users/@me |
      // applications/@me). The negative lookahead handles both bare
      // forms and trailing-slash forms.
      const RE = /discord\.com\/api\/v10\/(?!users\/@me|applications\/@me)([A-Za-z0-9@_\-./{}]+)/g;
      const violators: string[] = [];
      for (const m of scriptText!.matchAll(RE)) {
        if (m[1] !== undefined) violators.push(m[1]);
      }
      assert.deepEqual(
        violators,
        [],
        `script source must not reference discord.com/api/v10/<path> for any ` +
          `path other than /users/@me or /applications/@me. Found: ` +
          JSON.stringify(violators),
      );
    });
  },
);
