// Thin module-function wrappers around ApiClient methods. Equivalent to
// calling the methods directly; provided for callers that prefer the
// functional style (and for symmetry with how the diagnostic skills were
// originally written). The orchestrator (runAll) calls client methods
// directly so that test fakes can implement just the methods they care
// about without satisfying the full ApiClient surface.

import type { ApiClient } from "./client.ts";
import type { AuthMeResponse, ClaimResponse, Gift, GiftsResponse, RedeemResponse } from "./schemas.ts";

export function getMe(client: ApiClient): Promise<AuthMeResponse> {
  return client.getMe() as Promise<AuthMeResponse>;
}

export async function listGifts(client: ApiClient): Promise<Gift[]> {
  const raw = (await client.listGifts()) as GiftsResponse;
  return normalizeGifts(raw);
}

export function claimGift(client: ApiClient, bundleId: number | string): Promise<ClaimResponse> {
  return client.claimGift(bundleId) as Promise<ClaimResponse>;
}

export function redeemCode(client: ApiClient, code: string): Promise<RedeemResponse> {
  return client.redeemCode(code) as Promise<RedeemResponse>;
}

function normalizeGifts(raw: unknown): Gift[] {
  if (Array.isArray(raw)) return raw as Gift[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as Gift[];
    if (Array.isArray(obj.data)) return obj.data as Gift[];
    if (Array.isArray(obj.gifts)) return obj.gifts as Gift[];
  }
  return [];
}
