// Permissive zod schemas for the reverse-engineered STFC web-store API.
// We only validate the shape of fields the rest of the code reads — every
// schema uses .passthrough() so unknown fields never cause failures, and
// gift fields are all optional because the API has surprised us before.

import { z } from "zod";

const numericOrString = z.union([z.number(), z.string()]);

export const AuthMeResponseSchema = z.object({}).passthrough();
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const GiftSchema = z
  .object({
    bundleId: numericOrString.optional(),
    id: numericOrString.optional(),
    title: z.string().optional(),
    isClaimable: z.boolean().optional(),
    isClaimed: z.boolean().optional(),
    isSpecial: z.boolean().optional(),
    hasCost: z.boolean().optional(),
    isAtMax: z.boolean().optional(),
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
    code: numericOrString.optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type RedeemResponse = z.infer<typeof RedeemResponseSchema>;
