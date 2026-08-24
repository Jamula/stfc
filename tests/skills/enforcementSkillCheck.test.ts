// Pinning + behavior tests for the "Assert ceremony enforcement skills are
// installed" step in .github/workflows/protected-paths.yml, and its
// executable implementation in scripts/check-enforcement-skills.mjs
// (issue #245, action item 5; #248 Garak finding 3 and 4).
//
// Guards:
//   1. Structural: the workflow step exists, invokes the extracted Node
//      script (not inline bash), and Node is set up first.
//   2. Behavioral, against the real repo tree: every Enforcement skill named
//      in the real .squad/ceremonies.md resolves, and resolves at the
//      highest-precedence path.
//   3. Behavioral, against temporary fixture trees: missing ceremonies file,
//      zero Enforcement-skill rows, missing skill, CRLF line endings, case
//      variants, duplicate/precedence resolution across multiple skill
//      dirs, malformed rows, and (where the platform supports it) symlinked
//      skill directories being rejected. These are the negative fixtures
//      Garak's finding 4 flagged as absent — they assert on the exported
//      behavior, not on the presence of a substring in a YAML block.
//
// Per the same convention as tests/skills/ruleReferenceCheck.test.ts:
// update this file in the same commit as protected-paths.yml.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SKILL_DIRS,
  normalizeSkillId,
  extractEnforcementSkillIds,
  isSymlinkOrReparsePoint,
  defaultReparsePointDetector,
  resolveSkillId,
  checkCeremonyEnforcementSkills,
} from "../../scripts/check-enforcement-skills.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "protected-paths.yml");
const ceremoniesPath = path.join(repoRoot, ".squad", "ceremonies.md");

describe("protected-paths.yml / ceremony enforcement-skill check — structural", () => {
  const yaml = fs.readFileSync(workflowPath, "utf8");

  it("protected-paths.yml exists", () => {
    assert.ok(fs.existsSync(workflowPath), `protected-paths.yml not found at ${workflowPath}`);
  });

  it("REQUIRED_FILES pins .squad/skills/retro-enforcement/SKILL.md", () => {
    assert.match(
      yaml,
      /\.squad\/skills\/retro-enforcement\/SKILL\.md/,
      "protected-paths.yml must require .squad/skills/retro-enforcement/SKILL.md",
    );
  });

  it("has a step asserting ceremony enforcement skills are installed", () => {
    assert.match(
      yaml,
      /Assert ceremony enforcement skills are installed/,
      "expected the enforcement-skill-check step by name",
    );
  });

  it("sets up Node before the enforcement-skill-check step (the step now runs a Node script)", () => {
    const setupNodeIndex = yaml.indexOf("actions/setup-node");
    const stepIndex = yaml.indexOf("Assert ceremony enforcement skills are installed");
    assert.ok(setupNodeIndex !== -1, "expected an actions/setup-node step");
    assert.ok(setupNodeIndex < stepIndex, "setup-node must run before the enforcement-skill-check step");
  });

  it("delegates to the extracted, testable Node script instead of inline bash", () => {
    const stepStart = yaml.indexOf("Assert ceremony enforcement skills are installed");
    const nextStep = yaml.indexOf("\n  - name:", stepStart);
    const stepBlock = yaml.slice(stepStart, nextStep === -1 ? undefined : nextStep);
    assert.match(
      stepBlock,
      /run:\s*node scripts\/check-enforcement-skills\.mjs/,
      "the step must run `node scripts/check-enforcement-skills.mjs`",
    );
  });
});

describe("check-enforcement-skills: behavior against the real repo tree", () => {
  it("every Enforcement skill named in the real ceremonies.md resolves to an installed skill", () => {
    const result = checkCeremonyEnforcementSkills(repoRoot);
    assert.equal(result.ceremoniesFileMissing, false);
    assert.equal(result.zeroRows, false);
    assert.equal(
      result.ok,
      true,
      `unresolved: ${JSON.stringify(result.unresolved)} — this is exactly the #245 failure mode`,
    );
    assert.ok(result.resolved.length > 0, "expected at least one resolved Enforcement skill row");
  });

  it("retro-enforcement resolves at .squad/skills (highest precedence), not only a lower-precedence path", () => {
    const { resolved } = resolveSkillId(repoRoot, "retro-enforcement");
    assert.equal(resolved, ".squad/skills/retro-enforcement/SKILL.md");
  });

  it("extractEnforcementSkillIds finds the real ceremonies.md row via the documented pattern", () => {
    const content = fs.readFileSync(ceremoniesPath, "utf8");
    const { ids, malformedLines } = extractEnforcementSkillIds(content);
    assert.deepEqual(malformedLines, []);
    assert.ok(ids.includes("retro-enforcement"));
  });
});

