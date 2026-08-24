import { G } from "./format";
import { sessionLevels } from "./ict";
import type { Analysis, Tape } from "./types";

export type EngineState = "first-run" | "stale" | "in-trade" | "stand-aside" | "invalidated";

export type RailChip = {
  id: "trig" | "entry" | "sl" | "tp1" | "tp2";
  label: string;
  px: number;
  pending: boolean;
  filled: boolean;
};

function num(s: string | undefined): number | null {
  if (!s || s === "—" || s === "-") return null;
  const mid = s.match(/50%\s+(\d+(?:\.\d+)?)/);
  if (mid) return Number(mid[1]);
  const found = s.match(/(\d+(?:\.\d+)?)/g);
  if (!found) return null;
  const last = Number(found[found.length - 1]);
  return Number.isFinite(last) && last > 0 ? last : null;
}

function sweepPx(sequence: string): number | null {
  const m = sequence.match(/Sweep @ [^\d]+(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
}

export function engineState(analysis: Analysis | null, tape: Tape | null, now = Date.now()): EngineState {
  if (!tape?.candles.length) return "first-run";
  if (now - tape.at > 90000) return "stale";
  const miss = `${analysis?.missingPriority ?? ""} ${analysis?.missing.join(" ") ?? ""}`.toLowerCase();
  if (
    miss.includes("reclaim") ||
    miss.includes("invalid") ||
    miss.includes("through the") ||
    miss.includes("setup is dead") ||
    miss.includes("spent")
  ) {
    return "invalidated";
  }
  if (analysis?.verdict === "LONG" || analysis?.verdict === "SHORT") return "in-trade";
  return "stand-aside";
}

export function distPct(px: number, mark: number): string {
  if (!mark) return "0.00";
  const d = ((px - mark) / mark) * 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}`;
}

export function railChips(analysis: Analysis | null, tape: Tape | null): RailChip[] {
  const mark = tape?.mark || tape?.last || 0;
  const levels = tape?.candles.length ? sessionLevels(tape.candles) : null;
  const state = engineState(analysis, tape);
  const trig =
    sweepPx(analysis?.sequence ?? "") ??
    (levels && mark
      ? Math.abs((levels.asiaHigh ?? mark) - mark) <= Math.abs((levels.asiaLow ?? mark) - mark)
        ? (levels.asiaHigh ?? levels.pdh ?? mark)
        : (levels.asiaLow ?? levels.pdl ?? mark)
      : mark) ??
    mark;
  const entry = num(analysis?.entry) ?? trig;
  const sl =
    num(analysis?.stopLoss) ??
    (levels ? (entry >= mark ? (levels.asiaLow ?? entry * 0.992) : (levels.asiaHigh ?? entry * 1.008)) : entry * 0.992);
  const tp1 = num(analysis?.takeProfit1) ?? (levels?.asiaHigh && entry < (levels.asiaHigh ?? 0) ? levels.asiaHigh : entry * 1.012);
  const tp2 = num(analysis?.takeProfit2) ?? (levels?.pdh && entry < (levels.pdh ?? 0) ? levels.pdh : entry * 1.02);
  const pending = state !== "in-trade";
  const filledEntry = state === "in-trade" && mark > 0 && Math.abs(mark - entry) / entry < 0.004;
  const chips: RailChip[] =
    state === "invalidated"
      ? [
          { id: "trig", label: "INV", px: trig || mark, pending: false, filled: false },
          { id: "sl", label: "SL", px: sl, pending: false, filled: false },
        ]
      : [
          { id: "trig", label: "TRIG", px: trig || mark, pending, filled: false },
          { id: "entry", label: "ENT", px: entry, pending, filled: filledEntry },
          { id: "sl", label: "SL", px: sl, pending, filled: false },
          { id: "tp1", label: "TP1", px: tp1, pending, filled: false },
          { id: "tp2", label: "TP2", px: tp2, pending, filled: false },
        ];
  return chips
    .filter((c) => Number.isFinite(c.px) && c.px > 0)
    .sort((a, b) => b.px - a.px);
}

export function dockPreview(analysis: Analysis | null, tape: Tape | null) {
  const chips = railChips(analysis, tape);
  const mark = tape?.mark || 0;
  const by = Object.fromEntries(chips.map((c) => [c.id, c])) as Partial<Record<RailChip["id"], RailChip>>;
  const trig = by.trig ?? chips[0];
  return {
    trig: trig ? G(trig.px) : G(mark),
    dist: trig ? `${distPct(trig.px, mark)}%` : "0.00%",
    sl: by.sl ? G(by.sl.px) : G(mark),
    tp: by.tp1 && by.tp2 ? `${G(by.tp1.px)} / ${G(by.tp2.px)}` : by.tp1 ? G(by.tp1.px) : G(mark),
    entry: by.entry ? G(by.entry.px) : G(mark),
  };
}
