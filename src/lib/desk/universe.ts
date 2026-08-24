export const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "AVAXUSDT", "HYPEUSDT"] as const;
export type MajorPair = (typeof MAJORS)[number];

export function isMajorPair(pair: string) {
  const p = pair.replace(/[^A-Z0-9]/g, "").toUpperCase();
  return MAJORS.some((m) => m === p || m.startsWith(p));
}
