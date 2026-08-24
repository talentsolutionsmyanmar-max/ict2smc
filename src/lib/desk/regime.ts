import type {
  Analysis,
  AuditOutcome,
  AuditRow,
  Bias,
  Candle,
  ClockState,
  Fvg,
  LiveStatus,
  RaidScan,
  RegimeState,
  RelStrength,
  RiskBook,
  SizeKind,
  Tape,
  Verdict,
  WindowKind,
} from "./types";
import { clockAt } from "./session";
import { lastFvg, scanRaid, structureOf, zoneReachable, ATR_GATE, isDisplacement } from "./ict";
import { compactPair, G } from "./format";

export const DEFAULT_RISK: RiskBook = {
  fullWinStreak: 0,
  needPrimaryWinner: false,
  openHalf: 0,
  lastAt: 0,
};

export { ATR_GATE } from "./ict";
export const OPEN_RISK_CAP = 3;

export function isMajor(pair: string) {
  const b = compactPair(pair);
  return b === "BTC" || b === "ETH";
}

export function rangeExpanding(candles: Candle[], n = 5): boolean {
  const slice = candles.slice(-n);
  if (slice.length < 3) return false;
  const dirs = slice.map((c) => (c.close >= c.open ? 1 : -1));
  const aligned = dirs.every((d) => d === dirs[0]);
  if (!aligned) return false;
  const first = slice[0].high - slice[0].low;
  const last = slice[slice.length - 1].high - slice[slice.length - 1].low;
  return last > first * 1.15;
}

export function detectRegime(tape: Pick<Tape, "h4" | "liqLongNotional" | "liqShortNotional" | "oiUsd" | "volRatio" | "changePct">, notes = ""): RegimeState {
  const reasons: string[] = [];
  const h4Trend = rangeExpanding(tape.h4 ?? [], 5);
  if (h4Trend) reasons.push("4H expanding directional ranges");

  const liq = Math.max(tape.liqLongNotional, tape.liqShortNotional);
  const cascade = liq > 0 && liq >= Math.max(tape.oiUsd * 0.002, 50_000);
  if (cascade) {
    const side = tape.liqLongNotional > tape.liqShortNotional ? "longs" : "shorts";
    reasons.push(`liquidation cascade of ${side}`);
  }

  const volSpike = tape.volRatio >= 1.5;
  if (volSpike && Math.abs(tape.changePct) >= 4) reasons.push("vol + 24h expansion");

  const note = notes.toLowerCase();
  if (/(etf|sec|fed|cpi|fomc|listing|unlock|catalyst|news|trump)/i.test(note)) {
    reasons.push("catalyst noted by desk");
  }

  if (Math.abs(tape.changePct) >= 8) reasons.push("24h range already expanded");

  return { trending: reasons.length > 0, reasons };
}

export function retN(candles: Candle[] | undefined, n = 4): number | null {
  const bars = candles?.slice(-n) ?? [];
  if (bars.length < 2) return null;
  const a = bars[0].open;
  const b = bars[bars.length - 1].close;
  if (!a) return null;
  return ((b - a) / a) * 100;
}

export function structureSwing(candles: Candle[] | undefined, n = 5): "hhhl" | "lllh" | "flat" {
  const bars = candles?.slice(-n) ?? [];
  if (bars.length < 3) return "flat";
  const firstH = bars[0].high;
  const lastH = bars[bars.length - 1].high;
  const firstL = bars[0].low;
  const lastL = bars[bars.length - 1].low;
  if (lastH > firstH && lastL > firstL) return "hhhl";
  if (lastH < firstH && lastL < firstL) return "lllh";
  return "flat";
}

