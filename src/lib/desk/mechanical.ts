import type { Analysis, CheckItem, RiskBook, Tape } from "./types";
import { G } from "./format";
import { clockAt } from "./session";
import { closedBars, describeStruct, lastFvg, lastOb, londonDay, scanRaid, sessionLevels, structureOf, zoneReachable } from "./ict";
import {
  DEFAULT_RISK,
  confirmNeedFor,
  decide,
  displayClock,
  fourHClear,
  formatSignal,
  liveStatus,
  oneMinuteHint,
} from "./regime";

function check(id: string, label: string, pass: boolean): CheckItem {
  return { id, label, pass };
}

export function blankAnalysis(pair: string): Analysis {
  const missingPriorityText = "Waiting for tape";
  const base: Analysis = {
    pair,
    priceRead: "—",
    bias4h: "unclear",
    drawOnLiquidity: "—",
    structure1h: "—",
    structure15m: "—",
    structure1m: "—",
    liquiditySweep: { occurred: false, notes: "" },
    mss: { occurred: false, notes: "" },
    fvg: { occurred: false, notes: "" },
    displacement: { occurred: false, notes: "" },
    killzone: { aligned: false, session: "—" },
    premiumDiscount: "—",
    verdict: "STAND_ASIDE",
    confidence: 24,
    entry: "—",
    stopLoss: "—",
    takeProfit1: "—",
    takeProfit2: "—",
    riskReward: "—",
    checklist: [],
    missing: [missingPriorityText],
    narrative: "",
    invalidation: "No setup to invalidate",
    source: "mechanical",
    model: "kz-v2",
    window: "dead",
    regime: "range",
    size: "none",
    riskPct: "0",
    sequence: "—",
    signalBlock: "",
    missingPriority: missingPriorityText,
    wouldHaveBeen: false,
    overrideReady: false,
    confirms: [],
    closedAt: 0,
  };
  return { ...base, signalBlock: formatSignal(base) };
}