// ── Fixture-tree behavioral negatives ────────────────────────────────────

function withTempRepo(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enforcement-fixture-"));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeCeremonies(root: string, body: string): void {
  const dir = path.join(root, ".squad");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ceremonies.md"), body);
}

function installSkill(root: string, base: string, id: string): void {
  const dir = path.join(root, base, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${id}\n`);
}

/**
 * Whether this filesystem distinguishes directory names that differ only
 * in case (true on Linux ext4, false on default Windows NTFS / macOS
 * APFS). Same-base case-variant fixtures only make sense on a
 * case-sensitive filesystem — on a case-insensitive one, creating
 * "same-base-skill" and "Same-Base-Skill" collapses to one directory.
 */
const isCaseSensitiveFs = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "case-probe-"));
  try {
    fs.mkdirSync(path.join(root, "case-probe-dir"));
    return !fs.existsSync(path.join(root, "CASE-PROBE-DIR"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})();

describe("check-enforcement-skills: fixture negatives — missing file / missing row / missing skill", () => {
  it("fails (not a silent pass) when ceremonies.md is entirely missing", () => {
    withTempRepo((root) => {
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false);
      assert.equal(result.ceremoniesFileMissing, true);
    });
  });

  it("fails (not a silent pass) when ceremonies.md has zero Enforcement skill rows", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "# Ceremonies\n\nNo enforcement rows here.\n");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false);
      assert.equal(result.zeroRows, true);
    });
  });

  it("fails when the named skill is not installed anywhere", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | ghost-skill |\n");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false);
      assert.equal(result.unresolved.length, 1);
      assert.equal(result.unresolved[0]?.id, "ghost-skill");
    });
  });

  it("succeeds when the named skill is installed at the highest-precedence path", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | real-skill |\n");
      installSkill(root, ".squad/skills", "real-skill");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, true);
      assert.equal(result.resolved[0]?.path, ".squad/skills/real-skill/SKILL.md");
    });
  });
});

describe("check-enforcement-skills: fixture negatives — CRLF, case, precedence, malformed rows", () => {
  it("parses an Enforcement skill row with CRLF line endings", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "# Ceremonies\r\n\r\n| **Enforcement skill** | crlf-skill |\r\n");
      installSkill(root, ".squad/skills", "crlf-skill");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, true);
    });
  });

  it("resolves a skill id case-insensitively against a differently-cased directory name", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | Case-Skill |\n");
      installSkill(root, ".squad/skills", "case-skill");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, true, JSON.stringify(result.unresolved));
    });
  });

  it("normalizeSkillId trims boundary zero-width characters and normalizes to NFC", () => {
    const withBoundaryZeroWidth = "\u200Bretro-enforcement\uFEFF";
    assert.equal(normalizeSkillId(withBoundaryZeroWidth), "retro-enforcement");
  });

  it("normalizeSkillId does NOT strip a zero-width character in the middle of a name (boundary-only trim, #248 Garak finding 3)", () => {
    const withMidZeroWidth = "retro\u200B-enforcement";
    // A zero-width char embedded in the middle is a different name, not
    // noise — only leading/trailing zero-width characters are trimmed.
    assert.equal(normalizeSkillId(withMidZeroWidth), "retro\u200b-enforcement");
    assert.notEqual(normalizeSkillId(withMidZeroWidth), "retro-enforcement");
  });

  it("prefers the highest-precedence path when the same skill id exists at multiple paths (duplicate precedence)", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | dup-skill |\n");
      // Install at a LOWER-precedence path first, then a HIGHER one, to
      // prove resolution order doesn't depend on filesystem write order.
      installSkill(root, ".agents/skills", "dup-skill");
      installSkill(root, ".github/skills", "dup-skill");
      const { resolved, base } = resolveSkillId(root, "dup-skill");
      assert.equal(base, ".github/skills", "must prefer .github/skills over .agents/skills");
      assert.equal(resolved, ".github/skills/dup-skill/SKILL.md");
    });
  });

  it("SKILL_DIRS documents all 5 paths in the correct precedence order", () => {
    assert.deepEqual(SKILL_DIRS, [".squad/skills", ".copilot/skills", ".github/skills", ".claude/skills", ".agents/skills"]);
  });

  it("fails loudly (not a silent skip) on malformed rows (missing pipe, empty id) rather than crashing", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "**Enforcement skill** no-pipe-here\n| **Enforcement skill** |  |\n");
      const result = checkCeremonyEnforcementSkills(root);
      // Both lines mention the phrase but neither parses as a complete row —
      // this must surface as a malformed-row failure, not a silent "zero rows".
      assert.equal(result.ok, false);
      assert.equal(result.malformedRows.length, 2);
      assert.equal(result.zeroRows, false);
    });
  });

  it("a malformed row is never masked by a valid row elsewhere in the file (mixed valid+malformed)", () => {
    withTempRepo((root) => {
      writeCeremonies(
        root,
        "| **Enforcement skill** | real-skill |\n" + "**Enforcement skill** no-pipe-here\n",
      );
      installSkill(root, ".squad/skills", "real-skill");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false, "a malformed row anywhere in the file must fail the whole check");
      assert.equal(result.malformedRows.length, 1);
    });
  });

  it("extractEnforcementSkillIds ignores an Enforcement skill row with no value, reporting it as malformed", () => {
    const { ids, malformedLines } = extractEnforcementSkillIds("| **Enforcement skill** |  |\n");
    assert.deepEqual(ids, []);
    assert.equal(malformedLines.length, 1);
  });

  it("extractEnforcementSkillIds does not treat prose mentions of the phrase as rows", () => {
    const { ids, malformedLines } = extractEnforcementSkillIds(
      "This ceremony uses **Enforcement skill** to gate the round.\n",
    );
    assert.deepEqual(ids, []);
    assert.equal(malformedLines.length, 1, "a prose mention is a candidate that fails to parse — it must not be silently dropped");
  });
});

describe("check-enforcement-skills: fixture negatives — symlink / reparse-point rejection", () => {
  const canSymlink = (() => {
    try {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "symlink-probe-"));
      const target = path.join(root, "target");
      fs.mkdirSync(target);
      fs.symlinkSync(target, path.join(root, "link"), "junction");
      fs.rmSync(root, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  })();

  // Directory junctions (above) don't require elevated privileges on
  // Windows; FILE symlinks do (unless Developer Mode is on) — probed
  // separately so the SKILL.md-is-a-symlinked-file test can skip
  // gracefully on a locked-down Windows runner instead of failing EPERM.
  const canFileSymlink = (() => {
    try {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-symlink-probe-"));
      const target = path.join(root, "target.txt");
      fs.writeFileSync(target, "x");
      fs.symlinkSync(target, path.join(root, "link.txt"), "file");
      fs.rmSync(root, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  })();

  it("isSymlinkOrReparsePoint returns false for a plain directory", () => {
    withTempRepo((root) => {
      const dir = path.join(root, "plain");
      fs.mkdirSync(dir);
      assert.equal(isSymlinkOrReparsePoint(dir), false);
    });
  });

  it("isSymlinkOrReparsePoint returns false for a nonexistent path (never throws)", () => {
    assert.equal(isSymlinkOrReparsePoint(path.join(os.tmpdir(), "does-not-exist-xyz")), false);
  });

  it("rejects a symlinked skill directory even if it resolves to a real SKILL.md (portable platforms only)", { skip: !canSymlink }, () => {
    withTempRepo((root) => {
      const realDir = path.join(root, "_real-skill-target");
      fs.mkdirSync(realDir, { recursive: true });
      fs.writeFileSync(path.join(realDir, "SKILL.md"), "# real\n");

      const skillsDir = path.join(root, ".squad", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.symlinkSync(realDir, path.join(skillsDir, "linked-skill"), "junction");

      writeCeremonies(root, "| **Enforcement skill** | linked-skill |\n");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false, "a symlinked skill directory must not resolve");
      assert.equal(result.unresolved[0]?.id, "linked-skill");
    });
  });

  it("rejects a symlinked BASE directory (.squad/skills itself) even when the linked target contains a real skill (portable platforms only)", { skip: !canSymlink }, () => {
    withTempRepo((root) => {
      const realBase = path.join(root, "_real-squad-skills");
      fs.mkdirSync(path.join(realBase, "real-skill"), { recursive: true });
      fs.writeFileSync(path.join(realBase, "real-skill", "SKILL.md"), "# real\n");

      fs.mkdirSync(path.join(root, ".squad"), { recursive: true });
      fs.symlinkSync(realBase, path.join(root, ".squad", "skills"), "junction");

      writeCeremonies(root, "| **Enforcement skill** | real-skill |\n");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false, "a symlinked .squad/skills base directory must never be traversed");
    });
  });

  it("rejects a REAL skill directory whose SKILL.md itself is a symlink to a file elsewhere (portable platforms only)", { skip: !canFileSymlink }, () => {
    withTempRepo((root) => {
      const realFile = path.join(root, "_real-SKILL-target.md");
      fs.writeFileSync(realFile, "# real target\n");

      const skillDir = path.join(root, ".squad", "skills", "symlinked-file-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.symlinkSync(realFile, path.join(skillDir, "SKILL.md"), "file");

      writeCeremonies(root, "| **Enforcement skill** | symlinked-file-skill |\n");
      const result = checkCeremonyEnforcementSkills(root);
      assert.equal(result.ok, false, "a real skill directory with a symlinked SKILL.md file must not resolve");
      assert.equal(result.unresolved[0]?.id, "symlinked-file-skill");
    });
  });
});

describe("check-enforcement-skills: injectable reparse-point adapter (deterministic, no real junction required)", () => {
  it("resolveSkillId rejects a skill directory the injected detector reports as a reparse point, on ANY platform", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | fake-reparse-skill |\n");
      installSkill(root, ".squad/skills", "fake-reparse-skill");

      const skillDirPath = path.join(root, ".squad", "skills", "fake-reparse-skill");
      const detectReparsePoint = (p: string) => p === skillDirPath;

      const { resolved } = resolveSkillId(root, "fake-reparse-skill", { detectReparsePoint });
      assert.equal(resolved, null, "an injected reparse-point signal must reject the directory even though it is not a real symlink");
    });
  });

  it("resolveSkillId rejects a symlinked BASE directory the injected detector reports as a reparse point", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | any-skill |\n");
      installSkill(root, ".squad/skills", "any-skill");

      const baseDirPath = path.join(root, ".squad", "skills");
      const detectReparsePoint = (p: string) => p === baseDirPath;

      const { resolved, warnings } = resolveSkillId(root, "any-skill", { detectReparsePoint });
      assert.equal(resolved, null);
      assert.ok(warnings.some((w) => w.includes("reparse point")));
    });
  });

  it("checkCeremonyEnforcementSkills threads the injectable detector through to every resolution", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | injected-fail |\n");
      installSkill(root, ".squad/skills", "injected-fail");
      const skillDirPath = path.join(root, ".squad", "skills", "injected-fail");

      const result = checkCeremonyEnforcementSkills(root, { detectReparsePoint: (p: string) => p === skillDirPath });
      assert.equal(result.ok, false);
      assert.equal(result.unresolved[0]?.id, "injected-fail");
    });
  });

  it("defaultReparsePointDetector returns false on non-Windows platforms without invoking fsutil", () => {
    if (process.platform === "win32") return; // covered by the real symlink test above on Windows
    assert.equal(defaultReparsePointDetector(path.join(os.tmpdir(), "whatever")), false);
  });

  it("defaultReparsePointDetector fails CLOSED (returns true) when fsutil's result is uncertain, on real Windows (#248 Garak round-3 finding 3)", () => {
    if (process.platform !== "win32") return; // Windows-only real behavior; CI runs ubuntu-latest, see the non-Windows test above
    // A path fsutil cannot even find produces a message that is NOT the
    // documented "...is not a reparse point." negative — this must be
    // treated as uncertain and fail closed (true), never silently false.
    const bogusPath = "C:\\definitely\\does\\not\\exist\\" + Math.random().toString(36).slice(2);
    assert.equal(defaultReparsePointDetector(bogusPath), true);
  });

  it("defaultReparsePointDetector confirms false for a real, plain directory on real Windows", () => {
    if (process.platform !== "win32") return;
    withTempRepo((root) => {
      const dir = path.join(root, "plain-real-dir");
      fs.mkdirSync(dir);
      assert.equal(defaultReparsePointDetector(dir), false);
    });
  });
});

describe("check-enforcement-skills: exact discovery precedence and warning accuracy (#248 Garak round-3 finding 3)", () => {
  it("enumerates ALL 5 bases before picking a winner — a case-variant in a LOWER-precedence path is still discovered and warned about", () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | cross-path-skill |\n");
      // Highest-precedence, exact-case match:
      installSkill(root, ".squad/skills", "cross-path-skill");
      // A case-variant sitting in a LOWER-precedence path — must still be
      // discovered (not skipped just because .squad/skills already
      // resolved) and produce a cross-path warning.
      installSkill(root, ".agents/skills", "Cross-Path-Skill");

      const { resolved, base, warnings } = resolveSkillId(root, "cross-path-skill");
      assert.equal(resolved, ".squad/skills/cross-path-skill/SKILL.md", "highest-precedence path must still win");
      assert.equal(base, ".squad/skills");
      assert.ok(
        warnings.some((w) => w.includes("multiple paths") && w.includes("case-variant")),
        `expected a cross-path case-variant warning, got: ${JSON.stringify(warnings)}`,
      );
    });
  });

  it("same-base warning names the candidate that ACTUALLY resolves, not just candidates[0], when candidates[0] is rejected", { skip: !isCaseSensitiveFs }, () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | same-base-skill |\n");
      // Two case-variants in the SAME base dir; "Same-Base-Skill" sorts
      // before "same-base-skill" lexicographically (uppercase < lowercase
      // in ASCII), so candidates[0] would be "Same-Base-Skill" — but we
      // make THAT one a rejected symlink, so the real winner must be the
      // other candidate, and the warning must say so.
      const skillsDir = path.join(root, ".squad", "skills");
      installSkill(root, ".squad/skills", "same-base-skill");
      fs.mkdirSync(path.join(skillsDir, "Same-Base-Skill"), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "Same-Base-Skill", "SKILL.md"), "# variant\n");
      const rejectedDirPath = path.join(skillsDir, "Same-Base-Skill");

      const { resolved, warnings } = resolveSkillId(root, "same-base-skill", {
        detectReparsePoint: (p: string) => p === rejectedDirPath,
      });

      assert.equal(resolved, ".squad/skills/same-base-skill/SKILL.md", "must resolve to the candidate that ACTUALLY passed validation");
      const sameBaseWarning = warnings.find((w) => w.includes("multiple case-variant directories under"));
      assert.ok(sameBaseWarning, `expected a same-base warning, got: ${JSON.stringify(warnings)}`);
      assert.match(sameBaseWarning!, /using 'same-base-skill'/, "the warning must name the candidate that actually resolved, not the rejected one");
    });
  });

  it("does not resolve at all when every same-base candidate is rejected, and the warning says so", { skip: !isCaseSensitiveFs }, () => {
    withTempRepo((root) => {
      writeCeremonies(root, "| **Enforcement skill** | all-rejected-skill |\n");
      const skillsDir = path.join(root, ".squad", "skills");
      installSkill(root, ".squad/skills", "all-rejected-skill");
      fs.mkdirSync(path.join(skillsDir, "All-Rejected-Skill"), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "All-Rejected-Skill", "SKILL.md"), "# variant\n");

      const rejectedPaths = new Set([
        path.join(skillsDir, "all-rejected-skill"),
        path.join(skillsDir, "All-Rejected-Skill"),
      ]);

      const { resolved, warnings } = resolveSkillId(root, "all-rejected-skill", {
        // Reject only the two candidate skill directories, not the base dir.
        detectReparsePoint: (p: string) => rejectedPaths.has(p),
      });

      assert.equal(resolved, null);
      assert.ok(warnings.some((w) => w.includes("none (all candidates rejected)")));
    });
  });
});
