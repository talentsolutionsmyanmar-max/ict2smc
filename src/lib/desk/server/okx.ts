import type { Bias, BookLevel, Candle, HeatBand, LiqCluster, LiqPrint, ProfileBin, RadarHit, RelStrength, Tape } from "../types";
import { compactPair, normalizePair } from "../format";
import { clockAt } from "../session";
import { sessionLevels, structureOf } from "../ict";
import { relStrengthOf } from "../regime";
import { mechanicalRead } from "../mechanical";
import { MAJORS } from "../universe";

const OKX = "https://www.okx.com";
const oiCache = new Map<string, { oi: number; at: number }>();

function instId(symbol: string) {
  const base = compactPair(symbol);
  return `${base}-USDT-SWAP`;
}

async function okx<T>(path: string): Promise<T[]> {
  const res = await fetch(`${OKX}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OKX ${res.status}`);
  const body = (await res.json()) as { code: string; data?: T[]; msg?: string };
  if (body.code !== "0" || !body.data) throw new Error(body.msg || "OKX error");
  return body.data;
}

function parseCandle(row: string[]): Candle {
  return {
    t: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    vol: Number(row[6] || row[5] || 0),
  };
}

function notional(level: BookLevel) {
  return level.px * level.sz;
}

function wallOf(levels: BookLevel[]) {
  if (!levels.length) return null;
  return levels.reduce((a, b) => (notional(b) > notional(a) ? b : a));
}

function volumeProfile(candles: Candle[], bins = 32): ProfileBin[] {
  if (candles.length < 4) return [];
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));
  const span = hi - lo || 1;
  const acc = Array.from({ length: bins }, (_, i) => ({
    px: hi - ((i + 0.5) / bins) * span,
    vol: 0,
  }));
  for (const c of candles) {
    const mid = (c.high + c.low) / 2;
    const i = Math.min(bins - 1, Math.max(0, Math.floor(((hi - mid) / span) * bins)));
    acc[i].vol += c.vol || Math.abs(c.close - c.open);
  }
  return acc;
}

function liqBands(mark: number, oiUsd: number, book: BookLevel[], profile: ProfileBin[]): HeatBand[] {
  const span = mark * 0.08;
  const top = mark + span;
  const bot = mark - span;
  const n = 36;
  const bands: HeatBand[] = Array.from({ length: n }, (_, i) => {
    const px = top - (i / (n - 1)) * (top - bot);
    return { px, longLiq: 0, shortLiq: 0, intensity: 0 };
  });
  const leverages = [5, 10, 25, 50, 75, 100];
  for (const lev of leverages) {
    const longPx = mark * (1 - 1 / lev);
    const shortPx = mark * (1 + 1 / lev);
    const weight = oiUsd / (lev * 8);
    for (const b of bands) {
      const longD = Math.abs(b.px - longPx) / (span * 0.08);
      const shortD = Math.abs(b.px - shortPx) / (span * 0.08);
      if (longD < 3) b.longLiq += weight * Math.exp(-longD * longD);
      if (shortD < 3) b.shortLiq += weight * Math.exp(-shortD * shortD);
    }
  }
  const maxBook = Math.max(1, ...book.map(notional));
  for (const lvl of book) {
    const i = Math.round(((top - lvl.px) / (top - bot)) * (n - 1));
    if (i < 0 || i >= n) continue;
    const w = notional(lvl) / maxBook;
    if (lvl.px >= mark) bands[i].shortLiq += w * oiUsd * 0.02;
    else bands[i].longLiq += w * oiUsd * 0.02;
  }
  const maxVol = Math.max(1, ...profile.map((p) => p.vol));
  for (const p of profile) {
    const i = Math.round(((top - p.px) / (top - bot)) * (n - 1));
    if (i < 0 || i >= n) continue;
    const w = p.vol / maxVol;
    bands[i].longLiq += w * oiUsd * 0.01;
    bands[i].shortLiq += w * oiUsd * 0.01;
  }
  let maxI = 0.001;
  for (const b of bands) {
    b.intensity = b.longLiq + b.shortLiq;
    if (b.intensity > maxI) maxI = b.intensity;
  }
  for (const b of bands) b.intensity = b.intensity / maxI;
  return bands;
}

