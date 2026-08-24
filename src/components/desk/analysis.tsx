import { Check, Minus, X } from "lucide-react";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";
import { useDesk } from "@/lib/desk/store";
import type { SizeKind, WindowKind } from "@/lib/desk/types";

const TONE = { LONG: "long", SHORT: "short", STAND_ASIDE: "warn" } as const;

function sourceLabel(source: string, model: string) {
  if (source === "vision") return "Vision";
  if (source === "tape") return "Live 15m · Grok";
  if (model === "kz-v2") return "kz-v2 mechanical";
  if (source === "mechanical") return "Live 15m · mechanical";
  return "Casper";
}

function windowTone(w: WindowKind): "live" | "warn" | "neutral" {
  if (w === "primary") return "live";
  if (w === "override" || w === "secondary") return "warn";
  return "neutral";
}

function sizeTone(s: SizeKind): "live" | "warn" | "neutral" {
  if (s === "full") return "live";
  if (s === "half") return "warn";
  return "neutral";
}

export function AnalysisCard() {
  const analysis = useDesk((s) => s.analysis);
  const error = useDesk((s) => s.error);
  const busy = useDesk((s) => s.busy);
  const pending = useDesk((s) => s.pending);

  if (busy) {
    return (
      <section className="reading-shimmer rounded-lg border border-border bg-surface p-5 md:p-6">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">Reading charts</p>
        <p className="mt-2 text-lg text-fg">Reading live 15m + charts…</p>
        <p className="mt-1 text-sm text-muted">Fast model first. If vision stalls, tape takes over — no forced setup.</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-lg border border-short/40 bg-surface p-5 md:p-6">
        <p className="font-mono text-micro uppercase tracking-label text-short">Could not read</p>
        <p className="mt-2 text-sm text-fg">{error}</p>
      </section>
    );
  }
  if (pending) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5 md:p-6">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">Queued</p>
        <h2 className="mt-2 text-xl font-medium tracking-tight text-fg">Auto-reading</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Charts just landed. The desk waits a beat, then reads them against live OI / CVD.
        </p>
      </section>
    );
  }
  if (!analysis) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5 md:p-6">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">Live desk · kz-v2</p>
        <h2 className="mt-2 text-xl font-medium tracking-tight text-fg">Auto-reading 15m tape</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Every 15m close: 4H bias, time-based sweep, Override, size. No screenshot required. Drop a 4H photo only if you
          want vision on your TradingView markup.
        </p>
      </section>
    );
  }

  const tone = TONE[analysis.verdict];
  return (
    <section className="rounded-lg border border-border bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">
            {analysis.pair} · {analysis.priceRead}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-medium tracking-tight text-fg">{analysis.verdict.replace("_", " ")}</h2>
            <Badge tone={tone}>{analysis.confidence}% confidence</Badge>
            <Badge>{sourceLabel(analysis.source, analysis.model)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={analysis.bias4h === "bullish" ? "long" : analysis.bias4h === "bearish" ? "short" : "neutral"}>
            4H {analysis.bias4h}
          </Badge>
          <Badge tone={windowTone(analysis.window)}>{analysis.killzone.session}</Badge>
          <Badge tone={analysis.regime === "trending" ? "live" : "neutral"}>
            {analysis.regime === "trending" ? "Trending" : "Range"}
          </Badge>
          <Badge tone={sizeTone(analysis.size)}>
            {analysis.size === "none" ? "No size" : `${analysis.size} ${analysis.riskPct}%`}
          </Badge>
        </div>
      </div>

      {analysis.overrideReady ? (
        <p className="mt-3 font-mono text-xs text-warn">Override Ready · clock is not a veto · half-size</p>
      ) : null}

      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-elevated px-3 py-3 font-mono text-xs leading-relaxed text-fg">
        {analysis.signalBlock}
      </pre>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">{analysis.narrative}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Entry" value={analysis.entry} />
        <Stat label="Stop" value={analysis.stopLoss} />
        <Stat label="TP1" value={analysis.takeProfit1} />
        <Stat label="TP2" value={analysis.takeProfit2} />
      </div>
      <p className="mt-3 font-mono text-xs text-muted">
        R:R {analysis.riskReward}
        {analysis.size !== "none" ? ` · ${analysis.size} ${analysis.riskPct}%` : ""}
      </p>

      {analysis.confirms.length > 0 ? (
        <div className="mt-4">
          <p className="font-mono text-micro uppercase tracking-label text-subtle">Confirms</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {analysis.confirms.map((c) => (
              <li key={c}>
                <Badge tone="live">{c}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Flag
          label="Liquidity sweep"
          flag={analysis.liquiditySweep.occurred}
          note={analysis.liquiditySweep.notes}
          extra={analysis.liquiditySweep.level}
        />
        <Flag label="MSS" flag={analysis.mss.occurred} note={analysis.mss.notes} extra={analysis.mss.timeframe} />
        <Flag label="Displacement" flag={analysis.displacement.occurred} note={analysis.displacement.notes} />
        <Flag label="FVG" flag={analysis.fvg.occurred} note={analysis.fvg.notes} extra={analysis.fvg.level} />
      </div>
      <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
        <Row k="Draw on liquidity" v={analysis.drawOnLiquidity} />
        <Row k="Premium / discount" v={analysis.premiumDiscount} />
        <Row k="1H structure" v={analysis.structure1h} />
        <Row k="15M structure" v={analysis.structure15m} />
        <Row k="1M structure" v={analysis.structure1m} />
        <Row k="Kill zone" v={`${analysis.killzone.session}${analysis.killzone.aligned ? " · aligned" : ""}`} />
        <Row k="Sequence" v={analysis.sequence} />
        <Row k="Invalidation" v={analysis.invalidation} />
      </dl>
      {analysis.checklist.length > 0 ? (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {analysis.checklist.map((c) => (
            <li key={c.id || c.label} className="flex items-start gap-2 rounded-md border border-border bg-elevated px-3 py-2.5 text-sm">
              {c.pass ? (
                <Check className="mt-0.5 size-4 shrink-0 text-long" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-short" />
              )}
              <span className={c.pass ? "text-fg" : "text-muted"}>{c.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {analysis.missing.length > 0 ? (
        <div className="mt-4">
          <p className="font-mono text-micro uppercase tracking-label text-subtle">Missing</p>
          {analysis.missingPriority ? (
            <p className="mt-2 text-sm text-warn">Priority: {analysis.missingPriority}</p>
          ) : null}
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {analysis.missing.map((m) => (
              <li key={m}>— {m}</li>
            ))}
          </ul>
        </div>
      ) : analysis.missingPriority && analysis.verdict === "STAND_ASIDE" ? (
        <p className="mt-4 text-sm text-warn">Priority: {analysis.missingPriority}</p>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-elevated px-3 py-3">
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">{label}</p>
      <p className="mt-1 font-mono text-sm tabular-nums text-fg">{value}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-micro uppercase tracking-widest text-subtle">{k}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-fg">{v}</dd>
    </div>
  );
}

function Flag({
  label,
  flag,
  note,
  extra,
}: {
  label: string;
  flag: boolean;
  note: string;
  extra?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-elevated px-3 py-3">
      <div className="flex items-center gap-2">
        {flag ? <Check className="size-4 text-long" /> : <Minus className="size-4 text-subtle" />}
        <p className="text-sm text-fg">{label}</p>
        {extra ? <span className="ml-auto font-mono text-micro text-muted">{extra}</span> : null}
      </div>
      {note ? <p className={cn("mt-1 text-xs leading-relaxed text-muted")}>{note}</p> : null}
    </div>
  );
}
