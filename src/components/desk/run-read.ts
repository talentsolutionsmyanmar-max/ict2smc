import { toast } from "sonner";
import { fireTradeAlarm } from "@/lib/desk/alarm";
import { barTape, closedBars } from "@/lib/desk/ict";
import { mechanicalRead, mergeGrok, tapePrompt } from "@/lib/desk/mechanical";
import { auditFrom, openRiskOf } from "@/lib/desk/regime";
import { loadTape } from "@/lib/desk/load-tape";
import { analyzeTapeFn, analyzeVisionFn, mechFlags } from "@/lib/desk/server/fns";
import { useDesk } from "@/lib/desk/store";
import type { Analysis, Tape, Timeframe } from "@/lib/desk/types";

const MAX_B64 = 420000;

function trimCharts(charts: { tf: Timeframe; mime: string; data: string }[]) {
  const drop: Timeframe[] = ["1H", "1M"];
  let next = [...charts];
  let size = next.reduce((s, c) => s + c.data.length, 0);
  while (size > MAX_B64 && drop.length) {
    const tf = drop.shift();
    next = next.filter((c) => c.tf !== tf);
    size = next.reduce((s, c) => s + c.data.length, 0);
  }
  if (next.length > 2) {
    const keep = new Set<Timeframe>(["4H", "15M"]);
    const filtered = next.filter((c) => keep.has(c.tf));
    next = filtered.length ? filtered : next.slice(0, 2);
  }
  return next;
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(id);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function freshTape(symbol: string): Promise<Tape | null> {
  const current = useDesk.getState().tape;
  const key = symbol.replace(/[^A-Z0-9]/g, "");
  if (current && current.symbol.replace(/[^A-Z0-9]/g, "") === key && Date.now() - current.at < 45000) {
    return current;
  }
  const tape = await loadTape(symbol);
  if (tape) {
    useDesk.getState().setTape(tape);
    return tape;
  }
  return current;
}

function commit(analysis: Analysis, tape: Tape, toastIt: boolean) {
  const state = useDesk.getState();
  state.setAnalysis(analysis, { history: analysis.verdict !== "STAND_ASIDE" || analysis.source !== "mechanical" });
  const row = auditFrom(analysis, tape);
  if (row) state.pushAudit(row);
  if (analysis.closedAt) state.markScan(analysis.closedAt, analysis.source !== "mechanical");
  if (!toastIt) return;
  if (analysis.verdict === "STAND_ASIDE") {
    if (analysis.wouldHaveBeen) toast.message(`Would-have-been · ${analysis.missingPriority}`);
    else toast.message(`Stand aside · ${analysis.missingPriority}`);
    return;
  }
  const tag = analysis.source === "mechanical" ? "kz-v2" : analysis.source === "vision" ? "vision" : "Grok tape";
  toast.success(`${analysis.verdict} · ${analysis.size} ${analysis.riskPct}% · ${tag}`);
  fireTradeAlarm(analysis);
}

async function grokTape(pair: string, notes: string, tape: Tape, mech: Analysis): Promise<Analysis> {
  const raid = mechFlags(tape);
  try {
    const res = await withTimeout(
      analyzeTapeFn({
        data: {
          pair,
          notes,
          tape: tapePrompt(tape),
          bars15: barTape(tape.candles, 48),
          bars1h: tape.h1?.length ? barTape(tape.h1, 36) : undefined,
          bars4h: tape.h4?.length ? barTape(tape.h4, 30) : undefined,
          mech: raid,
        },
      }),
      16000,
    );
    if (res?.ok) return mergeGrok(mech, res.analysis);
  } catch {
    /* fall through */
  }
  return mech;
}

export async function runRead(opts?: { forceLlm?: boolean; fromClose?: boolean }) {
  const state = useDesk.getState();
  const charts = trimCharts(state.chartPayloads());
  if (state.busy) return;
  state.setBusy(true);
  state.setError(null);
  state.setPending(false);
  const silent = !!opts?.fromClose && !opts?.forceLlm && !charts.length;
  try {
    const tape = await freshTape(state.pair);
    const tapeText = tape ? tapePrompt(tape) : "";
    const pair = state.pair.trim() || "UNKNOWN";
    const openRisk = openRiskOf(state.audit);
    const mech = tape?.candles.length ? mechanicalRead(tape, pair, state.riskBook, state.notes, openRisk) : null;

    if (charts.length) {
      try {
        const res = await withTimeout(
          analyzeVisionFn({
            data: {
              pair,
              notes: state.notes,
              tape: tapeText || undefined,
              charts,
            },
          }),
          22000,
        );
        if (res?.ok && tape) {
          commit(mech ? mergeGrok(mech, res.analysis) : res.analysis, tape, true);
          return;
        }
        if (res?.ok && !tape) {
          state.setAnalysis(res.analysis, { history: true });
          toast.success(`${res.analysis.verdict.replace("_", " ")} · ${res.analysis.confidence}%`);
          return;
        }
      } catch {
        /* vision timed out */
      }
    }

    if (tape?.candles.length && mech) {
      const analysis =
        opts?.forceLlm || charts.length ? await grokTape(pair, state.notes, tape, mech) : mech;
      commit(analysis, tape, !silent || analysis.verdict !== "STAND_ASIDE" || analysis.wouldHaveBeen);
      return;
    }

    const msg = charts.length
      ? "Vision timed out and live tape is empty. Wait a beat and tap Translate."
      : "Waiting on live 15m tape. Keep this tab open.";
    state.setError(msg);
    if (!silent) toast.error(msg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed.";
    const tape = useDesk.getState().tape;
    if (tape?.candles.length) {
      const mech = mechanicalRead(tape, state.pair.trim() || "UNKNOWN", state.riskBook, state.notes, openRiskOf(useDesk.getState().audit));
      commit(mech, tape, !silent);
      return;
    }
    state.setError(msg);
    if (!silent) toast.error(msg);
  } finally {
    useDesk.getState().setBusy(false);
  }
}

export function slotFingerprint(slots: Record<string, { data?: string } | undefined>) {
  return (["4H", "1H", "15M", "1M"] as Timeframe[]).map((tf) => slots[tf]?.data?.slice(0, 48) ?? "").join(":");
}

export function lastClosedKey(tape: Tape, pair: string) {
  const bars = closedBars(tape.candles);
  const last = bars[bars.length - 1];
  return last ? `${pair}:${last.t}` : "";
}