function clustersFrom(mark: number, oiUsd: number, bids: BookLevel[], asks: BookLevel[]): LiqCluster[] {
  const out: LiqCluster[] = [];
  const bidW = wallOf(bids);
  const askW = wallOf(asks);
  if (bidW) out.push({ kind: "bid-wall", px: bidW.px, notional: notional(bidW) });
  if (askW) out.push({ kind: "ask-wall", px: askW.px, notional: notional(askW) });
  for (const lev of [10, 25, 50, 100]) {
    out.push({ kind: `long-liq-${lev}x`, px: mark * (1 - 1 / lev), notional: oiUsd / lev });
    out.push({ kind: `short-liq-${lev}x`, px: mark * (1 + 1 / lev), notional: oiUsd / lev });
  }
  return out.sort((a, b) => Math.abs(a.px - mark) - Math.abs(b.px - mark)).slice(0, 10);
}

function cvdFromCandles(candles: Candle[]) {
  let cvd = 0;
  const points: { t: number; cvd: number }[] = [];
  for (const c of candles.slice(-48)) {
    const dir = c.close >= c.open ? 1 : -1;
    cvd += dir * (c.vol || Math.abs(c.close - c.open) * 100);
    points.push({ t: c.t, cvd });
  }
  return { cvd, points };
}

function takerBuyPct(candles: Candle[]) {
  const slice = candles.slice(-8);
  if (!slice.length) return 50;
  let buy = 0;
  let sell = 0;
  for (const c of slice) {
    const v = c.vol || 1;
    if (c.close >= c.open) buy += v;
    else sell += v;
  }
  const t = buy + sell || 1;
  return (buy / t) * 100;
}

function volRatioOf(candles: Candle[]): number {
  if (candles.length < 8) return 1;
  const last = candles[candles.length - 1];
  const closed = Date.now() - last.t < 840000 ? candles.slice(0, -1) : candles;
  if (closed.length < 6) return 1;
  const cur = closed[closed.length - 1];
  const prior = closed.slice(-21, -1);
  const avg = prior.reduce((s, c) => s + (c.vol || 0), 0) / (prior.length || 1);
  return avg > 0 ? cur.vol / avg : 1;
}

function parseOi(rows: unknown[], current: number, ccy: string): { deltaPct: number; ratio: number } {
  const values: number[] = [];
  for (const row of rows) {
    if (Array.isArray(row)) {
      const n = Number(row[2] ?? row[1]);
      if (n > 0) values.push(n);
    } else if (row && typeof row === "object") {
      const rec = row as Record<string, string>;
      const n = Number(rec.oiUsd ?? rec.oiCcy ?? rec.oi);
      if (n > 0) values.push(n);
    }
  }
  let deltaPct = 0;
  let ratio = 1;
  if (values.length >= 2) {
    const latest = values[0];
    const prev = values[Math.min(12, values.length - 1)];
    if (prev > 0) deltaPct = ((latest - prev) / prev) * 100;
    const avgSlice = values.slice(1, 21);
    const avg = avgSlice.reduce((s, n) => s + n, 0) / (avgSlice.length || 1);
    if (avg > 0) ratio = latest / avg;
  } else {
    const cached = oiCache.get(ccy);
    oiCache.set(ccy, { oi: current, at: Date.now() });
    if (cached?.oi && cached.oi > 0 && current > 0) deltaPct = ((current - cached.oi) / cached.oi) * 100;
  }
  return { deltaPct, ratio };
}

function liqNotionals(recent: LiqPrint[]) {
  let longs = 0;
  let shorts = 0;
  for (const p of recent) {
    const n = (p.sz ?? 0) * p.px;
    if (p.side === "long") longs += n;
    else shorts += n;
  }
  return { longs, shorts };
}

