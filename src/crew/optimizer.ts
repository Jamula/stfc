import type { OfficerDatabase } from "./database.ts";
import { validateRosterOfficerIds } from "./roster.ts";
import type { Officer, Roster, TaskDefinition, TagId } from "./schemas.ts";

export interface SlotConstraints {
  captain: number;
  bridge: number;
  below_deck: number;
}

export interface OptimizerTaskInput {
  id: string;
  name: string;
  tag_weights: Partial<Record<TagId, number>>;
  synergy_bonus: number;
  faction_bonus?: Partial<Record<Officer["faction"], number>>;
  constraints?: { exclude_officers?: string[] };
  slot_constraints?: Partial<SlotConstraints>;
}

export interface OptimizedCrew {
  rank: number;
  score: number;
  crew: {
    captain: string | null;
    bridge: string[];
    below_deck: string[];
  };
  completeness: {
    requiredSlots: SlotConstraints;
    filledSlots: SlotConstraints;
    missingSlots: SlotConstraints;
  };
  rationale: {
    matched_tags: Array<{ tag: TagId; weight: number; contributor: string }>;
    synergy_matches: Array<{ group: string; members: string[]; bonus: number }>;
    faction_bonus: number;
    captain_maneuver: string | null;
    officer_abilities: string[];
  };
}

export interface OptimizeCrewResult {
  task_id: string;
  ranked_crews: OptimizedCrew[];
}

const DEFAULT_SLOT_CONSTRAINTS: SlotConstraints = {
  captain: 1,
  bridge: 2,
  below_deck: 0,
};

interface ScoredCrew {
  captain: Officer | null;
  bridge: Officer[];
  belowDeck: Officer[];
  score: number;
  matchedTags: Array<{ tag: TagId; weight: number; contributor: string }>;
  synergyMatches: Array<{ group: string; members: string[]; bonus: number }>;
  factionBonus: number;
  tieBreakerKey: string;
}

function resolveSlotConstraints(task: OptimizerTaskInput | TaskDefinition): SlotConstraints {
  if ("slot_constraints" in task && task.slot_constraints) {
    return {
      captain: task.slot_constraints.captain ?? 1,
      bridge: task.slot_constraints.bridge ?? 2,
      below_deck: task.slot_constraints.below_deck ?? 0,
    };
  }
  return DEFAULT_SLOT_CONSTRAINTS;
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];

  const result: T[][] = [];
  const stack: T[] = [];

  const walk = (start: number): void => {
    if (stack.length === count) {
      result.push([...stack]);
      return;
    }

    for (let i = start; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      stack.push(item);
      walk(i + 1);
      stack.pop();
    }
  };

  walk(0);
  return result;
}

function memberIds(captain: Officer | null, bridge: Officer[], belowDeck: Officer[]): string[] {
  const ids = [captain?.id, ...bridge.map((officer) => officer.id), ...belowDeck.map((officer) => officer.id)].filter(
    (value): value is string => Boolean(value),
  );
  return ids;
}

function scoreCrew(
  database: OfficerDatabase,
  task: OptimizerTaskInput | TaskDefinition,
  captain: Officer | null,
  bridge: Officer[],
  belowDeck: Officer[],
): ScoredCrew {
  const tagWeights = task.tag_weights;
  let score = 0;
  const matchedTags: Array<{ tag: TagId; weight: number; contributor: string }> = [];

  const addWeightedTags = (tags: TagId[], contributor: string): void => {
    for (const tag of tags) {
      const weight = tagWeights[tag] ?? 0;
      if (weight === 0) continue;
      score += weight;
      matchedTags.push({ tag, weight, contributor });
    }
  };

  if (captain) {
    addWeightedTags(captain.captain_maneuver.tags, `${captain.id}:captain_maneuver`);
    addWeightedTags(captain.officer_ability.tags, `${captain.id}:officer_ability`);
  }

  for (const officer of [...bridge, ...belowDeck]) {
    addWeightedTags(officer.officer_ability.tags, `${officer.id}:officer_ability`);
  }

  const allMembers = [captain, ...bridge, ...belowDeck].filter((officer): officer is Officer => Boolean(officer));
  const memberSet = new Set(allMembers.map((officer) => officer.id));
  const synergyMatches: Array<{ group: string; members: string[]; bonus: number }> = [];

  const candidateGroups = new Set(allMembers.flatMap((officer) => officer.synergy_groups));
  for (const group of [...candidateGroups].sort()) {
    const groupMembers = database.officers
      .filter((officer) => officer.synergy_groups.includes(group))
      .map((officer) => officer.id)
      .sort();

    if (groupMembers.length < 2) continue;
    if (groupMembers.every((id) => memberSet.has(id))) {
      score += task.synergy_bonus;
      synergyMatches.push({ group, members: groupMembers, bonus: task.synergy_bonus });
    }
  }

  let factionBonus = 0;
  if (task.faction_bonus && allMembers.length > 0) {
    const sameFaction = allMembers.every((officer) => officer.faction === allMembers[0]?.faction);
    if (sameFaction) {
      factionBonus = task.faction_bonus[allMembers[0]!.faction] ?? 0;
      score += factionBonus;
    }
  }

  const ids = memberIds(captain, bridge, belowDeck).sort();
  return {
    captain,
    bridge,
    belowDeck,
    score,
    matchedTags,
    synergyMatches,
    factionBonus,
    tieBreakerKey: ids.join("+"),
  };
}