export function relStrengthOf(
  tape: Pick<Tape, "symbol" | "changePct" | "btcChangePct"> & { h4?: Candle[]; btcH4?: Candle[] },
): RelStrength {
  if (compactPair(tape.symbol) === "BTC") return "lead";
  const altRet = retN(tape.h4, 4);
  const btcRet = retN(tape.btcH4, 4);
  const altSwing = structureSwing(tape.h4, 5);
  const btcSwing = structureSwing(tape.btcH4, 5);
  const perfLead = altRet != null && btcRet != null && altRet > btcRet;
  const structLead = altSwing === "hhhl" && (btcSwing === "flat" || btcSwing === "lllh" || (perfLead && btcSwing !== "hhhl"));
  if (perfLead || structLead) return "lead";
  if (altRet != null && btcRet != null && altRet < btcRet && altSwing !== "hhhl") return "lag";
  if (altSwing === "lllh" && btcSwing === "hhhl") return "lag";
  if (altRet == null || btcRet == null) {
    if (tape.changePct - tape.btcChangePct >= 1.2) return "lead";
    if (tape.btcChangePct - tape.changePct >= 1.2) return "lag";
  }
  return "flat";
}

function cvdNote(tape: Pick<Tape, "cvd" | "cvdPoints">, sweep: "bullish" | "bearish"): string | null {
  const aligned = (sweep === "bullish" && tape.cvd >= 0) || (sweep === "bearish" && tape.cvd < 0);
  if (aligned) return tape.cvd >= 0 ? "CVD confirming longs" : "CVD confirming shorts";
  const pts = tape.cvdPoints ?? [];
  if (pts.length >= 4) {
    const first = pts[0].cvd;
    const mid = pts[Math.floor(pts.length / 2)].cvd;
    const last = pts[pts.length - 1].cvd;
    const flipped = sweep === "bullish" ? mid < first && last > mid : mid > first && last < mid;
    const aggressive = Math.abs(last - mid) >= Math.abs(mid - first) * 0.8 && Math.abs(last - mid) > 0;
    if (flipped && aggressive) return "CVD aggressively diverging with the reversal";
  }
  return null;
}

export function confirms(tape: Pick<Tape, "oiDeltaPct" | "cvd" | "cvdPoints" | "liqLongNotional" | "liqShortNotional" | "relStrength" | "btcBias4h" | "symbol">, sweep: "bullish" | "bearish"): string[] {
  const out: string[] = [];
  const oiWith =
    (sweep === "bullish" && tape.oiDeltaPct > 0.4) ||
    (sweep === "bearish" && tape.oiDeltaPct < -0.4) ||
    tape.oiDeltaPct > 1.2;
  if (oiWith) out.push(`OI ${tape.oiDeltaPct >= 0 ? "rising" : "falling"} ${tape.oiDeltaPct.toFixed(1)}%`);

  const cvd = cvdNote(tape, sweep);
  if (cvd) out.push(cvd);

  const liqOpp =
    (sweep === "bullish" && tape.liqShortNotional > tape.liqLongNotional * 1.2 && tape.liqShortNotional > 0) ||
    (sweep === "bearish" && tape.liqLongNotional > tape.liqShortNotional * 1.2 && tape.liqLongNotional > 0);
  if (liqOpp) out.push(sweep === "bullish" ? "shorts cascading on heatmap" : "longs cascading on heatmap");

  const rs = tape.relStrength === "lead" || compactPair(tape.symbol) === "BTC";
  const btcSame =
    tape.btcBias4h === "unclear" ? true : tape.btcBias4h === (sweep === "bullish" ? "bullish" : "bearish");
  if (rs && btcSame) out.push(compactPair(tape.symbol) === "BTC" ? "BTC structure aligned" : "RS vs BTC leading");

  return out;
}

export function sequenceComplete(raid: RaidScan | null, zoneOk: boolean, sweep: "bullish" | "bearish" | null) {
  return !!(
    sweep &&
    raid &&
    raid.timeBased &&
    raid.displacement &&
    isDisplacement(raid.lastRange, raid.atr) &&
    raid.atrMult >= ATR_GATE &&
    raid.mss &&
    zoneOk &&
    !raid.reclaimed
  );
}

export function classifyWindow(opts: {
  clock?: ClockState;
  regime: RegimeState;
  overrideReady: boolean;
  volSpike: boolean;
  oiSpike: boolean;
}): WindowKind {
  const clock = opts.clock ?? clockAt();
  if (clock.inPrimary) return "primary";
  if (opts.overrideReady) return "override";
  if (clock.inAsia) return opts.volSpike && opts.oiSpike ? "secondary" : "map";
  if (clock.inSecondary) return "secondary";
  if (clock.role === "map") return "map";
  return "dead";
}

