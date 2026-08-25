import { G } from "./format";

/** Hard book: take profit is always 2R then 3R. Liquidity magnets never shrink RR. */
export const TP1_R = 2;
export const TP2_R = 3;
export const MIN_RR = 2;
export const STOP_ATR_PAD = 0.15;
export const MIN_STOP_ATR = 0.2;
export const MAX_STOP_ATR = 2.4;

export type Side = "LONG" | "SHORT";

export type RiskPlan = {
  ok: boolean;
  reason: string;
  side: Side;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: number;
  rrLabel: string;
  entryText: string;
  stopText: string;
  tp1Text: string;
  tp2Text: string;
};

export function planTrade(input: {
  side: Side;
  mark: number;
  sweepLevel: number;
  lastClose: number;
  atr: number;
  zoneLow?: number | null;
  zoneHigh?: number | null;
}): RiskPlan {
  const { side, mark, sweepLevel, lastClose, atr } = input;
  const pad = Math.max(atr * STOP_ATR_PAD, mark * 0.0004);
  const stop =
    side === "LONG"
      ? Math.min(sweepLevel, lastClose) - pad
      : Math.max(sweepLevel, lastClose) + pad;

  const mid =
    input.zoneLow != null && input.zoneHigh != null
      ? (input.zoneLow + input.zoneHigh) / 2
      : null;
  const entry = mid ?? mark;

  const rawRisk = side === "LONG" ? entry - stop : stop - entry;
  const floor = Math.max(atr * MIN_STOP_ATR, mark * 0.0025);
  const risk = Math.max(rawRisk, floor);

  const dead =
    (side === "LONG" && mark <= stop) || (side === "SHORT" && mark >= stop);
  const tooWide = atr > 0 && risk > atr * MAX_STOP_ATR;
  const inverted = risk <= 0 || !Number.isFinite(risk);

  let reason = "";
  if (dead) reason = "Price already through the stop";
  else if (inverted) reason = "Stop is on the wrong side of entry";
  else if (tooWide) reason = "Stop wider than 2.4× ATR — skip, unstable";

  const dir = side === "LONG" ? 1 : -1;
  const tp1 = entry + dir * risk * TP1_R;
  const tp2 = entry + dir * risk * TP2_R;
  const ok = !reason;

  const zoneText =
    input.zoneLow != null && input.zoneHigh != null
      ? `limit at ${G(input.zoneLow)}–${G(input.zoneHigh)} (50% ${G((input.zoneLow + input.zoneHigh) / 2)})`
      : `limit / market at ${G(entry)}`;

  return {
    ok,
    reason,
    side,
    entry,
    stop,
    tp1,
    tp2,
    risk,
    rrLabel: ok ? "1:2 / 1:3" : "—",
    entryText: zoneText,
    stopText: `beyond sweep extreme ${G(stop)}`,
    tp1Text: `${G(tp1)} (2R)`,
    tp2Text: `${G(tp2)} (3R)`,
  };
}

export function realizedR(side: Side, entry: number, stop: number, exit: number) {
  const risk = side === "LONG" ? entry - stop : stop - entry;
  if (risk <= 0) return 0;
  return side === "LONG" ? (exit - entry) / risk : (entry - exit) / risk;
}
