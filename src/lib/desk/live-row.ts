import { G } from "./format";
import type { Analysis, RadarHit, Verdict } from "./types";

/** Only a live LONG/SHORT is a side. STAND_ASIDE is never coerced to LONG. */
export function liveSide(verdict: Verdict): "LONG" | "SHORT" | null {
  return verdict === "LONG" || verdict === "SHORT" ? verdict : null;
}

export function formatLiveHeadline(opts: { verdict: Verdict; mark: number; entry?: string }): string {
  const side = liveSide(opts.verdict);
  if (!side) return "NO TRADE";
  const raw = (opts.entry || "").trim();
  const px = raw && raw !== "—" ? raw : G(opts.mark);
  return `${side} @ ${px}`;
}

export function formatLiveNote(opts: { verdict: Verdict; sequence: string; missingPriority: string }): string {
  if (opts.verdict === "STAND_ASIDE") return opts.missingPriority || opts.sequence || "Sequence incomplete";
  return opts.sequence || "Sequence complete";
}

export function toRadarHit(analysis: Analysis, mark: number, changePct: number): RadarHit {
  return {
    pair: analysis.pair,
    mark,
    changePct,
    verdict: analysis.verdict,
    side: liveSide(analysis.verdict),
    size: analysis.size,
    riskPct: analysis.riskPct,
    entry: analysis.verdict === "STAND_ASIDE" ? "—" : analysis.entry,
    stopLoss: analysis.verdict === "STAND_ASIDE" ? "—" : analysis.stopLoss,
    sequence: analysis.sequence,
    missingPriority: analysis.missingPriority,
    closedAt: analysis.closedAt,
    bias4h: analysis.bias4h,
    window: analysis.window,
    overrideReady: analysis.overrideReady,
    confidence: analysis.verdict === "STAND_ASIDE" ? Math.min(analysis.confidence, 36) : analysis.confidence,
  };
}