function buildRecommendation(
  scored: ScoredCrew,
  rank: number,
  required: SlotConstraints,
  filled: SlotConstraints,
): OptimizedCrew {
  return {
    rank,
    score: scored.score,
    crew: {
      captain: scored.captain?.id ?? null,
      bridge: scored.bridge.map((officer) => officer.id).sort(),
      below_deck: scored.belowDeck.map((officer) => officer.id).sort(),
    },
    completeness: {
      requiredSlots: required,
      filledSlots: filled,
      missingSlots: {
        captain: Math.max(0, required.captain - filled.captain),
        bridge: Math.max(0, required.bridge - filled.bridge),
        below_deck: Math.max(0, required.below_deck - filled.below_deck),
      },
    },
    rationale: {
      matched_tags: [...scored.matchedTags].sort((a, b) =>
        `${a.tag}:${a.contributor}`.localeCompare(`${b.tag}:${b.contributor}`),
      ),
      synergy_matches: [...scored.synergyMatches].sort((a, b) => a.group.localeCompare(b.group)),
      faction_bonus: scored.factionBonus,
      captain_maneuver: scored.captain?.captain_maneuver.text ?? null,
      officer_abilities: [
        ...(scored.captain ? [scored.captain.officer_ability.text] : []),
        ...scored.bridge.map((officer) => officer.officer_ability.text),
        ...scored.belowDeck.map((officer) => officer.officer_ability.text),
      ],
    },
  };
}

function toTaskInput(task: TaskDefinition | OptimizerTaskInput): OptimizerTaskInput {
  if ("slot_constraints" in task) return task;
  return {
    id: task.id,
    name: task.name,
    tag_weights: task.tag_weights,
    synergy_bonus: task.synergy_bonus,
    faction_bonus: task.faction_bonus,
    constraints: task.constraints,
    slot_constraints: DEFAULT_SLOT_CONSTRAINTS,
  };
}

export function optimizeCrew(input: {
  database: OfficerDatabase;
  roster: Roster;
  task: TaskDefinition | OptimizerTaskInput;
  top?: number;
}): OptimizeCrewResult {
  const { database, roster } = input;
  validateRosterOfficerIds(roster, database);
  const task = toTaskInput(input.task);
  const top = Math.max(1, input.top ?? 3);
  const required = resolveSlotConstraints(task);

  const excluded = new Set(task.constraints?.exclude_officers ?? []);
  const owned = [...roster.officers]
    .filter((entry): entry is Extract<(typeof roster.officers)[number], { owned: true }> => entry.owned)
    .map((entry) => ({ entry, officer: database.getOfficerById(entry.id) }))
    .filter(({ officer }) => !excluded.has(officer.id))
    .sort((a, b) => a.officer.id.localeCompare(b.officer.id));

  const captains = owned
    .filter(({ officer }) => officer.bda_role === "captain" || officer.bda_role === "either")
    .map(({ officer }) => officer);

  const bridgePool = owned
    .filter(({ officer }) => officer.bda_role === "officer" || officer.bda_role === "either")
    .map(({ officer }) => officer);

  const belowDeckPool = owned.map(({ officer }) => officer);

  const scoredCrews: ScoredCrew[] = [];
  const captainOptions = required.captain === 0 ? [null] : captains;
  for (const captain of captainOptions) {
    const bridgeCandidates = bridgePool.filter((officer) => officer.id !== captain?.id);
    for (const bridge of combinations(bridgeCandidates, required.bridge)) {
      const used = new Set(memberIds(captain, bridge, []));
      const belowCandidates = belowDeckPool.filter((officer) => !used.has(officer.id));
      for (const belowDeck of combinations(belowCandidates, required.below_deck)) {
        scoredCrews.push(scoreCrew(database, task, captain, bridge, belowDeck));
      }
    }
  }

  const entriesById = new Map(
    owned.map(({ entry }) => [
      entry.id,
      {
        level: entry.level,
      },
    ]),
  );

  const totalLevelFor = (crew: ScoredCrew): number =>
    memberIds(crew.captain, crew.bridge, crew.belowDeck).reduce(
      (sum, id) => sum + (entriesById.get(id)?.level ?? 0),
      0,
    );

  const compareScored = (a: ScoredCrew, b: ScoredCrew): number => {
    if (b.score !== a.score) return b.score - a.score;
    // Ties are resolved deterministically: lexicographic crew-id key first, then total level.
    const tieByIds = a.tieBreakerKey.localeCompare(b.tieBreakerKey);
    if (tieByIds !== 0) return tieByIds;

    return totalLevelFor(b) - totalLevelFor(a);
  };

  if (scoredCrews.length === 0) {
    const bestCaptain = captains[0] ?? null;
    const bridge = bridgePool.filter((officer) => officer.id !== bestCaptain?.id).slice(0, required.bridge);
    const used = new Set(memberIds(bestCaptain, bridge, []));
    const belowDeck = belowDeckPool.filter((officer) => !used.has(officer.id)).slice(0, required.below_deck);

    scoredCrews.push(scoreCrew(database, task, bestCaptain, bridge, belowDeck));
  }

  const ranked = scoredCrews.sort(compareScored).slice(0, top).map((scored, index) => {
    const filled: SlotConstraints = {
      captain: scored.captain ? 1 : 0,
      bridge: scored.bridge.length,
      below_deck: scored.belowDeck.length,
    };

    return buildRecommendation(scored, index + 1, required, filled);
  });

  if (ranked.length > 0) {
    for (const crew of ranked) {
      crew.rationale.officer_abilities.sort();
    }
  }

  return {
    task_id: task.id,
    ranked_crews: ranked,
  };
}
