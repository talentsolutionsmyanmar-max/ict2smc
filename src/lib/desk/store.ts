import { create } from "zustand";
import type {
  Analysis,
  AuditOutcome,
  AuditRow,
  ChartSlot,
  HistoryRow,
  KzAlert,
  RadarHit,
  RiskBook,
  Tape,
  Timeframe,
  ViewId,
} from "./types";
import { DEFAULT_RISK, applyOutcomeToBook, bookAfterSignal, isMissed2R, rMultipleOf } from "./regime";

const HISTORY_KEY = "casper-desk-history";
const WATCH_KEY = "casper-kz-watch";
const ALARM_KEY = "casper-alarm-on";
const ALERTS_KEY = "casper-kz-alerts";
const AUDIT_KEY = "casper-audit-v2";
const RISK_KEY = "casper-risk-book";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function normalizeAudit(row: Partial<AuditRow> & { pair: string }): AuditRow {
  return {
    id: row.id ?? `${row.pair}:${row.at ?? 0}`,
    at: row.at ?? 0,
    closedAt: row.closedAt ?? row.at ?? 0,
    pair: row.pair,
    window: row.window ?? "dead",
    verdict: row.verdict ?? "STAND_ASIDE",
    size: row.size ?? "none",
    sequence: row.sequence ?? "—",
    missingPriority: row.missingPriority ?? "",
    oiDeltaPct: row.oiDeltaPct ?? 0,
    cvd: row.cvd ?? 0,
    regime: row.regime ?? "range",
    wouldHaveBeen: row.wouldHaveBeen ?? false,
    price: row.price ?? "—",
    entryPx: row.entryPx ?? null,
    stopPx: row.stopPx ?? null,
    side: row.side ?? null,
    outcome: row.outcome ?? "open",
    rMultiple: row.rMultiple ?? null,
    riskPct: row.riskPct ?? "0",
  };
}

export type DeskState = {
  pair: string;
  notes: string;
  view: ViewId;
  slots: Partial<Record<Timeframe, ChartSlot>>;
  analysis: Analysis | null;
  tape: Tape | null;
  busy: boolean;
  pending: boolean;
  error: string | null;
  history: HistoryRow[];
  kzWatch: boolean;
  alarmOn: boolean;
  radar: RadarHit[];
  kzAlerts: KzAlert[];
  lastScanCandle: number;
  llmCalls: number;
  audit: AuditRow[];
  riskBook: RiskBook;
  setPair: (pair: string) => void;
  selectPair: (pair: string) => void;
  setNotes: (notes: string) => void;
  setView: (view: ViewId) => void;
  setSlot: (tf: Timeframe, slot: ChartSlot) => void;
  clearSlot: (tf: Timeframe) => void;
  swapSlots: (a: Timeframe, b: Timeframe) => void;
  clearAll: () => void;
  setBusy: (busy: boolean) => void;
  setPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
  setTape: (tape: Tape | null) => void;
  setKzWatch: (on: boolean) => void;
  setAlarmOn: (on: boolean) => void;
  setRadar: (rows: RadarHit[]) => void;
  pushKzAlert: (alert: KzAlert) => void;
  markScan: (closedAt: number, usedLlm: boolean) => void;
  hydrateHistory: () => void;
  setAnalysis: (analysis: Analysis | null, opts?: { history?: boolean }) => void;
  pushAudit: (row: AuditRow) => void;
  markAudit: (id: string, outcome: AuditOutcome) => void;
  tickMissed: (pair: string, mark: number) => void;
  chartPayloads: () => { tf: Timeframe; mime: string; data: string }[];
};

