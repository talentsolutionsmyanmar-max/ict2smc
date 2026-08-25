/** kz-v3 live book — after minus-R replay Jun–Aug 2026. */
export const TRADE_UNIVERSE = ["BTCUSDT", "ETHUSDT"] as const;
export const BE_R = 1;
export const TP1_R = 2;
export const TP2_R = 3;
export const MAX_RAID_AGE_BARS = 4;
export const ARM_WINDOWS = ["primary"] as const;

export function isTradePair(pair: string) {
  const p = pair.replace(/[^A-Z0-9]/g, "").toUpperCase();
  return p === "BTCUSDT" || p === "ETHUSDT" || p === "BTC" || p === "ETH";
}