export function riskPctFor(size: SizeKind, book: RiskBook): number {
  if (size === "none") return 0;
  if (size === "half") return 0.35;
  let full = 0.75;
  if (!book.needPrimaryWinner && book.fullWinStreak >= 2) full = Math.min(1.5, 0.75 * 1.25);
  return full;
}

export function sizeFor(opts: {
  window: WindowKind;
  complete: boolean;
  book: RiskBook;
  openRisk: number;
}): SizeKind {
  if (!opts.complete) return "none";
  let size: SizeKind = "none";
  if (opts.window === "primary") size = "full";
  else if (opts.window === "secondary" || opts.window === "override") {
    if (opts.book.openHalf >= 2) return "none";
    size = "half";
  }
  if (size === "none") return "none";
  const risk = riskPctFor(size, opts.book);
  if (opts.openRisk + risk > OPEN_RISK_CAP) return "none";
  return size;
}

export function missingPriority(opts: {
  bias4h: Bias;
  sweep: "bullish" | "bearish" | null;
  raid: RaidScan | null;
  zoneOk: boolean;
  window: WindowKind;
  overrideReady: boolean;
  fade: boolean;
  reclaimed: boolean;
  spent?: boolean;
  altRsBlocked?: boolean;
  riskCap?: boolean;
  confirmNeed?: number;
  confirmCount?: number;
  knife?: string | null;
}): string {
  if (opts.bias4h === "unclear") return "4H bias unclear";
  if (opts.sweep) {
    const withHtf = opts.sweep === "bullish" ? opts.bias4h === "bullish" : opts.bias4h === "bearish";
    if (!withHtf) return "4H fights 15M direction";
  }
  if (opts.knife) return opts.knife;
  if (opts.fade) return "Sweep fades the London day — that level is the target";
  if (opts.reclaimed) return "Swept level already reclaimed";
  if (opts.spent) return "Move already spent — wait for a fresh raid";
  if (!opts.sweep) {
    if (opts.raid?.notes.some((n) => n.includes("still mapping"))) {
      return "Asia range still mapping — no sweep on current extremes";
    }
    return "No raid of Asia / PDH-PDL from inside the range";
  }
  if (opts.raid && !opts.raid.timeBased) return "Sweep is a random 15m swing, not a time-based level";
  if (opts.raid && !opts.raid.displacement) return "no displacement (< 1.2× ATR)";
  if (opts.raid && !opts.raid.mss) return "no MSS";
  if (!opts.zoneOk) return "Waiting for the first 15M FVG of the displacement";
  if (opts.altRsBlocked) return "alts require RS vs BTC leading for Override";
  if (opts.riskCap) return "Total open risk would exceed 3%";
  if ((opts.confirmNeed ?? 2) > 2 && (opts.confirmCount ?? 0) < (opts.confirmNeed ?? 2)) {
    return `4H premium — Override needs ${opts.confirmNeed} confluence`;
  }
  if (opts.window === "dead" || opts.window === "map") {
    if (opts.raid?.notes.some((n) => n.includes("still mapping"))) {
      return "Asia range still mapping — no sweep on current extremes";
    }
    return opts.overrideReady ? "Override Ready" : "Asia grind + Override conditions incomplete";
  }
  return "Stand aside";
}

export function windowLabel(w: WindowKind) {
  if (w === "primary") return "Primary";
  if (w === "secondary") return "Secondary";
  if (w === "override") return "Override";
  if (w === "map") return "Map (Asia)";
  return "Dead zone";
}

/** One clock string for the whole desk — never mix Map / Dead / Pre-London. */
export function displayClock(clock: ClockState, window: WindowKind): string {
  if (window === "override") return `${clock.sessionLabel} · Override`;
  return clock.sessionLabel;
}

export function h4Position(h4: Candle[] | undefined): number {
  if (!h4?.length) return 0.5;
  const high = Math.max(...h4.map((c) => c.high));
  const low = Math.min(...h4.map((c) => c.low));
  const last = h4[h4.length - 1].close;
  const span = high - low || 1;
  return (last - low) / span;
}

