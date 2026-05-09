// Permissive zod schemas for the reverse-engineered STFC web-store API.
// We only validate the shape of fields the rest of the code reads — every
// schema uses .passthrough() so unknown fields never cause failures, and
// gift fields are all optional because the API has surprised us before.
//
// Field-name notes (verified against the live API):
// - The list endpoint returns items with `bundle_id` (snake_case).
// - The claim endpoint expects `bundleId` (camelCase) in the request body.
// - The list also has a flat string `title` and `name`. The boolean-ish
//   flags `is_special`, `is_giftable`, etc. are 0/1 numbers, not booleans.

import { z } from "zod";

const numericOrString = z.union([z.number(), z.string()]);
const truthyish = z.union([z.boolean(), z.number()]).optional();

export const AuthMeResponseSchema = z.object({}).passthrough();
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const GiftSchema = z
  .object({
    bundle_id: numericOrString.optional(),
    bundleId: numericOrString.optional(),
    id: numericOrString.optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    is_special: truthyish,
    isSpecial: truthyish,
    is_giftable: truthyish,
    has_cost: truthyish,
    hasCost: truthyish,
    is_at_max: truthyish,
    isAtMax: truthyish,
    is_claimable: truthyish,
    isClaimable: truthyish,
    is_claimed: truthyish,
    isClaimed: truthyish,
  })
  .passthrough();
export type Gift = z.infer<typeof GiftSchema>;

const GiftArraySchema = z.array(GiftSchema);

export const GiftsResponseSchema = z.union([
  GiftArraySchema,
  z.object({ items: GiftArraySchema }).passthrough(),
  z.object({ data: GiftArraySchema }).passthrough(),
  z.object({ gifts: GiftArraySchema }).passthrough(),
]);
export type GiftsResponse = z.infer<typeof GiftsResponseSchema>;

export const ClaimResponseSchema = z.object({}).passthrough();
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const RedeemResponseSchema = z
  .object({
    // Legacy field names (kept for backward-compat in tests / older API surface):
    code: numericOrString.optional(),
    message: z.string().optional(),
    // Live API as of May 2026:
    redeem_result: z.number().optional(),
    promo_code: z.string().optional(),
  })
  .passthrough();
export type RedeemResponse = z.infer<typeof RedeemResponseSchema>;

