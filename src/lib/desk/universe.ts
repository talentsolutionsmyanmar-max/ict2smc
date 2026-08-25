export const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "AVAXUSDT", "HYPEUSDT"] as const;
export const TRADE_PAIRS = ["BTCUSDT", "ETHUSDT"] as const;
export type MajorPair = (typeof MAJORS)[number];

export function isMajorPair(pair: string) {
  const p = pair.replace(/[^A-Z0-9]/g, "").toUpperCase();
  return MAJORS.some((m) => m === p || m.startsWith(p));
}

/** Live ARM universe after minus-R replay. Watchlist can still list MAJORS. */
export function isTradePair(pair: string) {
  const p = pair.replace(/[^A-Z0-9]/g, "").toUpperCase();
  return p === "BTCUSDT" || p === "ETHUSDT" || p === "BTC" || p === "ETH";
}