export function confirmNeedFor(sweep: "bullish" | "bearish" | null, h4: Candle[] | undefined): number {
  if (!sweep || !h4?.length) return 2;
  const pos = h4Position(h4);
  if (sweep === "bullish" && pos >= 0.7) return 3;
  if (sweep === "bearish" && pos <= 0.3) return 3;
  return 2;
}

/** Hard veto: do not long a dump in 4H premium / short a rip in 4H discount, or fade CVD. */
export function knifeReason(opts: {
  sweep: "bullish" | "bearish" | null;
  raid: RaidScan | null;
  tape: Pick<Tape, "cvd" | "cvdPoints" | "h4" | "funding">;
}): string | null {
  const { sweep, raid, tape } = opts;
  if (!sweep || !raid) return null;
  if (raid.asiaDump && sweep === "bullish") {
    return "Asia was a selloff, not a range — sweeping that low is continuation, not a long";
  }
  if (raid.asiaDump && sweep === "bearish") {
    return "Asia was a buyout, not a range — sweeping that high is continuation, not a short";
  }
  if (raid.weakBounce) return "Bounce is too small vs the dump — not a raid";
  const pos = h4Position(tape.h4);
  if (sweep === "bullish" && pos >= 0.7) return "4H premium after expansion — no continuation long";
  if (sweep === "bearish" && pos <= 0.3) return "4H discount after dump — no continuation short";
  const cvdOk = cvdNote(tape, sweep);
  if (sweep === "bullish" && tape.cvd <= -1 && !cvdOk) return "CVD fighting the long";
  if (sweep === "bearish" && tape.cvd >= 1 && !cvdOk) return "CVD fighting the short";
  if (sweep === "bullish" && (tape.funding ?? 0) >= 0.005) return "Funding crowded — longs already paying";
  return null;
}

export function fourHClear(bias4h: Bias, sweep: "bullish" | "bearish" | null) {
  if (!sweep || bias4h === "unclear") return false;
  if (sweep === "bullish") return bias4h === "bullish";
  return bias4h === "bearish";
}

/** Hard veto: 15M MSS direction and FVG direction must both equal 4H bias. */
export function directionalAgreement(
  bias4h: Bias,
  mssDir: "bullish" | "bearish" | null,
  fvgDir: "bullish" | "bearish" | null,
): boolean {
  if (bias4h !== "bullish" && bias4h !== "bearish") return false;
  if (mssDir !== bias4h) return false;
  if (fvgDir !== bias4h) return false;
  return true;
}

export function reasoningOf(a: Analysis): string {
  if (a.verdict === "STAND_ASIDE") return a.missingPriority;
  if (a.window === "override") return "Override: 4H agrees, sequence complete, confluence ≥2 — half-size limit at 50% FVG.";
  if (a.window === "primary") return "Primary KZ: 4H agrees and the 15M sequence is complete.";
  if (a.window === "secondary") return "Secondary window: half-size on the first FVG of the displacement.";
  return a.narrative.split(". ")[0] || a.missingPriority;
}

export function formatSignal(a: Analysis): string {
  const regime = a.regime === "trending" ? "Trending" : "Ranging";
  const clock = a.killzone.session && a.killzone.session !== "—" ? a.killzone.session : windowLabel(a.window);
  if (a.verdict === "STAND_ASIDE") {
    return `${a.pair} | ${a.bias4h.toUpperCase()} | ${regime}
Window: ${clock}
STAND ASIDE · ${a.missingPriority}`;
  }
  return `${a.pair} | ${a.bias4h.toUpperCase()} | ${regime}
Window: ${windowLabel(a.window)} · ${clock}
Sequence: ${a.sequence}
Entry: ${a.entry}
Stop: ${a.stopLoss}
TP1 / TP2: ${a.takeProfit1} / ${a.takeProfit2}
Size: ${a.size} (${a.riskPct}%)
Invalidation: ${a.invalidation}
Reasoning: ${reasoningOf(a)}`;
}

export function fvgMid(tape: Tape, side: "bullish" | "bearish") {
  const fvg = lastFvg(tape.candles);
  if (!fvg || fvg.kind !== side) return null;
  return { ...fvg, mid: (fvg.low + fvg.high) / 2 };
}

