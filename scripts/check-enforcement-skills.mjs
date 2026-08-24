/**
 * Concrete, testable implementation of the "ceremony enforcement skill must
 * resolve" check (issue #245 action item 5; #248 Garak findings 3 — "missing
 * skill CI still passes vacuously and violates discovery rules" — including
 * the second-round findings: unanchored row parsing, base-dir symlink
 * bypass, reparse detection that only covers `isSymbolicLink()`, boundary
 * vs. everywhere zero-width trimming, and missing invalid-name/case-variant
 * warnings).
 *
 * Replaces the inline bash in .github/workflows/protected-paths.yml, which:
 *   - exited 0 when ceremonies.md was absent or zero rows parsed (grep
 *     errors swallowed by `|| true`) — a deleted/mangled enforcement row
 *     silently reported success;
 *   - resolved skills with `[ -f ... ]`, which follows symlinks/reparse
 *     points, contrary to the mandatory skip rule in
 *     .squad/reference/skill-routing.md;
 *   - did case-sensitive, non-NFC-normalized lookup with no dedup, so it did
 *     not implement the documented five-path precedence semantics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** 5 documented project skill paths, in precedence order. */
export const SKILL_DIRS = [".squad/skills", ".copilot/skills", ".github/skills", ".claude/skills", ".agents/skills"];

// Zero-width characters trimmed at the BOUNDARIES only (per skill-routing.md
// — "trim leading and trailing whitespace, including zero-width
// characters"). A zero-width char in the *middle* of a name is a different,
// legitimately-distinct name, not noise to be silently erased everywhere.
const ZERO_WIDTH = "\u200B\u200C\u200D\uFEFF";
const ZERO_WIDTH_BOUNDARY_RE = new RegExp(`^[\\s${ZERO_WIDTH}]+|[\\s${ZERO_WIDTH}]+$`, "g");

// Names containing these are rejected outright per skill-routing.md's
// invalid-name denylist (null bytes, control chars, path separators).
const INVALID_NAME_RE = /[\x00-\x1F\x7F]|\.\.|\/|\\/;

/** NFC-normalize and boundary-trim (incl. zero-width) a skill/dir name; does NOT lowercase. */
export function normalizeSkillName(name) {
  return name.normalize("NFC").replace(ZERO_WIDTH_BOUNDARY_RE, "");
}

/** Case-insensitive comparison key for a normalized skill/dir name. */
export function normalizeSkillId(name) {
  return normalizeSkillName(name).toLowerCase();
}

/** True if a (already NFC/boundary-trimmed) directory name is invalid per policy. */
export function isInvalidSkillName(name) {
  return INVALID_NAME_RE.test(name) || name.length === 0;
}

/**
 * Extract every `**Enforcement skill**` table row's skill id from
 * ceremonies.md content, anchored to complete rows (`| **Enforcement
 * skill** | id |`) — not any line merely *containing* the phrase. Returns
 * both the successfully parsed ids and any "candidate" lines that mention
 * the phrase but do not parse as a complete row, so a malformed row can
 * never be silently masked by a valid one elsewhere in the file (#248
 * Garak finding 3: "one valid parse can mask an additional malformed
 * row").
 *
 * CRLF-safe: line endings are normalized before matching.
 */
export function extractEnforcementSkillIds(ceremoniesContent) {
  const normalized = ceremoniesContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const ROW_RE = /^\s*\|\s*\*\*Enforcement skill\*\*\s*\|\s*([^|]*?)\s*\|\s*$/;
  const CANDIDATE_RE = /\*\*Enforcement skill\*\*/;

  const ids = [];
  const malformedLines = [];

  for (const line of lines) {
    if (!CANDIDATE_RE.test(line)) continue;
    const m = ROW_RE.exec(line);
    if (!m) {
      malformedLines.push(line);
      continue;
    }
    const rawId = normalizeSkillName(m[1]);
    if (rawId.length === 0) {
      malformedLines.push(line); // "| **Enforcement skill** |  |" — empty value is malformed, not "no row"
      continue;
    }
    ids.push(rawId);
  }

  return { ids, malformedLines };
}

/**
 * Detects a Windows reparse point (junction, mount point, or any type
 * beyond a plain NTFS symlink) via `fsutil reparsepoint query`, since
 * `fs.lstatSync().isSymbolicLink()` alone is documented by
 * skill-routing.md as insufficient — Node does not portably expose the
 * `FILE_ATTRIBUTE_REPARSE_POINT` flag. This is the real default adapter;
 * `isSymlinkOrReparsePoint` accepts an override so tests can simulate a
 * reparse point deterministically on any platform, per #248 Garak finding
 * 4 ("a self-skip is not evidence of the mandatory Windows policy").
 *
 * Fails CLOSED on uncertainty (#248 Garak round-3 finding 3: "if detection
 * is unavailable/denied, an arbitrary Windows reparse point can be
 * followed — the security boundary fails open"). Only fsutil's exact,
 * well-known negative message ("...is not a reparse point.") is trusted as
 * a confirmed "no". Any other failure — missing `fsutil` binary, access
 * denied, unexpected output — is uncertain and is treated as "yes, this IS
 * a reparse point" (rejected), never silently allowed through.
 */