export function mechanicalRead(
  tape: Tape,
  pair: string,
  book: RiskBook = DEFAULT_RISK,
  notes = "",
  openRisk = 0,
): Analysis {
  const clock = clockAt();
  const m15 = closedBars(tape.candles);
  const s15 = structureOf(m15);
  const s1 = structureOf(tape.h1?.length ? tape.h1 : m15);
  const s4 = structureOf(tape.h4?.length ? tape.h4 : m15);
  const bias4h = s4?.bias ?? "unclear";
  const bias1h = s1?.bias ?? "unclear";
  const raid = scanRaid(tape.candles, bias4h);
  const levels = sessionLevels(tape.candles);
  const day = londonDay(tape.candles);
  const fvg = lastFvg(tape.candles);
  const ob = lastOb(tape.candles);
  const fourHAgrees = !!(raid?.sweep && ((raid.sweep === "bullish" && bias4h === "bullish") || (raid.sweep === "bearish" && bias4h === "bearish")));
  const sweepHint = raid?.reclaimed || (raid?.fadeDay && !fourHAgrees) ? null : (raid?.sweep ?? null);
  const zone =
    fvg && sweepHint && fvg.kind === sweepHint
      ? fvg
      : ob && sweepHint && ob.kind === sweepHint
        ? ob
        : fvg;
  const d = decide({
    pair,
    clock,
    bias4h,
    raid,
    zone: zone && sweepHint && zone.kind === sweepHint ? zone : null,
    tape,
    notes,
    book,
    openRisk,
  });
  const {
    window,
    size,
    riskPct,
    verdict: decidedVerdict,
    overrideReady,
    fourOk,
    confirms: confirmList,
    missingPriority: miss,
    wouldHaveBeen,
    sequence,
    regime,
    sweep,
  } = d;
  let verdict = decidedVerdict;
  const fvgOk = !!(zone && sweep && zone.kind === sweep && zoneReachable(zone, tape.mark || tape.last));
  const displaced = !!raid?.displacement;
  const status = liveStatus({
    clock,
    regime,
    overrideReady,
    window,
    verdict,
    missingPriority: miss,
  });

  const magnet = [...tape.clusters].sort((a, b) => b.notional - a.notional)[0];
  const dol: string[] = [];
  if (levels.asiaHigh != null && levels.asiaLow != null) {
    dol.push(`Asia ${G(levels.asiaLow)}–${G(levels.asiaHigh)}`);
  }
  if (day.bias === "bullish" || day.bias === "bearish") dol.push(day.reason);
  else if (sweep === "bullish") dol.push(levels.asiaHigh ? `draw Asia high ${G(levels.asiaHigh)}` : "draw highs");
  else if (sweep === "bearish") dol.push(levels.asiaLow ? `draw Asia low ${G(levels.asiaLow)}` : "draw lows");
  if (magnet) dol.push(`${magnet.kind} ~${G(magnet.px)}`);
  const drawOnLiquidity = dol.join(" · ") || "—";

  const missing: string[] = [];
  const spentMove = !!(raid?.extended && (raid.ageBars ?? 0) >= 8);
  if (clock.inAsia && window === "map" && !overrideReady) missing.push("Asia grind + Override conditions incomplete");
  if (clock.session === "PRELONDON" && !overrideReady) missing.push("Wait for London to raid the mapped Asia range");
  if (raid?.fadeDay && !fourHClear(bias4h, raid.sweep)) missing.push("That sweep fades the London day — Asia high/low already taken is the TARGET, not a reverse");
  if (spentMove) missing.push("Move already spent — wait for a fresh raid");
  if (raid?.reclaimed) missing.push("Swept level was reclaimed — short/long is dead, do not fade the pump");
  if (!sweep && !raid?.fadeDay && !raid?.reclaimed && !spentMove) {
    missing.push("No raid of Asia high/low or PDH/PDL from inside the range");
  }
  if (sweep && !raid?.timeBased) missing.push("Sweep is a random 15m swing, not Asia / PDH-PDL");
  if (sweep && !raid?.displacement) missing.push("no displacement (< 1.2× ATR)");
  if (sweep && !raid?.mss) missing.push("no MSS");
  if (bias4h === "unclear") missing.push("4H bias unclear");
  if (sweep && bias4h !== "unclear" && !fourHClear(bias4h, sweep)) missing.push("4H fights 15M direction");
  if (raid?.extended && !fvgOk) missing.push("Move already spent — wait for FVG pullback");
  if (sweep && !fvgOk) missing.push("Waiting for the first 15M FVG of the displacement");
  if (overrideReady && size === "none") missing.push("Override ready but two half-size trades already open, or open risk ≥ 3%");
  if (miss && !missing.includes(miss)) missing.unshift(miss);

  const stale = !!(raid && raid.ageBars > 8);
  if (stale && sweep && !fvgOk) missing.push("Raid is >2h old — wait for the 15m FVG, do not market-in");

  let confidence = 24;
  if (verdict === "LONG" || verdict === "SHORT") {
    confidence = size === "full" ? 62 : 52;
    if (window === "primary") confidence += 8;
    if (window === "override") confidence += 6;
    if (clock.session === "LONDON") confidence += 6;
    if (day.bias && fourOk) confidence += 6;
    if (confirmList.length >= 2) confidence += 4;
    if (raid?.timeBased) confidence += 2;
    if (raid?.extended) confidence -= 8;
    if (stale) confidence -= 6;
    confidence = Math.min(84, Math.max(44, confidence));
  } else if (wouldHaveBeen) {
    confidence = 36;
  }

  const mark = tape.mark || tape.last;
  const atr = raid?.atr || mark * 0.008;
  const swept = raid?.sweepLevel ?? mark;
  let entry = "—";
  let stopLoss = "—";
  let tp1 = "—";
  let tp2 = "—";
  let rr = "—";

  if ((verdict === "LONG" || (wouldHaveBeen && sweep === "bullish")) && raid) {
    const stop = Math.min(swept, raid.lastClose) - atr * 0.15;
    if (verdict === "LONG" && mark <= stop) {
      verdict = "STAND_ASIDE";
      missing.unshift("Price already through the long stop");
    } else {
      const mid = zone && zone.kind === "bullish" ? (zone.low + zone.high) / 2 : null;
      const e = mid ?? (raid.extended || fvgOk ? (swept + mark) / 2 : mark);
      const risk = Math.max(e - stop, mark * 0.003);
      entry = zone && zone.kind === "bullish" ? `limit at ${G(zone.low)}–${G(zone.high)} (50% ${G((zone.low + zone.high) / 2)})` : `limit / market at ${G(e)}`;
      stopLoss = `beyond sweep extreme ${G(stop)}`;
      tp1 = G(levels.asiaHigh && mark < levels.asiaHigh ? levels.asiaHigh : e + risk * 2);
      tp2 = G(levels.pdh && levels.pdh > mark ? levels.pdh : e + risk * 3);
      rr = "1:2";
    }
  } else if ((verdict === "SHORT" || (wouldHaveBeen && sweep === "bearish")) && raid) {
    const stop = Math.max(swept, raid.lastClose) + atr * 0.15;
    if (verdict === "SHORT" && mark >= stop) {
      verdict = "STAND_ASIDE";
      missing.unshift("Price already through the short stop — the pump invalidated it");
    } else {
      const mid = zone && zone.kind === "bearish" ? (zone.low + zone.high) / 2 : null;
      const e = mid ?? (raid.extended || fvgOk ? (swept + mark) / 2 : mark);
      const risk = Math.max(stop - e, mark * 0.003);
      entry = zone && zone.kind === "bearish" ? `limit at ${G(zone.low)}–${G(zone.high)} (50% ${G((zone.low + zone.high) / 2)})` : `limit / market at ${G(e)}`;
      stopLoss = `beyond sweep extreme ${G(stop)}`;
      tp1 = G(levels.asiaLow && mark > levels.asiaLow ? levels.asiaLow : e - risk * 2);
      tp2 = G(levels.pdl && levels.pdl < mark ? levels.pdl : e - risk * 3);
      rr = "1:2";
    }
  }

  if (verdict === "STAND_ASIDE") {
    // size/risk collapse if we invalidated after pricing
  }
  const liveSize = verdict === "STAND_ASIDE" ? "none" : size;
  const liveRisk = verdict === "STAND_ASIDE" ? 0 : riskPct;

  const mapping = window === "map";
  const narrative = [
    mapping && !overrideReady
      ? `Asia session on ${pair}. Mark Asia H/L (${levels.asiaLow ? G(levels.asiaLow) : "—"}–${levels.asiaHigh ? G(levels.asiaHigh) : "—"}). Movement is small by design — do not trade the grind. London open raids this range.`
      : `Live ${tape.venue} 15m on ${pair} at ${G(mark)}. 4H ${bias4h}, 1H ${bias1h}. ${day.reason}`,
    mapping && !overrideReady ? "" : raid?.notes.filter((n) => n !== day.reason).join(". ") || "",
    regime.trending ? `Trending regime: ${regime.reasons[0]}.` : "Range regime — primary KZ only.",
    confirmList.length ? `Confirms: ${confirmList.join("; ")}.` : "",
    `${status.line}. ${clock.sessionLabel}.`,
    verdict === "LONG" || verdict === "SHORT"
      ? raid?.extended
        ? "Do not chase the close. Limit into the 15m FVG; stop beyond the raid extreme."
        : window === "override"
          ? "Override: clock is not a veto. Half-size limit at 50% of the 15M FVG."
          : "Enter the first FVG of the displacement, not the wick."
      : wouldHaveBeen
        ? `Would-have-been ${sweep} — ${miss}. Logged for opportunity-cost.`
        : miss,
  ]
    .filter(Boolean)
    .join(" ");

  const invalidation =
    sweep === "bullish"
      ? `15m close back below swept ${raid?.sweepName ?? "level"} ${raid?.sweepLevel != null ? G(raid.sweepLevel) : ""} with force`
      : sweep === "bearish"
        ? `15m close back above swept ${raid?.sweepName ?? "level"} ${raid?.sweepLevel != null ? G(raid.sweepLevel) : ""} with force`
        : day.bias === "bullish"
          ? "15m close back below the London expansion / Asia high that set the day"
          : day.bias === "bearish"
            ? "15m close back above the London expansion / Asia low that set the day"
            : "No setup to invalidate";

  const kzAligned = window === "primary" || window === "secondary" || window === "override";

  const analysis: Analysis = {
    pair,
    priceRead: G(mark),
    bias4h,
    drawOnLiquidity,
    structure1h: describeStruct("1H", s1),
    structure15m: describeStruct("15M", s15),
    structure1m: sweep ? oneMinuteHint(tape, sweep) : "1M optional — 15m FVG of the London displacement is enough.",
    liquiditySweep: {
      occurred: !!(raid?.sweep && !raid.fadeDay),
      level: raid?.sweepLevel == null ? undefined : G(raid.sweepLevel),
      notes: raid?.notes[0] ?? "No sweep",
    },
    mss: {
      occurred: !!(raid?.mss && !raid.fadeDay && !raid.reclaimed),
      timeframe: raid?.mss && !raid.fadeDay ? "15M" : "none",
      notes: raid?.mss && !raid.fadeDay ? "Close back through the swept level" : "No valid MSS",
    },
    fvg: {
      occurred: fvgOk,
      level: zone ? `${G(zone.low)}–${G(zone.high)}` : undefined,
      notes: zone ? `${zone.kind} 15m ${fvg && fvg.kind === zone.kind ? "FVG" : "order block"} — this is the entry, not the close` : "No fresh 15m FVG",
    },
    displacement: {
      occurred: displaced && !raid?.fadeDay,
      notes: raid?.notes.find((n) => n.startsWith("Displacement")) ?? "no displacement (< 1.2× ATR)",
    },
    killzone: { aligned: kzAligned, session: displayClock(clock, window) },
    premiumDiscount: s4 ? (s4.inDiscount ? "Discount on 4H range" : "Premium on 4H range") : "—",
    verdict,
    confidence,
    entry: verdict === "STAND_ASIDE" && !wouldHaveBeen ? "—" : entry,
    stopLoss: verdict === "STAND_ASIDE" && !wouldHaveBeen ? "—" : stopLoss,
    takeProfit1: verdict === "STAND_ASIDE" && !wouldHaveBeen ? "—" : tp1,
    takeProfit2: verdict === "STAND_ASIDE" && !wouldHaveBeen ? "—" : tp2,
    riskReward: verdict === "STAND_ASIDE" && !wouldHaveBeen ? "—" : rr,
    checklist: [
      check("bias", "4H bias clear and with this side", fourOk),
      check("kz", "Primary KZ, secondary window, or Override", kzAligned),
      check("sweep", "Raid of Asia H/L / PDH-PDL from inside the range", !!(raid?.timeBased && !raid.fadeDay && !raid.reclaimed)),
      check("mss", "15M displacement ≥1.2×ATR + MSS", !!(raid?.displacement && raid.mss && !raid.fadeDay)),
      check("fvg", "15M FVG (or OB) still open for limit entry", fvgOk),
      check("confirms", `OI / CVD / heatmap / RS (${confirmNeedFor(sweep, tape.h4)} needed for Override)`, confirmList.length >= confirmNeedFor(sweep, tape.h4) || window === "primary"),
      check("rr", "Minimum 1:2 RR and stop still valid", verdict !== "STAND_ASIDE"),
      check("tape", "Not fading London day / not a reclaimed level", !(raid?.fadeDay || raid?.reclaimed)),
      check("knife", "Not longing a selloff / dump in 4H premium", !(raid?.asiaDump || raid?.weakBounce)),
    ],
    missing: mapping && !overrideReady ? missing.slice(0, 2) : missing,
    narrative,
    invalidation,
    source: "mechanical",
    model: "kz-v2",
    window,
    regime: regime.trending ? "trending" : "range",
    size: liveSize,
    riskPct: liveRisk ? liveRisk.toFixed(2) : "0",
    sequence,
    signalBlock: "",
    missingPriority: verdict === "STAND_ASIDE" ? miss : "",
    wouldHaveBeen,
    overrideReady,
    confirms: confirmList,
    closedAt: raid?.closedAt ?? tape.at,
  };
  analysis.signalBlock = formatSignal(analysis);
  return analysis;
}