function tapeRead(tape: Omit<Tape, "read">): string {
  const clock = clockAt();
  const levels = sessionLevels(tape.candles);
  const asia =
    levels.asiaHigh != null && levels.asiaLow != null
      ? `Asia ${levels.asiaLow.toPrecision(5)}–${levels.asiaHigh.toPrecision(5)}`
      : "Asia H/L still forming";
  const flow = tape.cvd >= 0 ? "CVD rising" : "CVD falling";
  const book =
    tape.imbalance == null
      ? "book mixed"
      : tape.imbalance >= 54
        ? "bids in control"
        : tape.imbalance <= 46
          ? "offers in control"
          : "book balanced";
  const rs =
    tape.relStrength === "lead" ? "leading BTC" : tape.relStrength === "lag" ? "lagging BTC" : "flat vs BTC";
  return `${clock.sessionLabel}. ${asia}. ${flow}, ${book}. Vol ${tape.volRatio.toFixed(2)}×. ${rs}. Funding ${(tape.funding * 100).toFixed(3)}%.`;
}

type TickerRow = {
  last: string;
  lastSz?: string;
  open24h: string;
  high24h: string;
  low24h: string;
  instId: string;
};

type BookRow = {
  asks: string[][];
  bids: string[][];
};

type FundingRow = { fundingRate: string };
type OiRow = { oiUsd: string };
type TradeRow = { side: string; px: string; sz: string; ts: string };
type LiqRow = {
  details?: { posSide?: string; bkPx?: string; sz?: string; ts?: string; time?: number }[];
};

export async function fetchOkxTape(symbol: string): Promise<Tape> {
  const id = instId(symbol);
  const pair = normalizePair(symbol);
  const base = compactPair(symbol);
  const isBtc = base === "BTC";
  const empty: never[] = [];
  const [ticker, c15, c1h, c4h, c1m, book, funding, oi, trades, liqs, btcTicker, btc4h, oiHist] = await Promise.all([
    okx<TickerRow>(`/api/v5/market/ticker?instId=${id}`),
    okx<string[]>(`/api/v5/market/candles?instId=${id}&bar=15m&limit=200`),
    okx<string[]>(`/api/v5/market/candles?instId=${id}&bar=1H&limit=48`),
    okx<string[]>(`/api/v5/market/candles?instId=${id}&bar=4H&limit=30`),
    okx<string[]>(`/api/v5/market/candles?instId=${id}&bar=1m&limit=60`).catch(() => empty),
    okx<BookRow>(`/api/v5/market/books?instId=${id}&sz=40`),
    okx<FundingRow>(`/api/v5/public/funding-rate?instId=${id}`).catch(() => empty),
    okx<OiRow>(`/api/v5/public/open-interest?instId=${id}`).catch(() => empty),
    okx<TradeRow>(`/api/v5/market/trades?instId=${id}&limit=100`).catch(() => empty),
    okx<LiqRow>(`/api/v5/public/liquidation-orders?instType=SWAP&instId=${id}&state=filled`).catch(() => empty),
    isBtc ? Promise.resolve(empty) : okx<TickerRow>(`/api/v5/market/ticker?instId=BTC-USDT-SWAP`).catch(() => empty),
    isBtc ? Promise.resolve(empty) : okx<string[]>(`/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=4H&limit=30`).catch(() => empty),
    okx<unknown[]>(`/api/v5/rubik/stat/contracts/open-interest-history?instType=SWAP&ccy=${base}&period=5m`).catch(() => empty),
  ]);

  const t = ticker[0];
  if (!t) throw new Error("No ticker");
  const mark = Number(t.last);
  const open24 = Number(t.open24h) || mark;
  const candles = [...c15].reverse().map(parseCandle);
  const h1 = [...c1h].reverse().map(parseCandle);
  const h4 = [...c4h].reverse().map(parseCandle);
  const m1 = [...c1m].reverse().map(parseCandle);
  const book0 = book[0];
  const bids: BookLevel[] = (book0?.bids ?? []).map((r) => ({ px: Number(r[0]), sz: Number(r[1]) }));
  const asks: BookLevel[] = (book0?.asks ?? []).map((r) => ({ px: Number(r[0]), sz: Number(r[1]) }));
  const bidN = bids.slice(0, 20).reduce((s, l) => s + notional(l), 0);
  const askN = asks.slice(0, 20).reduce((s, l) => s + notional(l), 0);
  const imbalance = bidN + askN > 0 ? (bidN / (bidN + askN)) * 100 : null;
  const oiUsd = Number(oi[0]?.oiUsd || 0);
  const fundingRate = Number(funding[0]?.fundingRate || 0);
  const { cvd, points } = cvdFromCandles(candles);
  const buyTrades = trades.filter((x) => x.side === "buy").reduce((s, x) => s + Number(x.sz), 0);
  const sellTrades = trades.filter((x) => x.side === "sell").reduce((s, x) => s + Number(x.sz), 0);
  const tradeT = buyTrades + sellTrades;
  const takerFromTrades = tradeT > 0 ? (buyTrades / tradeT) * 100 : takerBuyPct(candles);
  const profile = volumeProfile(candles.slice(-64));
  const recentLiqs: LiqPrint[] = [];
  for (const row of liqs) {
    for (const d of row.details ?? []) {
      const px = Number(d.bkPx);
      if (!px) continue;
      recentLiqs.push({
        side: d.posSide === "short" ? "short" : "long",
        px,
        ts: Number(d.ts || d.time || 0),
        sz: Number(d.sz || 0),
      });
    }
  }
  const bands = liqBands(mark, oiUsd || mark * 1e6, [...bids, ...asks], profile);
  const changePct = open24 ? ((mark - open24) / open24) * 100 : 0;
  const { longs, shorts } = liqNotionals(recentLiqs.slice(0, 40));

  let btcChangePct = changePct;
  let btcBias4h: Bias = structureOf(h4)?.bias ?? "unclear";
  let btcH4: Candle[] = isBtc ? h4 : [];
  if (!isBtc) {
    const bt = btcTicker[0];
    if (bt) {
      const last = Number(bt.last);
      const open = Number(bt.open24h) || last;
      btcChangePct = open ? ((last - open) / open) * 100 : 0;
    }
    btcH4 = [...btc4h].reverse().map(parseCandle);
    btcBias4h = structureOf(btcH4)?.bias ?? "unclear";
  }

  const oiStats = parseOi(oiHist, oiUsd, base);
  const oiDeltaPct = oiStats.deltaPct;
  const oiRatio = oiStats.ratio;
  const volRatio = volRatioOf(candles);
  const relStrength: RelStrength = relStrengthOf({
    symbol: pair,
    changePct,
    btcChangePct,
    h4,
    btcH4,
  });

  const draft: Omit<Tape, "read"> = {
    venue: "OKX",
    symbol: pair,
    mark,
    last: mark,
    changePct,
    low24: Number(t.low24h) || mark,
    high24: Number(t.high24h) || mark,
    funding: fundingRate,
    oiUsd,
    oiDeltaPct,
    oiRatio,
    volRatio,
    takerBuyPct: takerFromTrades,
    cvd,
    cvdPoints: points,
    candles,
    h1,
    h4,
    m1,
    btcH4,
    bids,
    asks,
    imbalance,
    bidWall: wallOf(bids),
    askWall: wallOf(asks),
    clusters: clustersFrom(mark, oiUsd || mark * 1e6, bids, asks),
    bands,
    profile,
    recentLiqs: recentLiqs.slice(0, 8),
    btcChangePct,
    btcBias4h,
    relStrength,
    liqLongNotional: longs,
    liqShortNotional: shorts,
    at: Date.now(),
  };
  return { ...draft, read: tapeRead(draft) };
}

