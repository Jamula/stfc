/** Type declarations for scripts/check-enforcement-skills.mjs */

export const SKILL_DIRS: string[];

export function normalizeSkillName(name: string): string;

export function normalizeSkillId(name: string): string;

export function isInvalidSkillName(name: string): boolean;

export interface ExtractEnforcementSkillIdsResult {
  ids: string[];
  malformedLines: string[];
}

export function extractEnforcementSkillIds(ceremoniesContent: string): ExtractEnforcementSkillIdsResult;

export type ReparsePointDetector = (fullPath: string) => boolean;

export function defaultReparsePointDetector(fullPath: string): boolean;

export function isSymlinkOrReparsePoint(fullPath: string, detectReparsePoint?: ReparsePointDetector): boolean;

export interface ResolveSkillIdOptions {
  detectReparsePoint?: ReparsePointDetector;
}

export interface ResolveSkillIdResult {
  resolved: string | null;
  base: string | null;
  warnings: string[];
}

export function resolveSkillId(repoRoot: string, id: string, options?: ResolveSkillIdOptions): ResolveSkillIdResult;

export interface EnforcementSkillsCheckResult {
  ok: boolean;
  ceremoniesFileMissing: boolean;
  zeroRows: boolean;
  malformedRows: string[];
  resolved: Array<{ id: string; path: string }>;
  unresolved: Array<{ id: string }>;
  warnings: string[];
  reason: string | null;
}

export function checkCeremonyEnforcementSkills(
  repoRoot: string,
  options?: ResolveSkillIdOptions,
): EnforcementSkillsCheckResult;
