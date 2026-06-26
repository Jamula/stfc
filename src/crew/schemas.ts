import { z } from "zod";

export const TagIdSchema = z.enum([
  "mining_rate",
  "hostile_crit",
  "hostile_mitigation",
  "armada_damage",
  "armada_mitigation",
  "isolytic_damage",
  "isolytic_mitigation",
  "warp_range",
  "cargo_capacity",
  "station_defense",
  "pvp_damage",
  "pvp_mitigation",
  "dispatch_speed",
  "repair_cost",
  "morale_recovery",
]);
export type TagId = z.infer<typeof TagIdSchema>;

export const FactionSchema = z.enum([
  "federation",
  "klingon",
  "romulan",
  "independent",
  "rogue",
  "non_aligned",
]);
export type Faction = z.infer<typeof FactionSchema>;

export const BdaRoleSchema = z.enum(["captain", "officer", "either"]);
export type BdaRole = z.infer<typeof BdaRoleSchema>;

export const RankCurveSchema = z.enum(["linear", "back_loaded", "front_loaded"]);
export type RankCurve = z.infer<typeof RankCurveSchema>;

export const IsoUtcSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    "must be an ISO 8601 UTC timestamp ending in Z",
  );

const AbilityBlockSchema = z
  .object({
    text: z.string().min(1),
    tags: z.array(TagIdSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.tags).size !== value.tags.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tags"],
        message: "tags must be unique within an ability block",
      });
    }
  });

export const OfficerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case"),
    name: z.string().min(1),
    faction: FactionSchema,
    synergy_groups: z.array(z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "must be snake_case")),
    captain_maneuver: AbilityBlockSchema,
    officer_ability: AbilityBlockSchema,
    bda_role: BdaRoleSchema,
    rank_curve: RankCurveSchema,
    added_in_patch: z.string().min(1),
    source: z.string().min(1),
  })
  .strict();
export type Officer = z.infer<typeof OfficerSchema>;

export const OfficerDatabaseSchema = z
  .array(OfficerSchema)
  .min(1)
  .superRefine((officers, ctx) => {
    const seen = new Map<string, number>();
    officers.forEach((officer, index) => {
      const prev = seen.get(officer.id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `duplicate officer id '${officer.id}' (already seen at index ${prev})`,
        });
      } else {
        seen.set(officer.id, index);
      }
    });
  });

const OwnedRosterOfficerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    owned: z.literal(true),
    level: z.number().int().min(1).max(100),
    rank: z.number().int().min(1).max(5),
    promotions: z.number().int().min(0),
  })
  .strict();

const UnownedRosterOfficerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    owned: z.literal(false),
  })
  .strict();

export const RosterEntrySchema = z.discriminatedUnion("owned", [
  OwnedRosterOfficerSchema,
  UnownedRosterOfficerSchema,
]);
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

export const RosterSchema = z
  .object({
    account: z.string().min(1),
    last_updated: IsoUtcSchema,
    staleness_overrides: z
      .object({
        warn: z.number().int().min(1),
        error: z.number().int().min(1),
      })
      .strict()
      .optional(),
    officers: z.array(RosterEntrySchema),
  })
  .strict()
  .superRefine((roster, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < roster.officers.length; i++) {
      const id = roster.officers[i]!.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["officers", i, "id"],
          message: `duplicate officer id '${id}' in roster`,
        });
      }
      seen.add(id);
    }

    if (
      roster.staleness_overrides &&
      roster.staleness_overrides.error < roster.staleness_overrides.warn
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["staleness_overrides", "error"],
        message: "error threshold must be >= warn threshold",
      });
    }
  });
export type Roster = z.infer<typeof RosterSchema>;

const SlotRoleSchema = z.object({ bda_role: BdaRoleSchema }).strict();

export const TaskDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    description: z.string().min(1),
    slots: z
      .object({
        captain: SlotRoleSchema,
        officer_a: SlotRoleSchema,
        officer_b: SlotRoleSchema,
      })
      .strict(),
    tag_weights: z.partialRecord(TagIdSchema, z.number().int()),
    synergy_bonus: z.number().int().min(0),
    faction_bonus: z.partialRecord(FactionSchema, z.number().int()).optional(),
    constraints: z
      .object({
        exclude_officers: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).default([]),
      })
      .strict()
      .default({ exclude_officers: [] }),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((task, ctx) => {
    if (task.slots.captain.bda_role !== "captain") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", "captain", "bda_role"],
        message: "captain slot must require bda_role captain",
      });
    }
    if (task.slots.officer_a.bda_role !== "officer") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", "officer_a", "bda_role"],
        message: "officer_a slot must require bda_role officer",
      });
    }
    if (task.slots.officer_b.bda_role !== "officer") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots", "officer_b", "bda_role"],
        message: "officer_b slot must require bda_role officer",
      });
    }

    const hasTagWeights = Object.keys(task.tag_weights).length > 0;
    const hasFactionBonus = task.faction_bonus ? Object.keys(task.faction_bonus).length > 0 : false;
    if (!hasTagWeights && task.synergy_bonus === 0 && !hasFactionBonus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tag_weights"],
        message: "task scoring must include tag_weights, synergy_bonus, or faction_bonus",
      });
    }
  });

export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;