export function oneMinuteHint(tape: Tape, side: "bullish" | "bearish") {
  const s = structureOf(tape.m1?.length ? tape.m1 : tape.candles);
  if (!s) return "1M optional — limit 50% of the 15M FVG.";
  if (side === "bullish" && s.inDiscount) return `1M in discount of ${s.low.toPrecision(5)}–${s.high.toPrecision(5)} — limit the FVG.`;
  if (side === "bearish" && !s.inDiscount) return `1M in premium of ${s.low.toPrecision(5)}–${s.high.toPrecision(5)} — limit the FVG.`;
  return `1M ${s.bias} — wait for pullback into the 15M FVG, do not market the close.`;
}

export function liveStatus(opts: {
  clock?: ClockState;
  regime: RegimeState;
  overrideReady: boolean;
  window: WindowKind;
  verdict?: Verdict;
  missingPriority?: string;
}): LiveStatus {
  const clock = opts.clock ?? clockAt();
  const aside = !opts.verdict || opts.verdict === "STAND_ASIDE";
  const miss = (opts.missingPriority || "").trim();
  if (aside) {
    return {
      line: `STAND ASIDE — ${miss || "waiting for sequence"}`,
      sub: clock.sessionLabel,
      tone: "warn",
    };
  }
  if (opts.overrideReady) {
    return { line: "Override Ready", sub: "Half-size · clock is not a veto", tone: "warn" };
  }
  if (opts.regime.trending) {
    return {
      line: "Trending Regime Active",
      sub: clock.inSecondary ? "Secondary window · half size" : "Structure expanding",
      tone: "warn",
    };
  }
  if (opts.window === "primary" || clock.inPrimary) {
    return { line: "Armed · primary KZ", sub: "Full size if sequence completes", tone: "live" };
  }
  if (opts.window === "map" || clock.inAsia) {
    return { line: "Asia · mapping the range", sub: "Half-size only on vol+OI spike or Override", tone: "neutral" };
  }
  return { line: "Armed · primary KZ", sub: "", tone: "live" };
}

export function openRiskOf(rows: AuditRow[]): number {
  return rows
    .filter((r) => r.outcome === "open" && r.verdict !== "STAND_ASIDE")
    .reduce((s, r) => s + Number(r.riskPct || 0), 0);
}

export type DecideInput = {
  pair: string;
  clock: ClockState;
  bias4h: Bias;
  raid: RaidScan | null;
  zone: Fvg | null;
  tape: Pick<
    Tape,
    | "volRatio"
    | "oiRatio"
    | "oiDeltaPct"
    | "cvd"
    | "cvdPoints"
    | "relStrength"
    | "liqLongNotional"
    | "liqShortNotional"
    | "symbol"
    | "btcBias4h"
    | "h4"
    | "btcH4"
    | "changePct"
    | "oiUsd"
    | "mark"
    | "last"
    | "funding"
  >;
  notes?: string;
  book: RiskBook;
  openRisk: number;
};

export type DecideOut = {
  window: WindowKind;
  size: SizeKind;
  riskPct: number;
  verdict: Verdict;
  overrideReady: boolean;
  complete: boolean;
  fourOk: boolean;
  confirms: string[];
  missingPriority: string;
  wouldHaveBeen: boolean;
  sequence: string;
  regime: RegimeState;
  sweep: "bullish" | "bearish" | null;
};

