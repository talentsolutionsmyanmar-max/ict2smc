import type { Bias, Candle, Fvg, LondonDay, RaidScan, RangeStruct, SessionLevels } from "./types";
import { G } from "./format";
import { nyParts, previousDayKey } from "./session";

function hl(bars: Candle[]) {
  if (!bars.length) return null;
  return {
    high: Math.max(...bars.map((c) => c.high)),
    low: Math.min(...bars.map((c) => c.low)),
  };
}

export function sessionLevels(candles: Candle[], now = Date.now()): SessionLevels {
  const n = nyParts(now);
  const prev = previousDayKey(n.dayKey);
  const asiaDay = n.minutes >= 1200 ? n.dayKey : prev;
  const priorAsiaDay = previousDayKey(asiaDay);
  const tagged = candles.map((c) => ({ c, p: nyParts(c.t) }));
  const asia = tagged.filter((x) => x.p.dayKey === asiaDay && x.p.minutes >= 1200).map((x) => x.c);
  const priorAsia = tagged.filter((x) => x.p.dayKey === priorAsiaDay && x.p.minutes >= 1200).map((x) => x.c);
  const prevDay = tagged.filter((x) => x.p.dayKey === prev).map((x) => x.c);
  const london = tagged
    .filter((x) => x.p.dayKey === n.dayKey && x.p.minutes >= 120 && x.p.minutes < 300)
    .map((x) => x.c);
  const a = hl(asia);
  const pa = hl(priorAsia);
  const p = hl(prevDay);
  const l = hl(london);
  const last = candles[candles.length - 1];
  const asiaComplete = n.minutes >= 0 && n.minutes < 1200;
  return {
    asiaHigh: a?.high ?? null,
    asiaLow: a?.low ?? null,
    asiaComplete,
    asiaSweepable: asiaComplete || asiaPaused(asia),
    priorAsiaHigh: pa?.high ?? null,
    priorAsiaLow: pa?.low ?? null,
    pdh: p?.high ?? null,
    pdl: p?.low ?? null,
    londonHigh: l?.high ?? null,
    londonLow: l?.low ?? null,
    mark: last?.close ?? 0,
  };
}

export function asiaCharacter(candles: Candle[], now = Date.now()): {
  kind: "mapping" | "range" | "selloff" | "buyout";
  high: number | null;
  low: number | null;
  range: number;
  closePos: number;
} {
  const n = nyParts(now);
  const prev = previousDayKey(n.dayKey);
  const asiaDay = n.minutes >= 1200 ? n.dayKey : prev;
  const asia = candles.filter((c) => {
    const p = nyParts(c.t);
    return p.dayKey === asiaDay && p.minutes >= 1200;
  });
  const a = hl(asia);
  if (!a || asia.length < 4) {
    return { kind: "mapping", high: a?.high ?? null, low: a?.low ?? null, range: 0, closePos: 0.5 };
  }
  const range = a.high - a.low;
  const last = asia[asia.length - 1].close;
  const closePos = range > 0 ? (last - a.low) / range : 0.5;
  const atr = atr14(closedBars(candles));
  const expanded = atr > 0 && range >= 3 * atr;
  const reds = asia.filter((c) => c.close < c.open).length;
  const greens = asia.filter((c) => c.close >= c.open).length;
  if (expanded && closePos <= 0.28 && reds >= greens) {
    return { kind: "selloff", high: a.high, low: a.low, range, closePos };
  }
  if (expanded && closePos >= 0.72 && greens >= reds) {
    return { kind: "buyout", high: a.high, low: a.low, range, closePos };
  }
  return { kind: "range", high: a.high, low: a.low, range, closePos };
}

export function namedLevels(levels: SessionLevels) {
  const out: { name: string; px: number; kind: "high" | "low" }[] = [];
  if (levels.asiaSweepable) {
    if (levels.asiaHigh != null) out.push({ name: "Asia high", px: levels.asiaHigh, kind: "high" });
    if (levels.asiaLow != null) out.push({ name: "Asia low", px: levels.asiaLow, kind: "low" });
  } else {
    if (levels.priorAsiaHigh != null) out.push({ name: "Prior Asia high", px: levels.priorAsiaHigh, kind: "high" });
    if (levels.priorAsiaLow != null) out.push({ name: "Prior Asia low", px: levels.priorAsiaLow, kind: "low" });
  }
  if (levels.pdh != null) out.push({ name: "PDH", px: levels.pdh, kind: "high" });
  if (levels.pdl != null) out.push({ name: "PDL", px: levels.pdl, kind: "low" });
  if (levels.londonHigh != null) out.push({ name: "London high", px: levels.londonHigh, kind: "high" });
  if (levels.londonLow != null) out.push({ name: "London low", px: levels.londonLow, kind: "low" });
  return out;
}