export function mergeGrok(mech: Analysis, grok: Analysis): Analysis {
  const invented = grok.verdict !== "STAND_ASIDE" && mech.verdict === "STAND_ASIDE";
  if (invented) {
    const next: Analysis = {
      ...mech,
      narrative: `${mech.narrative} Grok wanted ${grok.verdict} — rejected, sequence or window incomplete.`,
      source: grok.source,
      model: grok.model,
    };
    next.signalBlock = formatSignal(next);
    return next;
  }
  if (grok.verdict === "STAND_ASIDE" && mech.verdict !== "STAND_ASIDE") {
    const next: Analysis = {
      ...mech,
      verdict: "STAND_ASIDE",
      size: "none",
      riskPct: "0",
      missingPriority: grok.missing[0] || mech.missingPriority || "Grok stood aside",
      missing: grok.missing.length ? grok.missing : mech.missing,
      narrative: grok.narrative || mech.narrative,
      source: grok.source,
      model: grok.model,
      confidence: Math.min(mech.confidence, grok.confidence),
    };
    next.signalBlock = formatSignal(next);
    return next;
  }
  const next: Analysis = {
    ...mech,
    structure1h: grok.structure1h || mech.structure1h,
    structure15m: grok.structure15m || mech.structure15m,
    structure1m: grok.structure1m || mech.structure1m,
    drawOnLiquidity: grok.drawOnLiquidity || mech.drawOnLiquidity,
    narrative: grok.narrative || mech.narrative,
    confidence: Math.max(mech.confidence, Math.min(grok.confidence, 88)),
    source: grok.source,
    model: grok.model,
  };
  next.signalBlock = formatSignal(next);
  return next;
}

