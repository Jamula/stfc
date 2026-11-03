import type { RunHealth } from "./schemas.ts";

export function formatPromoScanStatus(
  health: Pick<RunHealth, "promoChannelsConfigured" | "promoChannelsRead">,
): string {
  const configured = health.promoChannelsConfigured ?? 0;
  const read = health.promoChannelsRead ?? 0;

  if (configured === 0) {
    return "NOT RUN — no enabled promo-code channels are configured; no conclusion about code availability";
  }
  if (read === 0) {
    return `FAILED — no promo-code channels were successfully read (0/${configured})`;
  }
  if (read < configured) {
    return `PARTIAL — successfully read ${read}/${configured} promo-code channels`;
  }
  return `COMPLETE — successfully read ${read}/${configured} promo-code channels`;
}