export function londonDay(candles: Candle[], now = Date.now()): LondonDay {
  const levels = sessionLevels(candles, now);
  const n = nyParts(now);
  const raidHigh = levels.asiaComplete ? levels.asiaHigh : levels.priorAsiaHigh;
  const raidLow = levels.asiaComplete ? levels.asiaLow : levels.priorAsiaLow;
  const londonBars = candles
    .map((c) => ({ c, p: nyParts(c.t) }))
    .filter((x) => x.p.dayKey === n.dayKey && x.p.minutes >= 120 && x.p.minutes < 300);
  let brokenHigh = false;
  let brokenLow = false;
  let bias: LondonDay["bias"] = null;
  let reason = "London has not taken Asia yet";
  const asiaReg = asiaCharacter(candles, now);
  for (const { c } of londonBars) {
    if (raidHigh != null && c.close > raidHigh) {
      brokenHigh = true;
      if (!bias) {
        bias = "bullish";
        reason = `London closed through Asia high ${raidHigh.toPrecision(5)} — that high is DOL, not a short`;
      }
    }
    if (raidLow != null && c.close < raidLow) {
      brokenLow = true;
      if (!bias) {
        bias = "bearish";
        reason = `London closed through Asia low ${raidLow.toPrecision(5)} — that low is DOL, not a long`;
      }
    }
    if (!bias && raidLow != null && c.low < raidLow && c.close > raidLow && asiaReg.kind !== "selloff") {
      bias = "bullish";
      reason = `London raided Asia low ${raidLow.toPrecision(5)} — day is long, Asia high is the draw`;
    }
    if (!bias && raidHigh != null && c.high > raidHigh && c.close < raidHigh && asiaReg.kind !== "buyout") {
      bias = "bearish";
      reason = `London raided Asia high ${raidHigh.toPrecision(5)} — day is short, Asia low is the draw`;
    }
  }
  return { bias, reason, brokenHigh, brokenLow };
}

function wasOutside(candles: Candle[], idx: number, px: number, kind: "high" | "low") {
  const slice = candles.slice(Math.max(0, idx - 8), idx);
  if (slice.length < 3) return true;
  const above = slice.filter((c) => c.close > px).length;
  const below = slice.filter((c) => c.close < px).length;
  return kind === "high" ? below >= above : above >= below;
}

export const ATR_PERIOD = 14;
export const ATR_GATE = 1.2;

export function closedBars(candles: Candle[]) {
  if (candles.length < 2) return candles;
  const last = candles[candles.length - 1];
  return Date.now() - last.t < 840000 ? candles.slice(0, -1) : candles;
}

function atr14(candles: Candle[]) {
  const ranges: number[] = [];
  const start = Math.max(1, candles.length - ATR_PERIOD);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
}

/** Displacement = true only if impulse candle range ≥ 1.2 × 14-period 15M ATR. */
export function isDisplacement(impulseRange: number, atr: number): boolean {
  return atr > 0 && impulseRange >= ATR_GATE * atr;
}

/** Color-aware: green close back above a low sweep, red close back below a high sweep. */
export function isDisplacementCandle(opts: {
  impulse: Candle;
  atr: number;
  dir: "bullish" | "bearish";
  sweptPx: number;
}): boolean {
  const range = opts.impulse.high - opts.impulse.low;
  if (!isDisplacement(range, opts.atr)) return false;
  if (opts.dir === "bullish") {
    return opts.impulse.close >= opts.impulse.open && opts.impulse.close > opts.sweptPx;
  }
  return opts.impulse.close < opts.impulse.open && opts.impulse.close < opts.sweptPx;
}

export function isLiveReclaimed(dir: "bullish" | "bearish", sweptPx: number, liveClose: number): boolean {
  if (dir === "bearish") return liveClose > sweptPx;
  return liveClose < sweptPx;
}

function asiaPaused(asia: Candle[]): boolean {
  const closed = closedBars(asia);
  if (closed.length < 6) return false;
  const recent = closed.slice(-4);
  const prior = closed.slice(0, -4);
  if (!prior.length) return false;
  const priorH = Math.max(...prior.map((c) => c.high));
  const priorL = Math.min(...prior.map((c) => c.low));
  return !recent.some((c) => c.high > priorH || c.low < priorL);
}

