import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { compactPair } from "@/lib/desk/format";
import { sessionLevels } from "@/lib/desk/ict";
import { useDesk } from "@/lib/desk/store";
import type { Candle } from "@/lib/desk/types";
import { LevelsRail } from "./levels-rail";

const TV_TF = [
  { id: "1", label: "1m" },
  { id: "15", label: "15m" },
  { id: "60", label: "1H" },
  { id: "240", label: "4H" },
];
const TV_VENUE = [
  { id: "BINANCE", label: "Binance" },
  { id: "OKX", label: "OKX" },
  { id: "HYPERLIQUID", label: "Hyperliquid" },
];

function tvSymbol(pair: string, venue: string) {
  const n = pair.toUpperCase().replace(/[^A-Z0-9]/g, "") || "HYPEUSDT";
  const base = n.endsWith("USDT") ? n.slice(0, -4) : n;
  if (venue === "HYPERLIQUID") return `HYPERLIQUID:${base}USD`;
  if (venue === "OKX") return `OKX:${base}USDT.P`;
  return `BINANCE:${base}USDT.P`;
}

export function DeskChart() {
  const pair = useDesk((s) => s.pair);
  const tape = useDesk((s) => s.tape);
  const [mode, setMode] = useState<"desk" | "tv">("desk");
  const [tf, setTf] = useState("15");
  const [venue, setVenue] = useState("BINANCE");
  const [focusPx, setFocusPx] = useState<number | null>(null);
  const symbol = tvSymbol(pair, venue);
  const src = useMemo(
    () =>
      `https://www.tradingview.com/widgetembed/?${new URLSearchParams({
        symbol,
        interval: tf,
        theme: "dark",
        style: "1",
        timezone: "America/New_York",
        locale: "en",
        toolbarbg: "0B0D10",
        hideideas: "1",
        withdateranges: "1",
        hidevolume: "0",
        hide_legend: "0",
        hide_side_toolbar: "1",
        allow_symbol_change: "1",
        saveimage: "1",
        backgroundColor: "#0B0D10",
        gridColor: "rgba(232,234,237,0.06)",
      }).toString()}`,
    [symbol, tf],
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">
            {mode === "desk" ? "Desk 15m · OKX" : "TradingView"}
          </p>
          <p className="font-mono text-xs text-fg">{mode === "desk" ? pair : symbol}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <div className="mr-1 flex rounded-md border border-border bg-elevated p-0.5">
            <button
              type="button"
              onClick={() => setMode("desk")}
              className={cn("h-8 px-2.5 text-xs", mode === "desk" ? "rounded-sm bg-fg text-bg" : "text-muted")}
            >
              Desk
            </button>
            <button
              type="button"
              onClick={() => setMode("tv")}
              className={cn("h-8 px-2.5 text-xs", mode === "tv" ? "rounded-sm bg-fg text-bg" : "text-muted")}
            >
              TradingView
            </button>
          </div>
          {mode === "tv" ? (
            <>
              {TV_VENUE.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVenue(v.id)}
                  className={cn("h-8 rounded-sm px-2 text-xs", venue === v.id ? "bg-elevated text-fg" : "text-muted hover:text-fg")}
                >
                  {v.label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              {TV_TF.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setTf(v.id)}
                  className={cn("h-8 rounded-sm px-2 font-mono text-xs", tf === v.id ? "bg-fg text-bg" : "text-muted hover:text-fg")}
                >
                  {v.label}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>
      <div className="grid h-[280px] grid-cols-[minmax(0,1fr)_52px] bg-bg md:h-[380px]">
        {mode === "tv" ? (
          <iframe title="TradingView chart" src={src} className="h-full w-full border-0" allow="fullscreen" />
        ) : (
          <CandleChart candles={tape?.candles ?? []} focusPx={focusPx} />
        )}
        <LevelsRail onFocus={setFocusPx} />
      </div>
    </section>
  );
}

export function CandleChart({
  candles,
  focusPx,
  compact,
}: {
  candles: Candle[];
  focusPx?: number | null;
  compact?: boolean;
}) {
  if (candles.length < 4) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Waiting for 15m candles…</div>;
  }
  const shown = candles.slice(-80);
  const pad = { t: 12, r: compact ? 8 : 56, b: 12, l: 8 };
  const w = 720 - pad.l - pad.r;
  const h = 280 - pad.t - pad.b;
  let hi = Math.max(...shown.map((c) => c.high));
  let lo = Math.min(...shown.map((c) => c.low));
  if (focusPx && focusPx > 0) {
    const band = Math.max((hi - lo) * 0.18, focusPx * 0.008);
    hi = focusPx + band;
    lo = focusPx - band;
  }
  const span = hi - lo || 1;
  const bw = w / shown.length;
  const y = (px: number) => pad.t + (1 - (px - lo) / span) * h;
  const last = shown[shown.length - 1];
  const levels = sessionLevels(candles);
  const guides = [
    { px: levels.asiaHigh, label: "AH", cls: "stroke-warn/70" },
    { px: levels.asiaLow, label: "AL", cls: "stroke-warn/70" },
    { px: levels.pdh, label: "PDH", cls: "stroke-accent/50" },
    { px: levels.pdl, label: "PDL", cls: "stroke-accent/50" },
  ].filter((g) => g.px != null) as { px: number; label: string; cls: string }[];
  const ticks = [hi, lo + span * 0.5, lo];

  return (
    <svg viewBox="0 0 720 280" className="h-full w-full" role="img" aria-label="15 minute candles">
      {ticks.map((px) => (
        <g key={px}>
          <line x1={pad.l} x2={720 - pad.r} y1={y(px)} y2={y(px)} className="stroke-border" strokeWidth="1" />
          {compact ? null : (
            <text
              x={720 - pad.r + 6}
              y={y(px) + 4}
              className="fill-subtle"
              fontSize="10"
              fontFamily="IBM Plex Mono, ui-monospace, monospace"
            >
              {px >= 100 ? px.toFixed(2) : px.toFixed(3)}
            </text>
          )}
        </g>
      ))}
      {guides.map((g) => (
        <g key={g.label}>
          <line
            x1={pad.l}
            x2={720 - pad.r}
            y1={y(g.px)}
            y2={y(g.px)}
            className={g.cls}
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        </g>
      ))}
      {shown.map((c, i) => {
        const x = pad.l + i * bw + bw * 0.5;
        const up = c.close >= c.open;
        const top = y(Math.max(c.open, c.close));
        const bot = y(Math.min(c.open, c.close));
        const body = Math.max(1.2, bw * 0.62);
        return (
          <g key={c.t} className={up ? "stroke-long fill-long" : "stroke-short fill-short"}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} strokeWidth="1" />
            <rect x={x - body / 2} y={top} width={body} height={Math.max(1, bot - top)} />
          </g>
        );
      })}
      <line
        x1={pad.l}
        x2={720 - pad.r}
        y1={y(last.close)}
        y2={y(last.close)}
        className="stroke-fg/50"
        strokeDasharray="3 3"
      />
      {focusPx ? (
        <line
          x1={pad.l}
          x2={720 - pad.r}
          y1={y(focusPx)}
          y2={y(focusPx)}
          className="stroke-warn"
          strokeWidth="1.5"
        />
      ) : null}
    </svg>
  );
}

export function Heatmap() {
  const pair = useDesk((s) => s.pair);
  const tape = useDesk((s) => s.tape);
  const [mode, setMode] = useState<"desk" | "coinglass">("desk");
  const href = `https://www.coinglass.com/pro/futures/LiquidationHeatMap?coin=${compactPair(pair)}`;
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">Liquidation heatmap</p>
          <h2 className="text-sm font-medium text-fg">
            {mode === "desk" ? "OKX fills + book + leverage" : "CoinGlass"}
          </h2>
        </div>
        <div className="flex rounded-md border border-border bg-elevated p-0.5">
          <button
            type="button"
            onClick={() => setMode("desk")}
            className={cn("h-8 px-2.5 text-xs", mode === "desk" ? "rounded-sm bg-fg text-bg" : "text-muted")}
          >
            Desk
          </button>
          <button
            type="button"
            onClick={() => setMode("coinglass")}
            className={cn("h-8 px-2.5 text-xs", mode === "coinglass" ? "rounded-sm bg-fg text-bg" : "text-muted")}
          >
            CoinGlass
          </button>
        </div>
      </div>
      {mode === "coinglass" ? (
        <div className="h-[420px] bg-bg">
          <iframe title="CoinGlass liquidation heatmap" src={href} className="h-full w-full border-0" />
        </div>
      ) : (
        <HeatmapViz />
      )}
      {tape && mode === "desk" && tape.clusters.length > 0 ? (
        <ul className="grid grid-cols-2 gap-px border-t border-border bg-border">
          {tape.clusters.slice(0, 4).map((c) => (
            <li key={`${c.kind}-${c.px}`} className="bg-surface px-3 py-2.5">
              <p className="font-mono text-micro uppercase tracking-label text-subtle">{c.kind.replace(/-/g, " ")}</p>
              <p className="font-mono text-sm tabular-nums text-fg">
                {c.px >= 1000 ? c.px.toFixed(1) : c.px >= 100 ? c.px.toFixed(2) : c.px.toFixed(3)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function HeatmapViz() {
  const tape = useDesk((s) => s.tape);
  if (!tape?.bands.length) {
    return <div className="flex h-[320px] items-center justify-center text-sm text-muted">Building heatmap…</div>;
  }
  const mark = tape.mark;
  const maxI = Math.max(...tape.bands.map((b) => b.intensity), 0.001);
  const top = tape.bands[0].px;
  const bot = tape.bands[tape.bands.length - 1].px;
  return (
    <div className="grid grid-cols-[1fr_52px] gap-0 p-3">
      <div className="relative h-[320px] overflow-hidden rounded-sm bg-bg">
        {tape.bands.map((b, i) => {
          const longShare = b.longLiq / (b.longLiq + b.shortLiq + 1);
          const a = b.intensity / maxI;
          return (
            <div
              key={i}
              className={cn("absolute inset-x-0", longShare > 0.55 ? "bg-long" : "bg-short")}
              style={{
                top: `${(i / tape.bands.length) * 100}%`,
                height: `${100 / tape.bands.length}%`,
                opacity: a * 0.88,
              }}
            />
          );
        })}
        <div
          className="absolute inset-x-0 z-10 border-t border-fg/80"
          style={{ top: `${((top - mark) / (top - bot || 1)) * 100}%` }}
        />
      </div>
      <div className="relative h-[320px] pl-2">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const px = top - t * (top - bot);
          return (
            <p
              key={t}
              className="absolute font-mono text-micro tabular-nums text-subtle"
              style={{ top: `calc(${t * 100}% - 6px)` }}
            >
              {px >= 1000 ? px.toFixed(1) : px >= 100 ? px.toFixed(2) : px.toFixed(3)}
            </p>
          );
        })}
      </div>
    </div>
  );
}