export async function fetchBtcAnchor(): Promise<{ btcH4: Candle[]; btcChangePct: number; btcBias4h: Bias }> {
  const [ticker, c4h] = await Promise.all([
    okx<TickerRow>(`/api/v5/market/ticker?instId=BTC-USDT-SWAP`).catch(() => [] as TickerRow[]),
    okx<string[]>(`/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=4H&limit=30`).catch(() => [] as string[][]),
  ]);
  const bt = ticker[0];
  const last = Number(bt?.last || 0);
  const open = Number(bt?.open24h || last);
  const btcH4 = [...c4h].reverse().map(parseCandle);
  return {
    btcH4,
    btcChangePct: open ? ((last - open) / open) * 100 : 0,
    btcBias4h: structureOf(btcH4)?.bias ?? "unclear",
  };
}

/** Lighter tape for the major-pair radar — enough for mechanicalRead, not the full book. */
export async function fetchOkxTapeLite(
  symbol: string,
  shared?: { btcH4: Candle[]; btcChangePct: number; btcBias4h: Bias },
): Promise<Tape> {
  const id = instId(symbol);
  const pair = normalizePair(symbol);
  const base = compactPair(symbol);
  const isBtc = base === "BTC";
  const empty: never[] = [];
  const [ticker, c15, c4h, oi] = await Promise.all([
    okx<TickerRow>(`/api/v5/market/ticker?instId=${id}`),
    okx<string[]>(`/api/v5/market/candles?instId=${id}&bar=15m&limit=200`),
    okx<string[]>(`/api/v5/market/candles?instId=${id}&bar=4H&limit=30`),
    okx<OiRow>(`/api/v5/public/open-interest?instId=${id}`).catch(() => empty),
  ]);
  const t = ticker[0];
  if (!t) throw new Error("No ticker");
  const mark = Number(t.last);
  const open24 = Number(t.open24h) || mark;
  const candles = [...c15].reverse().map(parseCandle);
  const h4 = [...c4h].reverse().map(parseCandle);
  const oiUsd = Number(oi[0]?.oiUsd || 0);
  const { cvd, points } = cvdFromCandles(candles);
  const changePct = open24 ? ((mark - open24) / open24) * 100 : 0;
  let btcChangePct = shared?.btcChangePct ?? changePct;
  let btcBias4h: Bias = shared?.btcBias4h ?? structureOf(h4)?.bias ?? "unclear";
  let btcH4: Candle[] = isBtc ? h4 : (shared?.btcH4 ?? []);
  if (isBtc) {
    btcChangePct = changePct;
    btcBias4h = structureOf(h4)?.bias ?? "unclear";
    btcH4 = h4;
  }
  const relStrength: RelStrength = relStrengthOf({
    symbol: pair,
    changePct,
    btcChangePct,
    h4,
    btcH4,
  });
  const draft: Tape = {
    venue: "OKX",
    symbol: pair,
    mark,
    last: mark,
    changePct,
    low24: Number(t.low24h) || mark,
    high24: Number(t.high24h) || mark,
    funding: 0,
    oiUsd,
    oiDeltaPct: 0,
    oiRatio: 1,
    volRatio: volRatioOf(candles),
    takerBuyPct: takerBuyPct(candles),
    cvd,
    cvdPoints: points,
    read: "",
    candles,
    h1: [],
    h4,
    m1: [],
    btcH4,
    bids: [],
    asks: [],
    imbalance: null,
    bidWall: null,
    askWall: null,
    clusters: [],
    bands: [],
    profile: [],
    recentLiqs: [],
    btcChangePct,
    btcBias4h,
    relStrength,
    liqLongNotional: 0,
    liqShortNotional: 0,
    at: Date.now(),
  };
  return { ...draft, read: tapeRead(draft) };
}