function emptyScan(
  last: Candle,
  atr: number,
  dayBias: LondonDay["bias"],
  dayReason: string,
  extra: string,
): RaidScan {
  return {
    score: 0,
    sweep: null,
    sweepLevel: null,
    sweepName: null,
    timeBased: false,
    displacement: false,
    atrMult: 0,
    mss: false,
    atr,
    lastRange: last.high - last.low,
    lastClose: last.close,
    closedAt: last.t,
    ageBars: 0,
    extended: false,
    reclaimed: false,
    fadeDay: false,
    dayBias,
    dayReason,
    notes: [extra, dayReason].filter(Boolean),
    impulseDir: null,
  };
}

export function scanRaid(candles: Candle[], bias4h: Bias = "unclear"): RaidScan | null {
  const bars = closedBars(candles);
  if (bars.length < 20) return null;
  const last = bars[bars.length - 1];
  const live = candles[candles.length - 1] ?? last;
  const atr = atr14(bars);
  const day = londonDay(bars);
  const look = bars.slice(-24);
  const recent = bars.slice(-6);
  const prior = bars.slice(0, -6);
  const swingHigh = Math.max(...prior.slice(-16).map((c) => c.high), recent[0]?.high ?? last.high);
  const swingLow = Math.min(...prior.slice(-16).map((c) => c.low), recent[0]?.low ?? last.low);
  const levels = sessionLevels(bars);
  const lastNy = nyParts(last.t);
  const londonDone = lastNy.minutes >= 300 && lastNy.minutes < 1200;
  const pool = namedLevels(levels).filter((l) => !l.name.startsWith("London") || londonDone);

  type Hit = {
    dir: "bullish" | "bearish";
    name: string;
    px: number;
    bar: Candle;
    age: number;
    timeBased: boolean;
    idx: number;
  };
  const hits: Hit[] = [];

  look.forEach((bar, i) => {
    const idx = bars.findIndex((c) => c.t === bar.t);
    const age = look.length - 1 - i;
    for (const lvl of pool) {
      if (lvl.kind === "low" && bar.low < lvl.px && bar.close > lvl.px && wasOutside(bars, idx, lvl.px, "low")) {
        hits.push({ dir: "bullish", name: lvl.name, px: lvl.px, bar, age, timeBased: true, idx });
      }
      if (lvl.kind === "high" && bar.high > lvl.px && bar.close < lvl.px && wasOutside(bars, idx, lvl.px, "high")) {
        hits.push({ dir: "bearish", name: lvl.name, px: lvl.px, bar, age, timeBased: true, idx });
      }
    }
  });

  recent.forEach((bar, i) => {
    const idx = bars.findIndex((c) => c.t === bar.t);
    const age = recent.length - 1 - i;
    if (bar.low < swingLow && bar.close > swingLow) {
      hits.push({ dir: "bullish", name: "15m swing low", px: swingLow, bar, age, timeBased: false, idx });
    }
    if (bar.high > swingHigh && bar.close < swingHigh) {
      hits.push({ dir: "bearish", name: "15m swing high", px: swingHigh, bar, age, timeBased: false, idx });
    }
  });

  hits.sort((a, b) => {
    const a4 = bias4h !== "unclear" && a.dir === bias4h;
    const b4 = bias4h !== "unclear" && b.dir === bias4h;
    if (a4 !== b4) return a4 ? -1 : 1;
    if (a.timeBased !== b.timeBased) return a.timeBased ? -1 : 1;
    if (a.age !== b.age) return a.age - b.age;
    const rank = (n: string) => (n.startsWith("Asia") ? 0 : n.startsWith("PD") ? 1 : 2);
    return rank(a.name) - rank(b.name);
  });

  const hit =
    hits.filter((h) => {
      if (bias4h !== "unclear" && h.dir === bias4h) return true;
      if (!day.bias || !h.timeBased) return true;
      if (day.bias === "bullish" && h.dir === "bearish" && (h.name === "Asia high" || h.name === "PDH")) return false;
      if (day.bias === "bearish" && h.dir === "bullish" && (h.name === "Asia low" || h.name === "PDL")) return false;
      return true;
    })[0] ?? null;

  if (!hit) {
    return emptyScan(
      last,
      atr,
      day.bias,
      day.reason,
      !levels.asiaSweepable
        ? "Asia range still mapping — no sweep on current extremes"
        : day.bias
          ? `No fresh raid with the London day (${day.bias}). Opposing Asia level is the target, not a reverse.`
          : "No Asia / PDH-PDL raid from inside the range",
    );
  }

  const idx = hit.idx >= 0 ? hit.idx : bars.length - 1;
  const impulseBars = bars.slice(idx, Math.min(bars.length, idx + 3));
  const matching = impulseBars.filter((c) =>
    isDisplacementCandle({ impulse: c, atr, dir: hit.dir, sweptPx: hit.px }),
  );
  const impulseCandle =
    matching.sort((a, b) => b.high - b.low - (a.high - a.low))[0] ??
    impulseBars.reduce((a, b) => (b.high - b.low > a.high - a.low ? b : a), impulseBars[0] ?? last);
  const lastRange = impulseCandle.high - impulseCandle.low;
  const atrMult = atr > 0 ? lastRange / atr : 0;
  const impulseDir: "bullish" | "bearish" = impulseCandle.close >= impulseCandle.open ? "bullish" : "bearish";
  const displacement = matching.length > 0;
  const oppositeImpulse = isDisplacement(lastRange, atr) && impulseDir !== hit.dir;
  const after = bars.slice(idx + 1);
  const mss = hit.dir === "bullish" ? after.some((c) => c.close > hit.px) : after.some((c) => c.close < hit.px);
  const entry = hit.dir === "bullish" ? Math.max(hit.px, hit.bar.close) : Math.min(hit.px, hit.bar.close);
  const stop = hit.dir === "bullish" ? hit.bar.low - atr * 0.1 : hit.bar.high + atr * 0.1;
  const risk = Math.abs(entry - stop) || atr;
  const extended = (hit.dir === "bullish" ? last.close - entry : entry - last.close) > 1.8 * risk;
  const asiaReg = asiaCharacter(candles);
  const asiaDump = !!(
    asiaReg.kind === "selloff" &&
    hit.dir === "bullish" &&
    hit.name.toLowerCase().includes("asia")
  );
  const asiaRip = !!(
    asiaReg.kind === "buyout" &&
    hit.dir === "bearish" &&
    hit.name.toLowerCase().includes("asia")
  );
  const weakBounce = asiaReg.range > 0 && lastRange < asiaReg.range * 0.35;
  const liveClose = live.close;
  const reclaimed =
    oppositeImpulse ||
    isLiveReclaimed(hit.dir, hit.px, last.close) ||
    isLiveReclaimed(hit.dir, hit.px, liveClose);
  const fadeDay = !!(
    day.bias &&
    ((day.bias === "bullish" && hit.dir === "bearish") || (day.bias === "bearish" && hit.dir === "bullish"))
  );

  const notes: string[] = [];
  let score = 0;
  if (hit.timeBased) score += 3;
  else score += 1;
  notes.push(
    `${hit.dir === "bullish" ? "Bullish" : "Bearish"} sweep of ${hit.name} ${hit.px.toPrecision(5)}${hit.age ? ` · ${hit.age * 15}m ago` : ""}`,
  );
  if (displacement) {
    score += 1;
    notes.push(`Displacement ${atrMult.toFixed(2)}×ATR (need ≥1.2) ${impulseDir}`);
  } else if (oppositeImpulse) {
    notes.push(`Impulse ${atrMult.toFixed(2)}×ATR is ${impulseDir} — opposite the ${hit.dir} sweep (reclaim, not displacement)`);
  } else {
    notes.push(`Displacement ${atrMult.toFixed(2)}×ATR — blocked (< 1.2)`);
  }
  if (mss) {
    score += 1;
    notes.push("MSS — close back through the swept level");
  }
  if (day.bias) notes.push(day.reason);
  if (fadeDay) {
    score = Math.min(score, 1);
    notes.push(`Fading the London day (${day.bias}) — not allowed at NY. Stand aside or wait for HTF MSS.`);
  }
  if (reclaimed) {
    score = Math.min(score, 1);
    notes.push("Swept level already reclaimed — setup is dead");
  }
  if (extended) notes.push("Move already spent — wait for FVG pullback, do not chase");
  if (asiaDump) {
    score = Math.min(score, 1);
    notes.push("Asia was a selloff, not a range — sweeping that low is continuation, not a long");
  }
  if (asiaRip) {
    score = Math.min(score, 1);
    notes.push("Asia was a buyout, not a range — sweeping that high is continuation, not a short");
  }
  if (weakBounce) {
    score = Math.min(score, 1);
    notes.push("Bounce is too small vs the Asia expansion — not a raid");
  }

  return {
    score,
    sweep: hit.dir,
    sweepLevel: hit.px,
    sweepName: hit.name,
    timeBased: hit.timeBased,
    displacement,
    mss,
    atr,
    lastRange,
    atrMult,
    lastClose: last.close,
    closedAt: last.t,
    ageBars: hit.age,
    extended,
    reclaimed,
    fadeDay,
    dayBias: day.bias,
    dayReason: day.reason,
    notes,
    impulseDir,
    asiaDump: asiaDump || asiaRip,
    weakBounce,
  };
}

