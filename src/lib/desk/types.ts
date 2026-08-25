export type Timeframe = "4H" | "1H" | "15M" | "1M";
export type ViewId = "live" | "translate";
export type Verdict = "LONG" | "SHORT" | "STAND_ASIDE";
export type Bias = "bullish" | "bearish" | "unclear";
export type AnalysisSource = "mechanical" | "tape" | "vision";
export type WindowKind = "primary" | "secondary" | "override" | "map" | "dead";
export type SizeKind = "full" | "half" | "none";
export type RelStrength = "lead" | "lag" | "flat";
export type AuditOutcome = "open" | "win" | "loss" | "scratch" | "missed_2r";

export type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
};

export type BookLevel = { px: number; sz: number };
export type ProfileBin = { px: number; vol: number };
export type CvdPoint = { t: number; cvd: number };
export type LiqPrint = { side: "long" | "short"; px: number; ts: number; sz?: number };

export type LiqCluster = {
  kind: string;
  px: number;
  notional: number;
};

export type HeatBand = {
  px: number;
  longLiq: number;
  shortLiq: number;
  intensity: number;
};

export type Tape = {
  venue: string;
  symbol: string;
  mark: number;
  last: number;
  changePct: number;
  low24: number;
  high24: number;
  funding: number;
  oiUsd: number;
  oiDeltaPct: number;
  oiRatio: number;
  volRatio: number;
  takerBuyPct: number;
  cvd: number;
  cvdPoints: CvdPoint[];
  read: string;
  candles: Candle[];
  h1: Candle[];
  h4: Candle[];
  m1: Candle[];
  btcH4: Candle[];
  bids: BookLevel[];
  asks: BookLevel[];
  imbalance: number | null;
  bidWall: BookLevel | null;
  askWall: BookLevel | null;
  clusters: LiqCluster[];
  bands: HeatBand[];
  profile: ProfileBin[];
  recentLiqs: LiqPrint[];
  btcChangePct: number;
  btcBias4h: Bias;
  relStrength: RelStrength;
  liqLongNotional: number;
  liqShortNotional: number;
  at: number;
};

export type Flag = {
  occurred: boolean;
  notes: string;
  level?: string;
  timeframe?: string;
};

export type CheckItem = { id: string; label: string; pass: boolean };

export type Analysis = {
  pair: string;
  priceRead: string;
  bias4h: Bias;
  drawOnLiquidity: string;
  structure1h: string;
  structure15m: string;
  structure1m: string;
  liquiditySweep: Flag;
  mss: Flag;
  fvg: Flag;
  displacement: Flag;
  killzone: { aligned: boolean; session: string };
  premiumDiscount: string;
  verdict: Verdict;
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskReward: string;
  checklist: CheckItem[];
  missing: string[];
  narrative: string;
  invalidation: string;
  source: AnalysisSource;
  model: string;
  window: WindowKind;
  regime: "trending" | "range";
  size: SizeKind;
  riskPct: string;
  sequence: string;
  signalBlock: string;
  missingPriority: string;
  wouldHaveBeen: boolean;
  overrideReady: boolean;
  confirms: string[];
  closedAt: number;
};

export type HistoryRow = {
  id: string;
  at: number;
  pair: string;
  verdict: Verdict;
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
};

export type RadarHit = {
  pair: string;
  mark: number;
  changePct: number;
  verdict: Verdict;
  /** Live side. Null when STAND_ASIDE — never default this to LONG. */
  side: "LONG" | "SHORT" | null;
  size: SizeKind;
  riskPct: string;
  entry: string;
  stopLoss: string;
  sequence: string;
  missingPriority: string;
  closedAt: number;
  bias4h: Bias;
  window: WindowKind;
  overrideReady: boolean;
  confidence: number;
};

export type KzAlert = {
  id: string;
  at: number;
  pair: string;
  session: string;
  verdict: string;
  note: string;
  usedLlm: boolean;
  score: number;
};

export type AuditRow = {
  id: string;
  at: number;
  closedAt: number;
  pair: string;
  window: WindowKind;
  verdict: Verdict;
  size: SizeKind;
  sequence: string;
  missingPriority: string;
  oiDeltaPct: number;
  cvd: number;
  regime: "trending" | "range";
  wouldHaveBeen: boolean;
  price: string;
  entryPx: number | null;
  stopPx: number | null;
  side: "long" | "short" | null;
  outcome: AuditOutcome;
  rMultiple: number | null;
  riskPct: string;
};

export type RiskBook = {
  fullWinStreak: number;
  needPrimaryWinner: boolean;
  openHalf: number;
  lastAt: number;
};

export type ChartSlot = {
  mime: string;
  data: string;
  preview: string;
};

export type TickerRow = {
  symbol: string;
  price: number;
  changePct: number;
};

export type SessionRole = "trade" | "map" | "wait";

export type ClockState = {
  mmtLabel: string;
  nyLabel: string;
  utcLabel: string;
  nyMinutes: number;
  session: string;
  sessionLabel: string;
  inPrimary: boolean;
  inSecondary: boolean;
  inAsia: boolean;
  role: SessionRole;
  countdown: string;
  nextLabel: string;
};

export type SessionLevels = {
  asiaHigh: number | null;
  asiaLow: number | null;
  asiaComplete: boolean;
  asiaSweepable: boolean;
  priorAsiaHigh: number | null;
  priorAsiaLow: number | null;
  pdh: number | null;
  pdl: number | null;
  londonHigh: number | null;
  londonLow: number | null;
  mark: number;
};

export type LondonDay = {
  bias: Bias | null;
  reason: string;
  brokenHigh: boolean;
  brokenLow: boolean;
};

export type RaidScan = {
  score: number;
  sweep: "bullish" | "bearish" | null;
  sweepLevel: number | null;
  sweepName: string | null;
  timeBased: boolean;
  displacement: boolean;
  atrMult: number;
  mss: boolean;
  atr: number;
  lastRange: number;
  lastClose: number;
  closedAt: number;
  ageBars: number;
  extended: boolean;
  reclaimed: boolean;
  fadeDay: boolean;
  dayBias: Bias | null;
  dayReason: string;
  notes: string[];
  impulseDir?: "bullish" | "bearish" | null;
  asiaDump?: boolean;
  weakBounce?: boolean;
};

export type RangeStruct = {
  high: number;
  low: number;
  last: number;
  bias: Bias;
  rangeMid: number;
  inDiscount: boolean;
};

export type Fvg = { kind: "bullish" | "bearish"; low: number; high: number };

export type RegimeState = {
  trending: boolean;
  reasons: string[];
};

export type LiveStatus = {
  line: string;
  sub: string;
  tone: "live" | "warn" | "neutral";
};