export function defaultReparsePointDetector(fullPath) {
  if (process.platform !== "win32") return false;

  let stdout;
  try {
    stdout = execFileSync("fsutil", ["reparsepoint", "query", fullPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/is not a reparse point/i.test(combined)) {
      return false; // confirmed negative — fsutil's own documented message
    }
    return true; // fail closed: uncertain result, treat as a reparse point
  }
  return /Reparse Tag/i.test(stdout);
}

/**
 * True if the path is a symlink (any platform) or a Windows reparse point
 * (junction/mount point/other reparse tag). `detectReparsePoint` is
 * injectable so tests can force a deterministic "yes" without needing to
 * create a real junction (which requires elevated privileges on some
 * Windows configurations and is impossible on Linux CI).
 */
export function isSymlinkOrReparsePoint(fullPath, detectReparsePoint = defaultReparsePointDetector) {
  let st;
  try {
    st = fs.lstatSync(fullPath);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) return true;
  return detectReparsePoint(fullPath);
}

/**
 * Resolve a single skill id against the 5 documented paths. Enumerates
 * ALL 5 bases before picking a winner (#248 Garak round-3 finding 3:
 * "resolveSkillId returns at the first resolving base, so it never
 * discovers or warns about a case-variant duplicate in a lower-precedence
 * path") — the earlier version returned as soon as one base resolved,
 * which meant a legitimate case-variant sitting in a *lower*-precedence
 * path was silently invisible instead of warned about. Rejects
 * symlinked/reparse-point base directories, skill directories, and
 * SKILL.md files. Invalid directory names (null bytes, control chars,
 * path separators) are skipped with a warning. Same-base case-variant
 * collisions are resolved deterministically (lexicographically-first
 * candidate that actually resolves wins — not just candidates[0], which
 * may itself be a rejected symlink) and warned about accurately. Cross-
 * path case-variant collisions (the same id spelled differently across
 * more than one base) are also warned about, even though only the
 * highest-precedence resolving base wins.
 */
export function resolveSkillId(repoRoot, id, options = {}) {
  const detectReparsePoint = options.detectReparsePoint ?? defaultReparsePointDetector;
  const normalizedId = normalizeSkillId(id);
  const warnings = [];
  const perBase = [];

  for (const base of SKILL_DIRS) {
    const baseDir = path.join(repoRoot, base);

    // Reject a symlinked/reparse-point BASE directory itself before ever
    // reading its contents (#248 Garak finding 3: resolveSkillId previously
    // called readdirSync(baseDir) before checking whether baseDir itself
    // was a symlink, so a symlinked .squad/skills was silently followed).
    if (isSymlinkOrReparsePoint(baseDir, detectReparsePoint)) {
      warnings.push(`⚠ Skill base directory '${base}' is a symlink/reparse point; skipped per policy.`);
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(baseDir);
    } catch {
      continue; // base dir doesn't exist — try next path
    }

    const candidates = [];
    for (const rawEntry of entries) {
      const entry = normalizeSkillName(rawEntry);
      if (isInvalidSkillName(entry)) {
        warnings.push(`⚠ Skill name '${rawEntry}' in ${base} skipped (contains invalid characters).`);
        continue;
      }
      if (normalizeSkillId(entry) === normalizedId) candidates.push(rawEntry);
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    // Try each candidate in deterministic order until one genuinely
    // resolves (real directory, real non-symlinked SKILL.md) — this may
    // NOT be candidates[0] if that one is itself a rejected symlink.
    let resolvedName = null;
    let resolvedPath = null;
    for (const candidate of candidates) {
      const skillDirPath = path.join(baseDir, candidate);
      if (isSymlinkOrReparsePoint(skillDirPath, detectReparsePoint)) continue;

      const skillMdPath = path.join(skillDirPath, "SKILL.md");
      if (isSymlinkOrReparsePoint(skillMdPath, detectReparsePoint)) continue;

      let st;
      try {
        st = fs.statSync(skillMdPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      resolvedName = candidate;
      resolvedPath = `${base}/${candidate}/SKILL.md`;
      break;
    }

    if (candidates.length > 1) {
      warnings.push(
        `⚠ Skill '${id}' found in multiple case-variant directories under ${base} (${candidates.join(", ")}); using '${resolvedName ?? "none (all candidates rejected)"}'.`,
      );
    }

    perBase.push({ base, candidates, resolvedName, resolvedPath });
  }

  // Cross-path case-variant warning: the id matches directory names that
  // differ in literal case across more than one base, even if only the
  // highest-precedence resolving base ultimately wins.
  const distinctNamesAcrossBases = new Set(perBase.flatMap((b) => b.candidates));
  if (perBase.length > 1 && distinctNamesAcrossBases.size > 1) {
    warnings.push(
      `⚠ Skill '${id}' found with case-variant directory names across multiple paths (${[...distinctNamesAcrossBases].join(", ")}); highest-precedence match wins.`,
    );
  }

  const resolvedBase = perBase.find((b) => b.resolvedName);
  if (!resolvedBase) return { resolved: null, base: null, warnings };

  return { resolved: resolvedBase.resolvedPath, base: resolvedBase.base, warnings };
}

/**
 * Run the full check against a repo root. Non-vacuous by construction:
 * a missing ceremonies file, zero parsed rows, or ANY malformed
 * `**Enforcement skill**` row are all failures, not early-exit successes.
 */
export function checkCeremonyEnforcementSkills(repoRoot, options = {}) {
  const ceremoniesPath = path.join(repoRoot, ".squad", "ceremonies.md");

  let ceremoniesContent;
  try {
    ceremoniesContent = fs.readFileSync(ceremoniesPath, "utf8");
  } catch {
    return {
      ok: false,
      ceremoniesFileMissing: true,
      zeroRows: false,
      malformedRows: [],
      resolved: [],
      unresolved: [],
      warnings: [],
      reason: `${ceremoniesPath} does not exist — cannot verify any ceremony's Enforcement skill`,
    };
  }

  const { ids, malformedLines } = extractEnforcementSkillIds(ceremoniesContent);

  if (malformedLines.length > 0) {
    return {
      ok: false,
      ceremoniesFileMissing: false,
      zeroRows: false,
      malformedRows: malformedLines,
      resolved: [],
      unresolved: [],
      warnings: [],
      reason: `${malformedLines.length} '**Enforcement skill**' row(s) in ${ceremoniesPath} did not parse as a complete table row: ${JSON.stringify(malformedLines)}`,
    };
  }

  if (ids.length === 0) {
    return {
      ok: false,
      ceremoniesFileMissing: false,
      zeroRows: true,
      malformedRows: [],
      resolved: [],
      unresolved: [],
      warnings: [],
      reason: `no '**Enforcement skill**' rows found in ${ceremoniesPath} — expected at least one`,
    };
  }

  const resolved = [];
  const unresolved = [];
  const warnings = [];
  for (const id of ids) {
    const { resolved: resolvedPath, warnings: idWarnings } = resolveSkillId(repoRoot, id, options);
    warnings.push(...idWarnings);
    if (resolvedPath) resolved.push({ id, path: resolvedPath });
    else unresolved.push({ id });
  }

  return {
    ok: unresolved.length === 0,
    ceremoniesFileMissing: false,
    zeroRows: false,
    malformedRows: [],
    resolved,
    unresolved,
    warnings,
    reason: unresolved.length === 0 ? null : `unresolved Enforcement skill id(s): ${unresolved.map((u) => u.id).join(", ")}`,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────
// node scripts/check-enforcement-skills.mjs [repoRoot]
// Exits 1 with GitHub Actions ::error annotations on failure, 0 on success.
function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const result = checkCeremonyEnforcementSkills(repoRoot);

  if (result.ceremoniesFileMissing) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  if (result.malformedRows.length > 0) {
    for (const line of result.malformedRows) {
      console.log(`::error file=.squad/ceremonies.md::Malformed '**Enforcement skill**' row: ${line}`);
    }
    process.exit(1);
  }
  if (result.zeroRows) {
    console.log(`::error file=.squad/ceremonies.md::${result.reason}`);
    process.exit(1);
  }
  for (const w of result.warnings) console.log(w);
  for (const r of result.resolved) {
    console.log(`Enforcement skill '${r.id}' resolves at ${r.path}`);
  }
  for (const u of result.unresolved) {
    console.log(
      `::error file=.squad/ceremonies.md::Ceremony names Enforcement skill '${u.id}', which does not resolve at any of the 5 documented skill paths (${SKILL_DIRS.join(", ")})`,
    );
  }
  if (!result.ok) {
    console.log(`${result.unresolved.length} ceremony 'Enforcement skill' reference(s) do not resolve to an installed skill.`);
    process.exit(1);
  }
  console.log("All ceremony enforcement skills resolve.");
  process.exit(0);
}