export function barTape(candles: Candle[], n = 40) {
  return candles
    .slice(-n)
    .map((c) => `${c.t} o${G(c.open)} h${G(c.high)} l${G(c.low)} c${G(c.close)}`)
    .join("\n");
}

export function structureOf(candles: Candle[]): RangeStruct | null {
  if (candles.length < 8) return null;
  const t = candles.slice(-24);
  const high = Math.max(...t.map((c) => c.high));
  const low = Math.min(...t.map((c) => c.low));
  const last = t[t.length - 1].close;
  const mid = (high + low) / 2;
  const first = t.slice(0, Math.floor(t.length / 2));
  const second = t.slice(Math.floor(t.length / 2));
  const cH = Math.max(...first.map((c) => c.high));
  const cL = Math.min(...first.map((c) => c.low));
  const nH = Math.max(...second.map((c) => c.high));
  const nL = Math.min(...second.map((c) => c.low));
  let bias: RangeStruct["bias"] = "unclear";
  if (nH > cH && nL >= cL * 0.998) bias = "bullish";
  else if (nL < cL && nH <= cH * 1.002) bias = "bearish";
  else if (last > mid) bias = "bullish";
  else if (last < mid) bias = "bearish";
  return { high, low, last, bias, rangeMid: mid, inDiscount: last < mid };
}