export function tapePrompt(tape: Tape) {
  const clusters = tape.clusters
    .slice(0, 6)
    .map((c) => `${c.kind} ${c.px.toPrecision(4)}`)
    .join("; ");
  const dom = [
    tape.bidWall ? `bid wall ${tape.bidWall.px.toPrecision(5)}` : "",
    tape.askWall ? `ask wall ${tape.askWall.px.toPrecision(5)}` : "",
    tape.imbalance == null ? "" : `book ${tape.imbalance.toFixed(0)}% bids`,
  ]
    .filter(Boolean)
    .join(" | ");
  return [
    `LIVE DERIVATIVES TAPE (${tape.venue} perp, snapshot at analysis)`,
    `${tape.symbol} mark ${tape.mark} (${tape.changePct >= 0 ? "+" : ""}${tape.changePct.toFixed(2)}% 24h) range ${tape.low24}–${tape.high24}`,
    `Funding ${(tape.funding * 100).toFixed(4)}% / 8h | OI $${Math.round(tape.oiUsd).toLocaleString("en-US")} (Δ ${tape.oiDeltaPct.toFixed(1)}%) | Vol ${tape.volRatio.toFixed(2)}× | Taker buy ${tape.takerBuyPct.toFixed(1)}% | CVD ${tape.cvd >= 0 ? "rising" : "falling"}`,
    `BTC ${tape.btcChangePct >= 0 ? "+" : ""}${tape.btcChangePct.toFixed(2)}% · 4H ${tape.btcBias4h} · RS ${tape.relStrength}`,
    `Liq longs $${Math.round(tape.liqLongNotional).toLocaleString("en-US")} / shorts $${Math.round(tape.liqShortNotional).toLocaleString("en-US")}`,
    dom ? `DOM: ${dom}` : "",
    `Liquidity clusters: ${clusters || "none"}`,
    `Tape read: ${tape.read}`,
    "Book walls and HVNs are magnets / liquidity. They do not replace a London Asia raid. Do not fade a bullish day into an ask wall.",
    "v2 Override: clock is not a veto when 4H is clear, Sweep→MSS→FVG is complete, and two of OI/CVD/heatmap/RS confirm. Half-size only.",
  ]
    .filter(Boolean)
    .join("\n");
}
