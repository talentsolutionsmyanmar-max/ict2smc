import { cn } from "@/lib/utils";
import { fmtNotional, fmtPx, fmtUsd } from "@/lib/desk/format";
import { useDesk } from "@/lib/desk/store";
import type { BookLevel } from "@/lib/desk/types";

function notional(l: BookLevel) {
  return l.px * l.sz;
}
function medianN(levels: BookLevel[]) {
  if (!levels.length) return 1;
  const t = levels.map(notional).sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)] || 1;
}
function isWall(l: BookLevel, med: number) {
  return notional(l) > 2.2 * med;
}
function biggest(levels: BookLevel[]) {
  if (!levels.length) return null;
  return levels.reduce((a, b) => (notional(b) > notional(a) ? b : a));
}
function hvns(profile: { px: number; vol: number }[], n = 4) {
  const max = Math.max(1, ...profile.map((p) => p.vol));
  return [...profile]
    .filter((p) => p.vol > max * 0.45)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, n);
}

export function OrderBook() {
  const tape = useDesk((s) => s.tape);
  if (!tape?.bids.length && !tape?.asks.length) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">DOM · order book</p>
        <p className="mt-2 text-sm text-muted">Waiting on live book…</p>
      </section>
    );
  }
  const bids = tape.bids;
  const asks = tape.asks;
  const med = medianN([...bids, ...asks]);
  const maxN = Math.max(1, ...bids.map(notional), ...asks.map(notional));
  const imb = tape.imbalance ?? 50;
  const bidWall = tape.bidWall ?? biggest(bids);
  const askWall = tape.askWall ?? biggest(asks);
  const nodes = hvns(tape.profile ?? []);
  const askRows = [...asks].slice(0, 14).reverse();
  const bidRows = bids.slice(0, 14);
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">DOM · {tape.venue} book</p>
          <h2 className="text-sm font-medium text-fg">High volume both sides</h2>
        </div>
        <p className={cn("font-mono text-xs tabular-nums", imb >= 54 ? "text-long" : imb <= 46 ? "text-short" : "text-muted")}>
          {imb.toFixed(0)}% bids
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
        <Wall label="Bid wall" level={bidWall} tone="long" />
        <Wall label="Ask wall" level={askWall} tone="short" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_52px] gap-0 p-3">
        <div className="font-mono text-micro tabular-nums">
          {askRows.map((l) => (
            <Row key={`a-${l.px}`} level={l} side="ask" maxN={maxN} median={med} />
          ))}
          <div className="my-1 flex items-center justify-between rounded-sm bg-elevated px-2 py-1.5">
            <span className="text-subtle">Mark</span>
            <span className="text-fg">{fmtPx(tape.mark)}</span>
          </div>
          {bidRows.map((l) => (
            <Row key={`b-${l.px}`} level={l} side="bid" maxN={maxN} median={med} />
          ))}
        </div>
        <ProfileStrip profile={tape.profile ?? []} mark={tape.mark} />
      </div>
      {nodes.length > 0 ? (
        <ul className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {nodes.map((n) => (
            <li key={n.px} className="rounded-sm border border-border bg-elevated px-2 py-1 font-mono text-micro text-fg">
              HVN {fmtPx(n.px)}
              <span className="text-subtle"> {n.px >= tape.mark ? "above" : "below"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted">
        Walls are resting size, not trades. A bid wall under price is support until it pulls; an ask wall above is offer
        until it lifts. High-volume nodes (HVN) are where 15m volume clustered — magnet for pullbacks, not an entry by
        themselves. Read with the London day, not against it.
      </p>
    </section>
  );
}

function Wall({
  label,
  level,
  tone,
}: {
  label: string;
  level: BookLevel | null;
  tone: "long" | "short";
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="font-mono text-micro uppercase tracking-label text-subtle">{label}</p>
      {level ? (
        <>
          <p className={cn("mt-1 font-mono text-sm tabular-nums", tone === "long" ? "text-long" : "text-short")}>
            {fmtPx(level.px)}
          </p>
          <p className="font-mono text-micro text-subtle">{fmtNotional(notional(level))}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">—</p>
      )}
    </div>
  );
}

function Row({
  level,
  side,
  maxN,
  median,
}: {
  level: BookLevel;
  side: "bid" | "ask";
  maxN: number;
  median: number;
}) {
  const n = notional(level);
  const wall = isWall(level, median);
  const w = Math.max(4, (n / maxN) * 100);
  const ask = side === "ask";
  return (
    <div className={cn("relative flex h-7 items-center justify-between overflow-hidden px-2", wall && "bg-elevated")}>
      <span
        className={cn("absolute inset-y-0", ask ? "right-0 bg-short/25" : "left-0 bg-long/25")}
        style={{ width: `${w}%` }}
      />
      <span className={cn("relative", ask ? "text-short" : "text-long")}>{fmtPx(level.px)}</span>
      <span className="relative text-muted">
        {wall ? "WALL " : ""}
        {fmtNotional(n)}
      </span>
    </div>
  );
}

function ProfileStrip({ profile, mark }: { profile: { px: number; vol: number }[]; mark: number }) {
  if (profile.length < 4) return <div />;
  const max = Math.max(1, ...profile.map((p) => p.vol));
  const top = profile[profile.length - 1].px;
  const span = top - profile[0].px || 1;
  return (
    <div className="relative ml-1 h-full min-h-[280px] rounded-sm bg-bg">
      {profile.map((p) => {
        const o = (top - p.px) / span;
        return (
          <span
            key={p.px}
            className={cn("absolute right-0", p.px >= mark ? "bg-short/50" : "bg-long/50")}
            style={{ top: `${o * 100}%`, height: `${100 / profile.length}%`, width: `${(p.vol / max) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

export function OrderFlow({ compact = false }: { compact?: boolean }) {
  const tape = useDesk((s) => s.tape);
  if (!tape) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">Order flow</p>
        <p className="mt-2 text-sm text-muted">Waiting for OI / CVD / funding…</p>
      </section>
    );
  }
  const up = tape.changePct >= 0;
  const cells = [
    {
      k: "Mark",
      v: fmtPx(tape.mark),
      extra: `${up ? "+" : ""}${tape.changePct.toFixed(2)}%`,
      tone: up ? "text-long" : "text-short",
    },
    { k: "Open interest", v: fmtUsd(tape.oiUsd), extra: tape.venue, tone: "text-fg" },
    {
      k: "Funding 8h",
      v: `${(tape.funding * 100).toFixed(4)}%`,
      extra: tape.funding >= 0 ? "longs pay" : "shorts pay",
      tone: tape.funding > 3e-4 ? "text-short" : tape.funding < -3e-4 ? "text-long" : "text-fg",
    },
    {
      k: "Taker buy",
      v: `${tape.takerBuyPct.toFixed(1)}%`,
      extra: "last hour",
      tone: tape.takerBuyPct >= 50 ? "text-long" : "text-short",
    },
  ];
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">Orion-style tape · {tape.symbol}</p>
        <h2 className="text-sm font-medium text-fg">OI · CVD · funding · book</h2>
      </div>
      <div className={cn("grid gap-px bg-border", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
        {cells.map((c) => (
          <div key={c.k} className="bg-surface px-4 py-3">
            <p className="font-mono text-micro uppercase tracking-label text-subtle">{c.k}</p>
            <p className={cn("mt-1 font-mono text-sm tabular-nums", c.tone)}>{c.v}</p>
            <p className="font-mono text-micro text-subtle">{c.extra}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">CVD · 5m taker delta</p>
          <CvdSpark points={tape.cvdPoints} />
          <p className={cn("mt-1 font-mono text-xs tabular-nums", tape.cvd >= 0 ? "text-long" : "text-short")}>
            {tape.cvd >= 0 ? "+" : ""}
            {fmtUsd(Math.abs(tape.cvd)).replace("$", "")} net
          </p>
        </div>
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">Book · top of book</p>
          <MiniBook bids={tape.bids} asks={tape.asks} />
        </div>
      </div>
      <p className="border-t border-border px-4 py-3 text-sm leading-relaxed text-muted">{tape.read}</p>
      {tape.recentLiqs.length > 0 && !compact ? (
        <ul className="border-t border-border px-4 py-3">
          <li className="mb-2 font-mono text-micro uppercase tracking-label text-subtle">Recent liquidations</li>
          {tape.recentLiqs.slice(0, 5).map((l, i) => (
            <li key={`${l.ts}-${i}`} className="flex items-center justify-between py-1 font-mono text-xs tabular-nums">
              <span className={l.side === "long" ? "text-short" : "text-long"}>
                {l.side === "long" ? "Long liq" : "Short liq"}
              </span>
              <span className="text-fg">{fmtPx(l.px)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CvdSpark({ points }: { points: { t: number; cvd: number }[] }) {
  if (points.length < 2) return <div className="h-16 text-sm text-muted">No CVD yet</div>;
  const ys = points.map((p) => p.cvd);
  const min = Math.min(...ys);
  const span = Math.max(...ys) - min || 1;
  const d = ys
    .map((v, i) => {
      const x = (i / (ys.length - 1)) * 280;
      const y = 4 + (1 - (v - min) / span) * 56;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const up = ys[ys.length - 1] >= ys[0];
  return (
    <svg viewBox="0 0 280 64" className={cn("mt-2 h-16 w-full", up ? "text-long" : "text-short")} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MiniBook({ bids, asks }: { bids: BookLevel[]; asks: BookLevel[] }) {
  const b = bids.slice(0, 6);
  const a = asks.slice(0, 6);
  const max = Math.max(1, ...b.map((l) => l.sz), ...a.map((l) => l.sz));
  const n = Math.min(6, b.length, a.length);
  return (
    <div className="mt-2 font-mono text-micro tabular-nums">
      {Array.from({ length: n }, (_, i) => {
        const ask = a[i];
        const bid = b[i];
        return (
          <div key={i} className="grid grid-cols-2 gap-2 py-0.5">
            <div className="relative overflow-hidden text-long">
              <span className="absolute inset-y-0 right-0 bg-long/20" style={{ width: `${((bid?.sz ?? 0) / max) * 100}%` }} />
              <span className="relative">{bid ? fmtPx(bid.px) : "—"}</span>
            </div>
            <div className="relative overflow-hidden text-right text-short">
              <span className="absolute inset-y-0 left-0 bg-short/20" style={{ width: `${((ask?.sz ?? 0) / max) * 100}%` }} />
              <span className="relative">{ask ? fmtPx(ask.px) : "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
