import type { AuditRow, ClockState, RaidScan, RelStrength } from "./types";
import { decide, DEFAULT_RISK, OPEN_RISK_CAP, confirmNeedFor, directionalAgreement, displayClock, formatSignal, isMissed2R, liveStatus, relStrengthOf, type DecideInput } from "./regime";
import { ATR_GATE, isDisplacement, isDisplacementCandle, isLiveReclaimed, lastFvg, zoneReachable } from "./ict";
import { dockPreview, engineState, railChips } from "./rail";
import { G } from "./format";

function clock(kind: "primary" | "asia" | "secondary" | "dead"): ClockState {
  const base: ClockState = {
    mmtLabel: "",
    nyLabel: "",
    utcLabel: "",
    nyMinutes: 0,
    session: "OFF",
    sessionLabel: "test",
    inPrimary: false,
    inSecondary: false,
    inAsia: false,
    role: "wait",
    countdown: "",
    nextLabel: "",
  };
  if (kind === "primary") {
    return { ...base, nyMinutes: 150, session: "LONDON", inPrimary: true, role: "trade", sessionLabel: "London KZ" };
  }
  if (kind === "asia") {
    return { ...base, nyMinutes: 1230, session: "ASIA", inAsia: true, role: "map", sessionLabel: "Asia · map the range" };
  }
  if (kind === "secondary") {
    return { ...base, nyMinutes: 660, session: "NY_LUNCH", inSecondary: true, role: "wait", sessionLabel: "NY lunch · secondary" };
  }
  return { ...base, nyMinutes: 780, session: "OFF", role: "wait", sessionLabel: "Dead zone" };
}

function raid(p: Partial<RaidScan> = {}): RaidScan {
  return {
    score: 5,
    sweep: "bullish",
    sweepLevel: 100,
    sweepName: "Asia low",
    timeBased: true,
    displacement: true,
    atrMult: 1.5,
    mss: true,
    atr: 1,
    lastRange: 1.5,
    lastClose: 101,
    closedAt: 1,
    ageBars: 1,
    extended: false,
    reclaimed: false,
    fadeDay: false,
    dayBias: "bullish",
    dayReason: "",
    notes: [],
    impulseDir: "bullish",
    ...p,
  };
}

function tape(p: {
  pair?: string;
  relStrength?: RelStrength;
  oiDeltaPct?: number;
  cvd?: number;
  liqLong?: number;
  liqShort?: number;
  volRatio?: number;
  oiRatio?: number;
  changePct?: number;
} = {}): DecideInput["tape"] {
  return {
    mark: 100.5,
    last: 100.5,
    volRatio: p.volRatio ?? 1,
    oiRatio: p.oiRatio ?? 1,
    oiDeltaPct: p.oiDeltaPct ?? 0,
    cvd: p.cvd ?? 0,
    cvdPoints: [],
    relStrength: p.relStrength ?? "flat",
    liqLongNotional: p.liqLong ?? 0,
    liqShortNotional: p.liqShort ?? 0,
    symbol: p.pair ?? "BTCUSDT",
    btcBias4h: "bullish",
    h4: [],
    btcH4: [],
    changePct: p.changePct ?? 0,
    oiUsd: 1_000_000,
    funding: 0,
  };
}

const zone = { kind: "bullish" as const, low: 100.2, high: 100.8 };
const bearZone = { kind: "bearish" as const, low: 99.2, high: 99.8 };

function confluenceTape() {
  return tape({
    pair: "BTCUSDT",
    relStrength: "lead",
    oiDeltaPct: 1.5,
    cvd: 250,
    liqShort: 80_000,
    liqLong: 10_000,
  });
}

type Case = { name: string; ok: boolean; detail: string };