export function decide(input: DecideInput): DecideOut {
  const { pair, clock, bias4h, raid, zone, tape, book, openRisk } = input;
  const fourHAgrees = fourHClear(bias4h, raid?.sweep ?? null);
  const spent = !!(raid?.extended && raid.ageBars >= 8);
  const sweep = raid?.reclaimed || spent || (raid?.fadeDay && !fourHAgrees) ? null : (raid?.sweep ?? null);
  const mark = tape.mark || tape.last;
  const zoneOk = !!(zone && sweep && zone.kind === sweep && zoneReachable(zone, mark));
  const regime = detectRegime(tape, input.notes);
  const confirmList = sweep ? confirms(tape, sweep) : [];
  const seqOk = sequenceComplete(raid, zoneOk, sweep);
  const mssDir = raid?.mss && raid.sweep && !raid.fadeDay && !raid.reclaimed ? raid.sweep : null;
  const fvgDir = zoneOk ? (zone?.kind ?? null) : null;
  const dirOk = directionalAgreement(bias4h, mssDir, fvgDir);
  const fourOk = fourHAgrees;
  const dispOk = !!(raid && raid.displacement && isDisplacement(raid.lastRange, raid.atr) && raid.atrMult >= ATR_GATE);
  const major = isMajor(pair);
  const rsGreen = major || tape.relStrength === "lead";
  const confirmNeed = confirmNeedFor(sweep, tape.h4);
  const knife = knifeReason({ sweep, raid, tape });
  const overrideReady = !knife && dirOk && seqOk && dispOk && confirmList.length >= confirmNeed && rsGreen;
  const window = classifyWindow({
    clock,
    regime,
    overrideReady,
    volSpike: tape.volRatio >= 1.5,
    oiSpike: (tape.oiRatio ?? 1) >= 1.5,
  });
  const complete = seqOk && fourOk && !knife;
  let size = sizeFor({ window, complete, book, openRisk });
  const riskCap = complete && (window === "primary" || window === "secondary" || window === "override") && size === "none" && openRisk + 0.35 > OPEN_RISK_CAP;
  const altRsBlocked = fourOk && seqOk && !rsGreen && !clock.inPrimary && confirmList.length >= 2;
  const miss = missingPriority({
    bias4h,
    sweep,
    raid,
    zoneOk,
    window,
    overrideReady,
    fade: !!raid?.fadeDay && !fourHAgrees,
    reclaimed: !!raid?.reclaimed,
    spent,
    altRsBlocked,
    riskCap,
    confirmNeed,
    confirmCount: confirmList.length,
    knife,
  });
  let verdict: Verdict = "STAND_ASIDE";
  if (size === "full" || size === "half") verdict = sweep === "bullish" ? "LONG" : "SHORT";
  const wouldHaveBeen = complete && verdict === "STAND_ASIDE" && !raid?.fadeDay && !raid?.reclaimed;
  const color =
    raid?.impulseDir === "bearish" ? "red" : raid?.impulseDir === "bullish" ? "green" : "";
  const atrBit =
    raid && raid.displacement && raid.atrMult >= ATR_GATE
      ? `Displacement (${raid.atrMult.toFixed(2)}×ATR${color ? `, ${color}` : ""})`
      : raid
        ? `Displacement (${raid.atrMult.toFixed(2)}×ATR < 1.2)`
        : "Displacement (none)";
  const mssBit =
    raid?.mss && raid.sweepName && raid.sweepLevel != null
      ? `MSS through ${raid.sweepName} ${G(raid.sweepLevel)}`
      : "no MSS";
  const fvgBit =
    zoneOk && zone ? `FVG ${G(zone.low)}–${G(zone.high)} (unfilled/reachable)` : "no FVG";
  const sequence =
    sweep && raid?.sweepName && raid.sweepLevel != null
      ? `Sweep @ ${raid.sweepName} ${G(raid.sweepLevel)} → ${atrBit} → ${mssBit} → ${fvgBit}`
      : "Sequence incomplete";
  return {
    window,
    size,
    riskPct: verdict === "STAND_ASIDE" ? 0 : riskPctFor(size, book),
    verdict,
    overrideReady,
    complete,
    fourOk,
    confirms: confirmList,
    missingPriority: verdict === "STAND_ASIDE" ? miss : "",
    wouldHaveBeen,
    sequence,
    regime,
    sweep,
  };
}

