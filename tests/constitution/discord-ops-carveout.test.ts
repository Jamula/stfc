// Pinning tests for the Principle V `scripts/discord-ops/` carve-out
// (Tuvok's constitution amendment).
//
// Why pinned literally: Rule 1 — `.specify/memory/constitution.md` and
// `.specify/templates/plan-template.md` drift independently. Tests here
// detect drift on either side.
//
// Strategy: structural assertions over exact-wording assertions, because
// Tuvok may tweak phrasing between drafts. We pin:
//   (a) the path token `scripts/discord-ops/` appears,
//   (b) one of {`PATCH`, `PUT`, `POST`} appears in the same paragraph,
//   (c) the API base `discord.com/api/v10` is referenced near the
//       carve-out (token-leak redaction obligation co-located with it),
//   (d) the version footer was bumped above v1.4.0,
//   (e) `.specify/templates/plan-template.md` also references
//       `scripts/discord-ops/` (Rule 1 — they MUST stay in sync).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONSTITUTION = path.join(REPO_ROOT, ".specify", "memory", "constitution.md");
const PLAN_TEMPLATE = path.join(REPO_ROOT, ".specify", "templates", "plan-template.md");

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

function parseVersion(text: string): [number, number, number] | undefined {
  // Matches the footer `**Version**: 1.4.0 | ...` or the SIR header
  // `Version change: 1.3.0 → 1.4.0`. We want the highest version that
  // appears, since both the SIR (old→new) and the footer mention it.
  const re = /(\d+)\.(\d+)\.(\d+)/g;
  let best: [number, number, number] | undefined;
  // Restrict the search to the version footer line and the SIR header to
  // avoid matching unrelated semver strings (e.g. tool versions).
  const candidates: string[] = [];
  const footer = /\*\*Version\*\*[:\s]+([\d.]+)/.exec(text);
  if (footer && footer[1] !== undefined) candidates.push(footer[1]);
  const sir = /Version change:\s*[\d.]+\s*(?:→|->)\s*([\d.]+)/.exec(text);
  if (sir && sir[1] !== undefined) candidates.push(sir[1]);
  for (const c of candidates) {
    re.lastIndex = 0;
    const m = re.exec(c);
    if (!m) continue;
    const tuple: [number, number, number] = [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
    ];
    if (best === undefined || cmpVersion(tuple, best) > 0) best = tuple;
  }
  return best;
}