export function lastFvg(candles: Candle[]): Fvg | null {
  const t = closedBars(candles).slice(-20);
  const live = candles[candles.length - 1];
  for (let i = t.length - 1; i >= 2; i--) {
    const a = t[i - 2];
    const c = t[i];
    let fvg: Fvg | null = null;
    if (c.low > a.high) fvg = { kind: "bullish", low: a.high, high: c.low };
    else if (c.high < a.low) fvg = { kind: "bearish", low: c.high, high: a.low };
    if (!fvg) continue;
    const later = t.slice(i + 1);
    const filledClosed =
      fvg.kind === "bullish" ? later.some((x) => x.low <= fvg!.low) : later.some((x) => x.high >= fvg!.high);
    const filledLive =
      live &&
      (fvg.kind === "bullish" ? live.low <= fvg.low || live.close < fvg.low : live.high >= fvg.high || live.close > fvg.high);
    if (!filledClosed && !filledLive) return fvg;
  }
  return null;
}

export function zoneReachable(zone: Fvg, mark: number): boolean {
  if (zone.kind === "bullish") return mark >= zone.low;
  return mark <= zone.high;
}

export function lastOb(candles: Candle[]): Fvg | null {
  const t = closedBars(candles);
  if (t.length < 4) return null;
  for (let i = t.length - 1; i >= 2; i--) {
    const impulse = t[i];
    const prev = t[i - 1];
    const range = impulse.high - impulse.low;
    const prevRange = prev.high - prev.low || range;
    if (range < prevRange * 1.05) continue;
    if (impulse.close > impulse.open && prev.close <= prev.open) {
      return { kind: "bullish", low: Math.min(prev.open, prev.close), high: Math.max(prev.open, prev.close) };
    }
    if (impulse.close < impulse.open && prev.close >= prev.open) {
      return { kind: "bearish", low: Math.min(prev.open, prev.close), high: Math.max(prev.open, prev.close) };
    }
  }
  return null;
}

export function describeStruct(tf: string, s: RangeStruct | null) {
  if (!s) return `${tf}: not enough bars`;
  const side = s.inDiscount ? "discount" : "premium";
  return `${tf} ${s.bias} · ${side} of ${G(s.low)}–${G(s.high)} · last ${G(s.last)}`;
}