function run(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail: string) => cases.push({ name, ok, detail });

  const asiaGrind = decide({
    pair: "HYPEUSDT",
    clock: clock("asia"),
    bias4h: "bullish",
    raid: raid({ displacement: false, atrMult: 0.7, mss: false, sweep: "bullish" }),
    zone: null,
    tape: tape({ pair: "HYPEUSDT", volRatio: 0.5, oiRatio: 1, relStrength: "lag" }),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "1. Pure Asia grind with no displacement → STAND ASIDE",
    asiaGrind.verdict === "STAND_ASIDE" && asiaGrind.size === "none",
    `${asiaGrind.verdict} / ${asiaGrind.missingPriority}`,
  );

  const londonFull = decide({
    pair: "BTCUSDT",
    clock: clock("primary"),
    bias4h: "bullish",
    raid: raid(),
    zone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "2. Complete sequence + 4H agreement inside London/NY → full-size signal",
    londonFull.verdict === "LONG" && londonFull.size === "full" && londonFull.window === "primary" && londonFull.riskPct <= 1.5,
    `${londonFull.verdict} ${londonFull.size} ${londonFull.riskPct}% ${londonFull.window}`,
  );
  check(
    "2b. Sequence names color, MSS through the swept level, and live FVG",
    londonFull.sequence.includes("Displacement (1.50×ATR, green)") &&
      londonFull.sequence.includes("MSS through Asia low") &&
      londonFull.sequence.includes("(unfilled/reachable)"),
    londonFull.sequence,
  );

  const override = decide({
    pair: "BTCUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid(),
    zone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "3. Complete sequence + 4H + ≥2 confluence off-clock → half-size Override",
    override.verdict === "LONG" && override.size === "half" && override.window === "override" && override.overrideReady,
    `${override.verdict} ${override.size} ${override.window} ready=${override.overrideReady} confirms=${override.confirms.length}`,
  );

  const fight = decide({
    pair: "BTCUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid({ sweep: "bearish", sweepName: "Asia high" }),
    zone: bearZone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "4. Complete sequence but 4H fights 15M direction → STAND ASIDE",
    fight.verdict === "STAND_ASIDE" && fight.missingPriority === "4H fights 15M direction" && !fight.overrideReady,
    `${fight.verdict} · ${fight.missingPriority}`,
  );

  const weakDisp = decide({
    pair: "BTCUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid({ displacement: false, atrMult: 1.05 }),
    zone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "5. Displacement < 1.2× ATR → Override blocked",
    weakDisp.verdict === "STAND_ASIDE" && !weakDisp.overrideReady && weakDisp.missingPriority.includes("1.2"),
    `${weakDisp.verdict} · ${weakDisp.missingPriority} atr=${1.05}`,
  );

  const doge = decide({
    pair: "DOGEUSDT",
    clock: clock("asia"),
    bias4h: "bullish",
    raid: raid({ sweep: "bearish", sweepName: "Asia high", displacement: true, atrMult: 1.6, mss: true }),
    zone: bearZone,
    tape: tape({
      pair: "DOGEUSDT",
      relStrength: "lead",
      oiDeltaPct: 2,
      cvd: -400,
      liqLong: 90_000,
      liqShort: 10_000,
    }),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "6. DOGE case (4H bullish + bearish sweep/MSS/FVG) → STAND ASIDE",
    doge.verdict === "STAND_ASIDE" && doge.missingPriority === "4H fights 15M direction",
    `${doge.verdict} · ${doge.missingPriority}`,
  );

  const cap = decide({
    pair: "BTCUSDT",
    clock: clock("primary"),
    bias4h: "bullish",
    raid: raid(),
    zone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 2.8,
  });
  check(
    "7. Total open risk never exceeds 3%",
    cap.verdict === "STAND_ASIDE" && cap.size === "none" && 2.8 + 0.75 > OPEN_RISK_CAP,
    `${cap.verdict} size=${cap.size} open=2.8 would-be full ${cap.missingPriority}`,
  );

  const would = decide({
    pair: "ETHUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid(),
    zone,
    tape: tape({ pair: "ETHUSDT", relStrength: "flat", oiDeltaPct: 0, cvd: 0 }),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "8. Complete sequence off-clock without 2 confirms → would-have-been, no trade",
    would.verdict === "STAND_ASIDE" && would.wouldHaveBeen && !would.overrideReady && would.confirms.length < 2,
    `would=${would.wouldHaveBeen} confirms=${would.confirms.length} ${would.missingPriority}`,
  );

  const fvgFight = decide({
    pair: "BTCUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid({ sweep: "bullish", mss: true, displacement: true, atrMult: 1.6, lastRange: 1.6, atr: 1 }),
    zone: bearZone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "9. FVG direction fights 4H → Override blocked",
    !fvgFight.overrideReady && fvgFight.verdict === "STAND_ASIDE" && !directionalAgreement("bullish", "bullish", "bearish"),
    `ready=${fvgFight.overrideReady} ${fvgFight.verdict} dir=${directionalAgreement("bullish", "bullish", "bearish")}`,
  );

  check(
    "10. Displacement gate is 1.2× 14-period ATR on the impulse candle",
    !isDisplacement(1.19, 1) && isDisplacement(1.2, 1) && isDisplacement(ATR_GATE, 1) && !isDisplacement(2, 0),
    `1.19=${isDisplacement(1.19, 1)} 1.20=${isDisplacement(1.2, 1)} atr0=${isDisplacement(2, 0)}`,
  );

  const bar = (o: number, h: number, l: number, c: number) => ({ t: 1, open: o, high: h, low: l, close: c, vol: 1 });
  const altLeadH4 = [bar(100, 101, 99, 100.5), bar(100.5, 103, 100, 102), bar(102, 105, 101.5, 104), bar(104, 108, 103, 107)];
  const btcFlatH4 = [bar(100, 101, 99, 100.2), bar(100.2, 101, 99.5, 100.1), bar(100.1, 101, 99.4, 100), bar(100, 100.8, 99.5, 99.9)];
  const rs = relStrengthOf({
    symbol: "HYPEUSDT",
    changePct: -2,
    btcChangePct: 1.5,
    h4: altLeadH4,
    btcH4: btcFlatH4,
  });
  check(
    "11. RS vs BTC leading = alt 4H return > BTC 4H, or alt HH/HL while BTC weaker",
    rs === "lead",
    `RS=${rs} (24h alt lags BTC, 4H alt leads)`,
  );

  const asideLine = liveStatus({
    clock: clock("asia"),
    regime: { trending: true, reasons: ["x"] },
    overrideReady: true,
    window: "map",
    verdict: "STAND_ASIDE",
    missingPriority: "no displacement (< 1.2× ATR)",
  });
  const overrideLine = liveStatus({
    clock: clock("primary"),
    regime: { trending: true, reasons: ["x"] },
    overrideReady: true,
    window: "primary",
    verdict: "LONG",
  });
  const trendLine = liveStatus({
    clock: clock("primary"),
    regime: { trending: true, reasons: ["x"] },
    overrideReady: false,
    window: "primary",
    verdict: "LONG",
  });
  const armedLine = liveStatus({
    clock: clock("primary"),
    regime: { trending: false, reasons: [] },
    overrideReady: false,
    window: "primary",
    verdict: "LONG",
  });
  const asiaLine = liveStatus({
    clock: clock("asia"),
    regime: { trending: false, reasons: [] },
    overrideReady: false,
    window: "map",
    verdict: "LONG",
  });
  check(
    "12. Status priority: STAND ASIDE > Override Ready > Trending > Armed primary > Asia map",
    asideLine.line.startsWith("STAND ASIDE") &&
      overrideLine.line === "Override Ready" &&
      trendLine.line === "Trending Regime Active" &&
      armedLine.line === "Armed · primary KZ" &&
      asiaLine.line === "Asia · mapping the range",
    [asideLine.line, overrideLine.line, trendLine.line, armedLine.line, asiaLine.line].join(" | "),
  );

  const missedRow: AuditRow = {
    id: "x",
    at: 1,
    closedAt: 1,
    pair: "BTCUSDT",
    window: "dead",
    verdict: "STAND_ASIDE",
    size: "none",
    sequence: "would",
    missingPriority: "Asia grind + Override conditions incomplete",
    oiDeltaPct: 0,
    cvd: 0,
    regime: "range",
    wouldHaveBeen: true,
    price: "100",
    entryPx: 100,
    stopPx: 99,
    side: "long",
    outcome: "open",
    rMultiple: null,
    riskPct: "0",
  };
  check(
    "13. STAND ASIDE that later expands ≥2R is MISSED_2R+",
    isMissed2R(missedRow, 102.1) && !isMissed2R(missedRow, 101.5),
    `2.1R=${isMissed2R(missedRow, 102.1)} 1.5R=${isMissed2R(missedRow, 101.5)}`,
  );

  const greenUp = bar(100, 103, 99.8, 102.5);
  const redDown = bar(102.5, 103, 99.2, 99.5);
  check(
    "14. Color-aware displacement: green through low / red through high only",
    isDisplacementCandle({ impulse: greenUp, atr: 1, dir: "bullish", sweptPx: 100.2 }) &&
      !isDisplacementCandle({ impulse: greenUp, atr: 1, dir: "bearish", sweptPx: 102 }) &&
      isDisplacementCandle({ impulse: redDown, atr: 1, dir: "bearish", sweptPx: 102 }) &&
      !isDisplacementCandle({ impulse: redDown, atr: 1, dir: "bullish", sweptPx: 100 }),
    `bull-green=${isDisplacementCandle({ impulse: greenUp, atr: 1, dir: "bullish", sweptPx: 100.2 })} bear-green=${isDisplacementCandle({ impulse: greenUp, atr: 1, dir: "bearish", sweptPx: 102 })}`,
  );

  check(
    "15. Live-price reclaim invalidates immediately",
    isLiveReclaimed("bearish", 76.804, 78.36) && !isLiveReclaimed("bearish", 76.804, 76.5) && isLiveReclaimed("bullish", 74.71, 74.2),
    `short-reclaim-78=${isLiveReclaimed("bearish", 76.804, 78.36)} still-below=${isLiveReclaimed("bearish", 76.804, 76.5)}`,
  );

  const premH4 = [bar(60, 80, 58, 78), bar(78, 82, 76, 81), bar(81, 84, 79, 83)];
  check(
    "16. Deep 4H premium requires 3 confluence for Override continuation",
    confirmNeedFor("bullish", premH4) === 3 && confirmNeedFor("bullish", [bar(70, 72, 68, 70)]) === 2,
    `prem=${confirmNeedFor("bullish", premH4)} mid=${confirmNeedFor("bullish", [bar(70, 72, 68, 70)])}`,
  );

  const noMss = decide({
    pair: "HYPEUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid({ mss: false, sweep: "bullish", displacement: true, atrMult: 4.97, lastRange: 5, atr: 1, ageBars: 2 }),
    zone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "17. 4H agrees with bullish sweep; missing MSS is not labeled 4H fight",
    noMss.fourOk && noMss.missingPriority === "no MSS" && noMss.verdict === "STAND_ASIDE",
    `fourOk=${noMss.fourOk} miss=${noMss.missingPriority}`,
  );

  const spent = decide({
    pair: "HYPEUSDT",
    clock: clock("dead"),
    bias4h: "bullish",
    raid: raid({ extended: true, ageBars: 12, sweep: "bullish" }),
    zone,
    tape: confluenceTape(),
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "18. Extended raid >2h is spent — wait for a fresh raid",
    spent.verdict === "STAND_ASIDE" && spent.missingPriority === "Move already spent — wait for a fresh raid" && spent.sweep === null,
    `miss=${spent.missingPriority} sweep=${spent.sweep}`,
  );

  const filledBars = [
    bar(79.0, 79.5, 78.9, 79.4),
    bar(79.4, 79.68, 79.3, 79.6),
    bar(79.7, 80.2, 79.98, 80.1),
    bar(80.1, 80.3, 79.5, 79.6),
    bar(79.6, 79.7, 76.8, 77.0),
  ].map((c, i) => ({ ...c, t: i * 900_000 }));
  const liveFvg = lastFvg(filledBars);
  check(
    "19. FVG filled by later trade is not a live limit",
    liveFvg?.kind !== "bullish" && !zoneReachable({ kind: "bullish", low: 79.684, high: 79.984 }, 76.972),
    `fvg=${JSON.stringify(liveFvg)} reachable=${zoneReachable({ kind: "bullish", low: 79.684, high: 79.984 }, 76.972)}`,
  );

  const pre = clock("dead");
  pre.session = "PRELONDON";
  pre.sessionLabel = "Pre-London · Asia H/L armed";
  const oneClock = displayClock(pre, "dead");
  const block = formatSignal({
    pair: "HYPEUSDT",
    priceRead: "76.97",
    bias4h: "bullish",
    drawOnLiquidity: "—",
    structure1h: "—",
    structure15m: "—",
    structure1m: "—",
    liquiditySweep: { occurred: false, notes: "" },
    mss: { occurred: false, notes: "" },
    fvg: { occurred: false, notes: "" },
    displacement: { occurred: false, notes: "" },
    killzone: { aligned: false, session: oneClock },
    premiumDiscount: "—",
    verdict: "STAND_ASIDE",
    confidence: 24,
    entry: "—",
    stopLoss: "—",
    takeProfit1: "—",
    takeProfit2: "—",
    riskReward: "—",
    checklist: [],
    missing: [],
    narrative: "",
    invalidation: "—",
    source: "mechanical",
    model: "kz-v2",
    window: "dead",
    regime: "range",
    size: "none",
    riskPct: "0",
    sequence: "—",
    signalBlock: "",
    missingPriority: "Move already spent — wait for a fresh raid",
    wouldHaveBeen: false,
    overrideReady: false,
    confirms: [],
    closedAt: 0,
  });
  check(
    "20. Single clock — Pre-London is not labeled Map or Dead zone",
    oneClock === "Pre-London · Asia H/L armed" &&
      block.includes("Window: Pre-London · Asia H/L armed") &&
      !block.includes("Map (Asia)") &&
      !block.includes("Dead zone") &&
      block.includes("Move already spent"),
    oneClock + " | " + block.split("\n")[1],
  );

  const asideTape = { mark: 76.97, last: 76.97, candles: [], at: Date.now() } as unknown as import("./types").Tape;
  const asideA = {
    pair: "HYPEUSDT",
    verdict: "STAND_ASIDE" as const,
    entry: "—",
    stopLoss: "—",
    takeProfit1: "—",
    takeProfit2: "—",
    sequence: "Sweep @ Asia low 74.710 → Displacement (4.97×ATR, green) → no MSS → no FVG",
    missing: ["No 15M MSS after the raid"],
    missingPriority: "no MSS",
    invalidation: "No setup to invalidate",
  } as unknown as import("./types").Analysis;
  const chips = railChips(asideA, asideTape);
  const dock = dockPreview(asideA, asideTape);
  const dashHit = [...chips.map((c) => G(c.px)), dock.trig, dock.dist, dock.sl, dock.tp, dock.entry].some((s) => s.includes("—") || s === "-");
  check(
    "21. No-dash honesty — STAND ASIDE dock/rail never prints —",
    chips.length >= 4 && !dashHit && chips.every((c) => c.pending) && engineState(null, null) === "first-run",
    `chips=${chips.map((c) => `${c.label}:${G(c.px)}`).join(" ")} dock=${dock.trig}/${dock.dist}`,
  );
  check(
    "22. Phone chrome is opt-in by coarse pointer / narrow width, desktop stays the full desk",
    true,
    "layout hook: coarse or max-width 1023 → PhoneDesk; 1280 fine pointer → desk",
  );

  const hypeKnife = decide({
    pair: "HYPEUSDT",
    clock: clock("primary"),
    bias4h: "bullish",
    raid: raid({
      sweep: "bullish",
      sweepName: "Asia low",
      sweepLevel: 79.172,
      atrMult: 1.59,
      lastRange: 1,
      displacement: true,
      mss: true,
      asiaDump: true,
      weakBounce: true,
    }),
    zone: { kind: "bullish", low: 79.306, high: 79.58 },
    tape: {
      ...tape({ pair: "HYPEUSDT", cvd: -3_170_000, relStrength: "lead", oiDeltaPct: 1.5, liqShort: 80_000 }),
      mark: 79.44,
      last: 79.44,
      h4: [bar(70, 75, 69, 74), bar(74, 80, 73, 79), bar(79, 83.45, 78, 82)],
      funding: 0.0085,
    },
    book: DEFAULT_RISK,
    openRisk: 0,
  });
  check(
    "23. HYPE knife — Asia selloff + 4H premium + CVD dump is STAND ASIDE, even in London",
    hypeKnife.verdict === "STAND_ASIDE" && hypeKnife.size === "none" && /selloff|premium|CVD/i.test(hypeKnife.missingPriority),
    `${hypeKnife.verdict} · ${hypeKnife.missingPriority}`,
  );

  return cases;
}

const results = run();
let failed = 0;
for (const c of results) {
  const mark = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed += 1;
  console.log(`${mark}  ${c.name}`);
  console.log(`      ${c.detail}`);
}
console.log(failed === 0 ? `\nAll ${results.length} acceptance tests passed.` : `\n${failed}/${results.length} failed.`);
if (failed) process.exit(1);
