import { Badge } from "./badge";
import { cn } from "@/lib/utils";
import { compactPair, fitPx } from "@/lib/desk/format";
import { formatLiveHeadline, formatLiveNote, liveSide } from "@/lib/desk/live-row";
import { isTradePair } from "@/lib/desk/playbook";
import { useDesk } from "@/lib/desk/store";
import type { RadarHit } from "@/lib/desk/types";

function ago(ts: number) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function rowTone(hit: RadarHit) {
  const side = liveSide(hit.verdict);
  if (side === "LONG") return "long" as const;
  if (side === "SHORT") return "short" as const;
  return "neutral" as const;
}

export function SignalRow({
  hit,
  active,
  onPick,
}: {
  hit: RadarHit;
  active?: boolean;
  onPick?: (pair: string) => void;
}) {
  const side = liveSide(hit.verdict);
  const live = side !== null && isTradePair(hit.pair);
  const headline = live
    ? formatLiveHeadline({ verdict: hit.verdict, mark: hit.mark, entry: hit.entry })
    : `NO TRADE · ${fitPx(hit.mark)}`;
  const note = formatLiveNote({
    verdict: live ? hit.verdict : "STAND_ASIDE",
    sequence: hit.sequence,
    missingPriority: isTradePair(hit.pair) ? hit.missingPriority : "Watch only · BTC/ETH book",
  });
  return (
    <button
      type="button"
      onClick={() => onPick?.(hit.pair)}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left",
        active ? "bg-elevated" : "hover:bg-elevated/60",
      )}
    >
      <Badge tone={rowTone(live ? hit : { ...hit, verdict: "STAND_ASIDE" })}>{live ? side : "ASIDE"}</Badge>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-sm text-fg">{compactPair(hit.pair)}</span>
          <span className="font-mono text-micro text-subtle">{ago(hit.closedAt) || "live"}</span>
        </span>
        <span className={cn("mt-0.5 block font-mono text-sm tabular-nums", live ? (side === "SHORT" ? "text-short" : "text-long") : "text-muted")}>
          {headline}
        </span>
        <span className="mt-0.5 block truncate font-mono text-micro text-subtle">{note}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-micro text-subtle">{live ? hit.confidence : 24}%</span>
        <span className="block font-mono text-kicker uppercase tracking-label text-subtle">CONF</span>
      </span>
    </button>
  );
}

export function LiveSignals() {
  const radar = useDesk((s) => s.radar);
  const pair = useDesk((s) => s.pair);
  const selectPair = useDesk((s) => s.selectPair);
  const setPhoneScreen = useDesk((s) => s.setPhoneScreen);
  const setups = radar.filter((h) => liveSide(h.verdict) && isTradePair(h.pair));
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-2 px-4 py-3">
        <h2 className="font-mono text-micro uppercase tracking-label text-subtle">Live signals</h2>
        <p className="font-mono text-micro uppercase tracking-label text-subtle">
          {setups.length} setup{setups.length === 1 ? "" : "s"} · kz-v3
        </p>
      </div>
      {radar.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-center text-sm text-muted">Scanning majors…</p>
      ) : (
        <ul>
          {radar.map((hit) => (
            <li key={hit.pair}>
              <SignalRow
                hit={hit}
                active={pair.toUpperCase().startsWith(compactPair(hit.pair))}
                onPick={(p) => {
                  selectPair(p);
                  setPhoneScreen("pair");
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PhoneFeed() {
  const setPhoneScreen = useDesk((s) => s.setPhoneScreen);
  return (
    <div className="phone-feed">
      <header className="flex items-center justify-between border-b border-border px-3" style={{ minHeight: 58 }}>
        <div>
          <p className="font-mono text-kicker uppercase tracking-label text-subtle">kz-v3</p>
          <p className="font-mono text-sm text-fg">Live engine</p>
        </div>
        <button
          type="button"
          className="h-9 rounded-sm px-2 font-mono text-kicker uppercase tracking-label text-muted"
          onClick={() => setPhoneScreen("pair")}
        >
          Pair
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LiveSignals />
      </div>
    </div>
  );
}
