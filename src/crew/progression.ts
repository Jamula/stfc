import type { OfficerDatabase } from "./database.ts";
import { validateRosterOfficerIds } from "./roster.ts";
import type { Officer, Roster, TagId } from "./schemas.ts";

const TASK_CLASS_TAGS = {
  mining: ["mining_rate", "cargo_capacity", "warp_range"],
  hostiles: ["hostile_crit", "hostile_mitigation"],
  armada: ["armada_damage", "armada_mitigation"],
  isolytic: ["isolytic_damage", "isolytic_mitigation"],
  pvp: ["pvp_damage", "pvp_mitigation", "station_defense"],
  utility: ["dispatch_speed", "repair_cost", "morale_recovery"],
} as const satisfies Record<string, TagId[]>;

type TaskClass = keyof typeof TASK_CLASS_TAGS;

export interface ProgressionAnalysis {
  under_leveled_owned: Array<{
    officer_id: string;
    level: number;
    rank: number;
    promotions: number;
    priority_score: number;
    top_task_classes: TaskClass[];
  }>;
  missing_high_value: Array<{
    officer_id: string;
    priority_score: number;
    top_task_classes: TaskClass[];
    synergy_with_owned: string[];
  }>;
  suggested_promotion_order: Array<{
    officer_id: string;
    current: { level: number; rank: number; promotions: number };
    rationale: string;
    priority_score: number;
  }>;
  task_class_gaps: Array<{
    task_class: TaskClass;
    covered_by_owned: number;
    missing_high_value: number;
    top_missing_officers: string[];
  }>;
}

function scoreOfficerByTaskClass(officer: Officer): Record<TaskClass, number> {
  const tags = new Set([...officer.captain_maneuver.tags, ...officer.officer_ability.tags]);
  const scoreByClass = {} as Record<TaskClass, number>;
  for (const taskClass of Object.keys(TASK_CLASS_TAGS) as TaskClass[]) {
    const matched = TASK_CLASS_TAGS[taskClass].filter((tag) => tags.has(tag)).length;
    scoreByClass[taskClass] = matched;
  }
  return scoreByClass;
}

function topTaskClasses(scoreByClass: Record<TaskClass, number>): TaskClass[] {
  return (Object.keys(scoreByClass) as TaskClass[])
    .filter((taskClass) => scoreByClass[taskClass] > 0)
    .sort((a, b) => {
      if (scoreByClass[b] !== scoreByClass[a]) return scoreByClass[b] - scoreByClass[a];
      return a.localeCompare(b);
    });
}

export function analyzeProgression(input: {
  database: OfficerDatabase;
  roster: Roster;
}): ProgressionAnalysis {
  const { database, roster } = input;
  validateRosterOfficerIds(roster, database);
  const rosterMap = new Map(roster.officers.map((entry) => [entry.id, entry]));
  const ownedIds = new Set(
    roster.officers.filter((entry): entry is Extract<(typeof roster.officers)[number], { owned: true }> => entry.owned).map(
      (entry) => entry.id,
    ),
  );

  const scoreMap = new Map(database.officers.map((officer) => [officer.id, scoreOfficerByTaskClass(officer)]));

  const underLeveledOwned = roster.officers
    .filter((entry): entry is Extract<(typeof roster.officers)[number], { owned: true }> => entry.owned)
    .filter((entry) => entry.level < 60 || entry.rank < 3)
    .map((entry) => {
      const classScores = scoreMap.get(entry.id) ?? ({} as Record<TaskClass, number>);
      const utility = Object.values(classScores).reduce((sum, value) => sum + value, 0);
      const progressGap = (60 - Math.min(entry.level, 60)) + (3 - Math.min(entry.rank, 3)) * 10;
      const priorityScore = utility * 10 + progressGap;
      return {
        officer_id: entry.id,
        level: entry.level,
        rank: entry.rank,
        promotions: entry.promotions,
        priority_score: priorityScore,
        top_task_classes: topTaskClasses(classScores).slice(0, 3),
      };
    })
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return a.officer_id.localeCompare(b.officer_id);
    });

  const missingHighValue = database.officers
    .filter((officer) => {
      const entry = rosterMap.get(officer.id);
      if (!entry) return true;
      return entry.owned === false;
    })
    .map((officer) => {
      const classScores = scoreMap.get(officer.id) ?? ({} as Record<TaskClass, number>);
      const classUtility = Object.values(classScores).reduce((sum, value) => sum + value, 0);
      const synergyWithOwned = officer.synergy_groups
        .filter((group) =>
          database.officers.some(
            (candidate) => candidate.id !== officer.id && candidate.synergy_groups.includes(group) && ownedIds.has(candidate.id),
          ),
        )
        .sort();
      const priorityScore = classUtility * 10 + synergyWithOwned.length * 3;
      return {
        officer_id: officer.id,
        priority_score: priorityScore,
        top_task_classes: topTaskClasses(classScores).slice(0, 3),
        synergy_with_owned: synergyWithOwned,
      };
    })
    .filter((item) => item.priority_score > 0)
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return a.officer_id.localeCompare(b.officer_id);
    });

  const suggestedPromotionOrder = underLeveledOwned.map((entry) => ({
    officer_id: entry.officer_id,
    current: {
      level: entry.level,
      rank: entry.rank,
      promotions: entry.promotions,
    },
    rationale: `Raises ${entry.top_task_classes.join(", ")} impact while closing level/rank gap.`,
    priority_score: entry.priority_score,
  }));

  const taskClassGaps = (Object.keys(TASK_CLASS_TAGS) as TaskClass[])
    .map((taskClass) => {
      const coveredByOwned = database.officers.filter(
        (officer) => ownedIds.has(officer.id) && (scoreMap.get(officer.id)?.[taskClass] ?? 0) > 0,
      ).length;

      const relevantMissing = missingHighValue.filter((officer) => officer.top_task_classes.includes(taskClass));
      return {
        task_class: taskClass,
        covered_by_owned: coveredByOwned,
        missing_high_value: relevantMissing.length,
        top_missing_officers: relevantMissing.slice(0, 3).map((officer) => officer.officer_id),
      };
    })
    .sort((a, b) => {
      if (b.missing_high_value !== a.missing_high_value) return b.missing_high_value - a.missing_high_value;
      if (a.covered_by_owned !== b.covered_by_owned) return a.covered_by_owned - b.covered_by_owned;
      return a.task_class.localeCompare(b.task_class);
    });

  return {
    under_leveled_owned: underLeveledOwned,
    missing_high_value: missingHighValue,
    suggested_promotion_order: suggestedPromotionOrder,
    task_class_gaps: taskClassGaps,
  };
}