export async function fetchWatchlist() {
  const want = ["HYPE", "BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "AVAX"];
  const data = await okx<TickerRow>(`/api/v5/market/tickers?instType=SWAP`);
  const byBase = new Map<string, TickerRow>();
  for (const row of data) {
    const m = row.instId.match(/^([A-Z0-9]+)-USDT-SWAP$/);
    if (!m) continue;
    byBase.set(m[1], row);
  }
  return want
    .map((symbol) => {
      const row = byBase.get(symbol);
      if (!row) return null;
      const price = Number(row.last);
      const open = Number(row.open24h) || price;
      return { symbol, price, changePct: open ? ((price - open) / open) * 100 : 0 };
    })
    .filter((x): x is { symbol: string; price: number; changePct: number } => !!x);
}

export async function scanMajors(): Promise<RadarHit[]> {
  const btc = await fetchBtcAnchor();
  const rows = await Promise.all(
    MAJORS.map(async (pair) => {
      try {
        const tape = await fetchOkxTapeLite(pair, btc);
        const analysis = mechanicalRead(tape, pair);
        return {
          pair,
          mark: tape.mark,
          changePct: tape.changePct,
          verdict: analysis.verdict,
          size: analysis.size,
          riskPct: analysis.riskPct,
          entry: analysis.entry,
          stopLoss: analysis.stopLoss,
          sequence: analysis.sequence,
          missingPriority: analysis.missingPriority,
          closedAt: analysis.closedAt,
          bias4h: analysis.bias4h,
          window: analysis.window,
          overrideReady: analysis.overrideReady,
          confidence: analysis.confidence,
        } as RadarHit;
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((x): x is RadarHit => Boolean(x));
}

