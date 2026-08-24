import { useEffect, useState } from "react";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";
import { fetchWatchlistFn } from "@/lib/desk/server/fns";
import { useDesk } from "@/lib/desk/store";
import type { TickerRow } from "@/lib/desk/types";

function fmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(3);
}

export function Watchlist() {
  const pair = useDesk((s) => s.pair);
  const selectPair = useDesk((s) => s.selectPair);
  const radar = useDesk((s) => s.radar);
  const [rows, setRows] = useState<TickerRow[]>([]);
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    let dead = false;
    async function pull() {
      const res = await fetchWatchlistFn();
      if (dead) return;
      if (res.ok) {
        setRows(res.tickers);
        setDelayed(false);
      } else setDelayed(true);
    }
    void pull();
    const id = window.setInterval(() => void pull(), 20000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-fg">Majors radar</h2>
        <p className="font-mono text-micro uppercase tracking-label text-subtle">
          {radar.filter((r) => r.verdict === "LONG" || r.verdict === "SHORT").length
            ? `${radar.filter((r) => r.verdict === "LONG" || r.verdict === "SHORT").length} live`
            : "all pairs"}
        </p>
      </div>
      <ul className="space-y-1">
        {rows.length === 0 ? <li className="py-6 text-center text-sm text-muted">Waiting for tape…</li> : null}
        {rows.map((row) => {
          const full = `${row.symbol}USDT`;
          const active = pair.toUpperCase().includes(row.symbol);
          const up = row.changePct >= 0;
          const hit = radar.find((r) => r.pair.toUpperCase().startsWith(row.symbol));
          const live = hit && (hit.verdict === "LONG" || hit.verdict === "SHORT");
          return (
            <li key={row.symbol}>
              <button
                type="button"
                onClick={() => selectPair(full)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between rounded-md px-3 py-2.5 text-left",
                  active ? "bg-elevated" : "hover:bg-elevated/60",
                )}
              >
                <span className="font-mono text-sm">{row.symbol}</span>
                <span className="flex items-baseline gap-2 font-mono text-sm tabular-nums">
                  {hit ? (
                    <Badge tone={live ? (hit.verdict === "LONG" ? "long" : "short") : "neutral"}>
                      {hit.verdict === "STAND_ASIDE" ? "ASIDE" : hit.verdict}
                    </Badge>
                  ) : null}
                  <span>{fmt(row.price)}</span>
                  <span className={up ? "text-long" : "text-short"}>
                    {up ? "+" : ""}
                    {row.changePct.toFixed(2)}%
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