export function auditFrom(analysis: Analysis, tape: Tape): AuditRow | null {
  if (analysis.verdict === "STAND_ASIDE" && !analysis.wouldHaveBeen) return null;
  const raid = scanRaid(tape.candles, analysis.bias4h);
  const closedAt = analysis.closedAt || raid?.closedAt || tape.at;
  const sweep = raid?.sweep;
  const side: "long" | "short" | null =
    analysis.verdict === "LONG" || (analysis.wouldHaveBeen && sweep === "bullish")
      ? "long"
      : analysis.verdict === "SHORT" || (analysis.wouldHaveBeen && sweep === "bearish")
        ? "short"
        : null;
  const fvg = side ? fvgMid(tape, side === "long" ? "bullish" : "bearish") : null;
  const entryPx = fvg?.mid ?? raid?.sweepLevel ?? tape.mark;
  const atr = raid?.atr || tape.mark * 0.008;
  const swept = raid?.sweepLevel ?? tape.mark;
  const stopPx =
    side === "long"
      ? Math.min(swept, raid?.lastClose ?? tape.mark) - atr * 0.15
      : side === "short"
        ? Math.max(swept, raid?.lastClose ?? tape.mark) + atr * 0.15
        : null;
  return {
    id: `${analysis.pair}:${closedAt}:${analysis.verdict}:${analysis.window}`,
    at: Date.now(),
    closedAt,
    pair: analysis.pair,
    window: analysis.window,
    verdict: analysis.verdict,
    size: analysis.size,
    sequence: analysis.sequence,
    missingPriority: analysis.missingPriority,
    oiDeltaPct: tape.oiDeltaPct,
    cvd: tape.cvd,
    regime: analysis.regime,
    wouldHaveBeen: analysis.wouldHaveBeen,
    price: G(tape.mark),
    entryPx,
    stopPx,
    side,
    outcome: "open",
    rMultiple: null,
    riskPct: analysis.riskPct,
  };
}

export function applyOutcomeToBook(book: RiskBook, size: SizeKind, outcome: AuditOutcome): RiskBook {
  const lastAt = Date.now();
  const closeHalf = size === "half" ? 1 : 0;
  const openHalf = Math.max(0, book.openHalf - closeHalf);
  if (outcome === "scratch" || outcome === "open" || outcome === "missed_2r") {
    return { ...book, openHalf, lastAt };
  }
  if (outcome === "loss") {
    return { fullWinStreak: 0, needPrimaryWinner: true, openHalf, lastAt };
  }
  if (size === "full") {
    return { fullWinStreak: book.fullWinStreak + 1, needPrimaryWinner: false, openHalf, lastAt };
  }
  return { ...book, openHalf, lastAt };
}

export function bookAfterSignal(book: RiskBook, size: SizeKind, isTrade: boolean): RiskBook {
  if (!isTrade || size !== "half") return book;
  return { ...book, openHalf: Math.min(2, book.openHalf + 1), lastAt: Date.now() };
}

export type WindowStats = { n: number; wins: number; losses: number; hit: number };

export function reviewStats(rows: AuditRow[], now = Date.now()) {
  const week = rows.filter((r) => now - r.at < 7 * 86400000);
  const by = (w: WindowKind): WindowStats => {
    const set = week.filter((r) => r.window === w && r.verdict !== "STAND_ASIDE");
    const done = set.filter((r) => r.outcome === "win" || r.outcome === "loss");
    const wins = done.filter((r) => r.outcome === "win").length;
    return { n: set.length, wins, losses: done.length - wins, hit: done.length ? wins / done.length : 0 };
  };
  return {
    primary: by("primary"),
    secondary: by("secondary"),
    override: by("override"),
    missed: week.filter((r) => r.outcome === "missed_2r").length,
    woulds: week.filter((r) => r.wouldHaveBeen).length,
    trades: week.filter((r) => r.verdict !== "STAND_ASIDE").length,
  };
}

export function rMultipleOf(row: AuditRow, mark: number): number | null {
  if (row.entryPx == null || row.stopPx == null || !row.side) return null;
  const risk = Math.abs(row.entryPx - row.stopPx);
  if (risk <= 0) return null;
  return row.side === "long" ? (mark - row.entryPx) / risk : (row.entryPx - mark) / risk;
}

export function isMissed2R(row: AuditRow, mark: number): boolean {
  if (row.verdict !== "STAND_ASIDE" || (row.outcome !== "open" && row.outcome !== "missed_2r")) return false;
  const live = rMultipleOf(row, mark);
  return live != null && live >= 2;
}