function cmpVersion(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

const constitutionText = readIfExists(CONSTITUTION);
const planTemplateText = readIfExists(PLAN_TEMPLATE);

// The carve-out has not yet landed if the path token is absent. We skip
// (not fail) so the suite stays green for non-discord-ops branches,
// matching Rule 3's "tests should fail with clear messages" but only
// once the production change is in flight.
const carveoutLanded =
  constitutionText !== undefined && constitutionText.includes("scripts/discord-ops/");

describe("Constitution Principle V — scripts/discord-ops/ carve-out", () => {
  it("constitution.md exists and is readable", () => {
    assert.ok(constitutionText !== undefined, `cannot read ${CONSTITUTION}`);
  });

  it(
    "mentions `scripts/discord-ops/` (the carve-out path token)",
    { skip: constitutionText === undefined },
    () => {
      assert.ok(
        constitutionText!.includes("scripts/discord-ops/"),
        "Principle V must enumerate `scripts/discord-ops/` as the carve-out path",
      );
    },
  );

  it(
    "names ALL THREE write verbs (PATCH, PUT, POST) in the same section as the carve-out (Garak NIT-1)",
    { skip: !carveoutLanded },
    () => {
      // Garak PR #71 NIT-1: the old assertion passed if ANY of
      // PATCH|PUT|POST appeared in the window. A future degenerate edit
      // that authorized only POST (or stripped two of the three verbs)
      // would have stayed green. Require all three so the verb grant
      // stays explicit and complete.
      const idx = constitutionText!.indexOf("scripts/discord-ops/");
      const start = Math.max(0, idx - 1500);
      const end = Math.min(constitutionText!.length, idx + 1500);
      const window = constitutionText!.slice(start, end);
      for (const verb of ["PATCH", "PUT", "POST"]) {
        assert.match(
          window,
          new RegExp(`\\b${verb}\\b`),
          `carve-out must explicitly grant ${verb} (Garak NIT-1: pin all three verbs, not just one)`,
        );
      }
    },
  );

  it(
    "enumerates BOTH /users/@me AND /applications/@me as the narrowed endpoint surface (Garak MED-1)",
    { skip: !carveoutLanded },
    () => {
      // Garak PR #71 MED-1: the constitution narrows the discord.com
      // /api/v10 write surface to exactly two endpoints. Previously the
      // carve-out test only asserted the api/v10 base was named — a
      // future degenerate edit could re-broaden to "any v10 endpoint"
      // (including /channels/{id}/messages) and the suite stayed green.
      // Pin both endpoints by name in the carve-out window.
      const idx = constitutionText!.indexOf("scripts/discord-ops/");
      const start = Math.max(0, idx - 1500);
      const end = Math.min(constitutionText!.length, idx + 1500);
      const window = constitutionText!.slice(start, end);
      assert.ok(
        window.includes("/users/@me"),
        "carve-out window must enumerate `/users/@me` (Garak MED-1)",
      );
      assert.ok(
        window.includes("/applications/@me"),
        "carve-out window must enumerate `/applications/@me` (Garak MED-1)",
      );
    },
  );

  it(
    "does NOT grant writes to any other discord.com/api/v10 endpoint (Garak MED-1)",
    { skip: !carveoutLanded },
    () => {
      // Negative assertion: no other endpoint string of the shape
      // `discord.com/api/v10/<something>` appears in the carve-out
      // window UNLESS the <something> is users/@me or applications/@me.
      // Tolerates the bare base (`discord.com/api/v10` with no trailing
      // path) which is referenced as the "API surface" — only flags
      // paths that look like specific endpoint enumerations.
      const idx = constitutionText!.indexOf("scripts/discord-ops/");
      const start = Math.max(0, idx - 1500);
      const end = Math.min(constitutionText!.length, idx + 1500);
      const window = constitutionText!.slice(start, end);
      // Match `discord.com/api/v10/<path-segment>` where <path-segment>
      // is one or more URL-safe chars (incl. @, /, {, }, -, _, .).
      // Capture the segment so the assertion message names the violator.
      const RE = /discord\.com\/api\/v10\/([A-Za-z0-9@_\-./{}]+)/g;
      const violators: string[] = [];
      for (const m of window.matchAll(RE)) {
        const seg = (m[1] ?? "").replace(/[.,;)\]]+$/, ""); // strip trailing punct
        if (seg === "users/@me" || seg === "applications/@me") continue;
        // Also accept sub-paths that START with one of the two
        // enumerated endpoints — defensive in case a future edit
        // references `/users/@me/connections` as an EXAMPLE of what is
        // forbidden. Such enumeration is allowed if the surrounding
        // prose is a non-grant; we only forbid the segment from
        // appearing as a positive grant.
        if (seg.startsWith("users/@me") || seg.startsWith("applications/@me")) continue;
        violators.push(seg);
      }
      assert.deepEqual(
        violators,
        [],
        `carve-out must not name discord.com/api/v10/<path> for any path other than users/@me / applications/@me; found: ${JSON.stringify(violators)}`,
      );
    },
  );

  it(
    "references `discord.com/api/v10` in the same section as the carve-out",
    { skip: !carveoutLanded },
    () => {
      const idx = constitutionText!.indexOf("scripts/discord-ops/");
      const start = Math.max(0, idx - 1500);
      const end = Math.min(constitutionText!.length, idx + 1500);
      const window = constitutionText!.slice(start, end);
      assert.ok(
        window.includes("discord.com/api/v10"),
        "carve-out must scope the write authority to discord.com/api/v10",
      );
    },
  );

  it(
    "states that the script lives outside `src/discord/` OR that it is not runtime-loaded",
    { skip: !carveoutLanded },
    () => {
      const idx = constitutionText!.indexOf("scripts/discord-ops/");
      const start = Math.max(0, idx - 1500);
      const end = Math.min(constitutionText!.length, idx + 1500);
      const window = constitutionText!.slice(start, end).toLowerCase();
      assert.ok(
        window.includes("src/discord/") ||
          window.includes("not loaded") ||
          window.includes("operator-only") ||
          window.includes("one-shot"),
        "carve-out must isolate the script from the monitor runtime",
      );
    },
  );

  it(
    "references the token-redaction obligation (FR-012 / redact / DISCORD_BOT_TOKEN)",
    { skip: !carveoutLanded },
    () => {
      const idx = constitutionText!.indexOf("scripts/discord-ops/");
      const start = Math.max(0, idx - 1500);
      const end = Math.min(constitutionText!.length, idx + 1500);
      const window = constitutionText!.slice(start, end);
      assert.match(
        window,
        /FR-012|redact|DISCORD_BOT_TOKEN/,
        "carve-out must restate the token-redaction obligation",
      );
    },
  );

  it(
    "version was bumped above v1.4.0",
    { skip: !carveoutLanded },
    () => {
      const v = parseVersion(constitutionText!);
      assert.ok(v !== undefined, "could not parse constitution version footer");
      assert.ok(
        cmpVersion(v!, [1, 4, 0]) > 0,
        `expected version > 1.4.0 once carve-out lands; got ${v!.join(".")}`,
      );
    },
  );
});

describe("Plan template — scripts/discord-ops/ must be in sync (Rule 1)", () => {
  it("plan-template.md exists and is readable", () => {
    assert.ok(planTemplateText !== undefined, `cannot read ${PLAN_TEMPLATE}`);
  });

  it(
    "plan-template.md references `scripts/discord-ops/` once the carve-out lands",
    { skip: !carveoutLanded || planTemplateText === undefined },
    () => {
      assert.ok(
        planTemplateText!.includes("scripts/discord-ops/"),
        "Rule 1: plan-template.md must enumerate the same carve-out path as constitution.md",
      );
    },
  );

  it(
    "plan-template.md references the same API surface (discord.com/api/v10)",
    { skip: !carveoutLanded || planTemplateText === undefined },
    () => {
      assert.ok(
        planTemplateText!.includes("discord.com"),
        "plan-template.md must list discord.com as a sanctioned outbound destination",
      );
    },
  );
});