export const useDesk = create<DeskState>((set, get) => ({
  pair: "HYPEUSDT",
  notes: "",
  view: "live",
  slots: {},
  analysis: null,
  tape: null,
  busy: false,
  pending: false,
  error: null,
  history: [],
  kzWatch: true,
  alarmOn: true,
  radar: [],
  kzAlerts: [],
  lastScanCandle: 0,
  llmCalls: 0,
  audit: [],
  riskBook: DEFAULT_RISK,
  setPair: (pair) => set({ pair }),
  selectPair: (pair) =>
    set({ pair, analysis: null, error: null, tape: null, lastScanCandle: 0 }),
  setNotes: (notes) => set({ notes }),
  setView: (view) => set({ view }),
  setSlot: (tf, slot) => {
    const prev = get().slots[tf];
    if (prev?.preview) URL.revokeObjectURL(prev.preview);
    set({ slots: { ...get().slots, [tf]: slot } });
  },
  clearSlot: (tf) => {
    const prev = get().slots[tf];
    if (prev?.preview) URL.revokeObjectURL(prev.preview);
    const next = { ...get().slots };
    delete next[tf];
    set({ slots: next });
  },
  swapSlots: (a, b) => {
    if (a === b) return;
    const next = { ...get().slots };
    const av = next[a];
    const bv = next[b];
    if (av) next[b] = av;
    else delete next[b];
    if (bv) next[a] = bv;
    else delete next[a];
    set({ slots: next });
  },
  clearAll: () => {
    for (const slot of Object.values(get().slots)) {
      if (slot?.preview) URL.revokeObjectURL(slot.preview);
    }
    set({ slots: {}, analysis: null, error: null, pending: false });
  },
  setBusy: (busy) => set({ busy }),
  setPending: (pending) => set({ pending }),
  setError: (error) => set({ error }),
  setTape: (tape) => set({ tape }),
  setKzWatch: (on) => {
    try {
      localStorage.setItem(WATCH_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ kzWatch: on });
  },
  setAlarmOn: (on) => {
    try {
      localStorage.setItem(ALARM_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ alarmOn: on });
  },
  setRadar: (radar) => set({ radar }),
  pushKzAlert: (alert) => {
    const kzAlerts = [alert, ...get().kzAlerts.filter((a) => a.id !== alert.id)].slice(0, 20);
    writeJson(ALERTS_KEY, kzAlerts);
    set({ kzAlerts });
  },
  markScan: (closedAt, usedLlm) =>
    set({ lastScanCandle: closedAt, llmCalls: get().llmCalls + (usedLlm ? 1 : 0) }),
  hydrateHistory: () => {
    const watch = typeof window !== "undefined" ? localStorage.getItem(WATCH_KEY) : null;
    const alarm = typeof window !== "undefined" ? localStorage.getItem(ALARM_KEY) : null;
    const audit = readJson<Partial<AuditRow>[]>(AUDIT_KEY, []).map((r) =>
      normalizeAudit({ pair: r.pair ?? "UNKNOWN", ...r }),
    );
    const riskBook = { ...DEFAULT_RISK, ...readJson<Partial<RiskBook>>(RISK_KEY, {}) };
    set({
      history: readJson<HistoryRow[]>(HISTORY_KEY, []).slice(0, 16),
      kzAlerts: readJson<KzAlert[]>(ALERTS_KEY, []).slice(0, 20),
      kzWatch: watch === null || watch === "1",
      alarmOn: alarm === null || alarm === "1",
      audit: audit.slice(0, 80),
      riskBook,
    });
  },
  setAnalysis: (analysis, opts) => {
    if (!analysis) {
      set({ analysis: null });
      return;
    }
    const logHistory = opts?.history ?? analysis.verdict !== "STAND_ASIDE";
    if (!logHistory) {
      set({ analysis, error: null });
      return;
    }
    const history: HistoryRow[] = [
      {
        id: `${Date.now()}`,
        at: Date.now(),
        pair: analysis.pair,
        verdict: analysis.verdict,
        confidence: analysis.confidence,
        entry: analysis.entry,
        stopLoss: analysis.stopLoss,
        takeProfit1: analysis.takeProfit1,
      },
      ...get().history,
    ].slice(0, 16);
    writeJson(HISTORY_KEY, history);
    set({ analysis, history, error: null });
  },
  pushAudit: (row) => {
    const prev = get().audit;
    const exists = prev.find((r) => r.id === row.id);
    if (exists && exists.outcome !== "open") return;
    const isNewTrade = !exists && row.verdict !== "STAND_ASIDE" && (row.size === "full" || row.size === "half");
    const riskBook = isNewTrade ? bookAfterSignal(get().riskBook, row.size, true) : get().riskBook;
    const audit = [row, ...prev.filter((r) => r.id !== row.id)].slice(0, 80);
    writeJson(AUDIT_KEY, audit);
    writeJson(RISK_KEY, riskBook);
    set({ audit, riskBook });
  },
  markAudit: (id, outcome) => {
    const row = get().audit.find((r) => r.id === id);
    if (!row || row.outcome === outcome) return;
    const riskBook = applyOutcomeToBook(get().riskBook, row.size, outcome);
    const audit = get().audit.map((r) => (r.id === id ? { ...r, outcome } : r));
    writeJson(AUDIT_KEY, audit);
    writeJson(RISK_KEY, riskBook);
    set({ audit, riskBook });
  },
  tickMissed: (pair, mark) => {
    let changed = false;
    const audit = get().audit.map((row) => {
      if (row.pair !== pair) return row;
      const live = rMultipleOf(row, mark);
      if (live == null) return row;
      if (isMissed2R({ ...row, rMultiple: live }, mark) && row.outcome === "open") {
        changed = true;
        return { ...row, outcome: "missed_2r" as const, rMultiple: live };
      }
      if (live !== row.rMultiple) {
        changed = true;
        return { ...row, rMultiple: live };
      }
      return row;
    });
    if (!changed) return;
    writeJson(AUDIT_KEY, audit);
    set({ audit });
  },
  chartPayloads: () =>
    (["4H", "1H", "15M", "1M"] as Timeframe[])
      .map((tf) => {
        const slot = get().slots[tf];
        return slot ? { tf, mime: slot.mime, data: slot.data } : null;
      })
      .filter((x): x is { tf: Timeframe; mime: string; data: string } => !!x),
}));
