import { useEffect, useMemo, useState } from "react";
import { Badge } from "./badge";
import { detectRegime, liveStatus } from "@/lib/desk/regime";
import { clockAt } from "@/lib/desk/session";
import { useDesk } from "@/lib/desk/store";

export function SessionStrip() {
  const [clock, setClock] = useState(() => clockAt());
  const tape = useDesk((s) => s.tape);
  const analysis = useDesk((s) => s.analysis);
  const notes = useDesk((s) => s.notes);

  useEffect(() => {
    setClock(clockAt());
    const id = window.setInterval(() => setClock(clockAt()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const regime = useMemo(() => (tape ? detectRegime(tape, notes) : { trending: false, reasons: [] }), [tape, notes]);
  const status = liveStatus({
    clock,
    regime,
    overrideReady: analysis?.overrideReady ?? false,
    window: analysis?.window ?? (clock.inPrimary ? "primary" : clock.inAsia ? "map" : clock.inSecondary ? "secondary" : "dead"),
    verdict: analysis?.verdict,
    missingPriority: analysis?.missingPriority,
  });

  const t = clock.nyMinutes / 1440;
  return (
    <div className="border-b border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 md:px-6">
        <div className="min-w-0">
          <p className="font-mono text-micro uppercase tracking-label text-subtle">Myanmar</p>
          <p className="font-mono text-sm tabular-nums text-fg" suppressHydrationWarning>
            {clock.mmtLabel}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-micro uppercase tracking-label text-subtle">New York</p>
          <p className="font-mono text-sm tabular-nums text-fg" suppressHydrationWarning>
            {clock.nyLabel}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge tone={clock.role === "trade" ? "live" : clock.role === "map" ? "warn" : "neutral"}>
            {clock.role === "trade" ? (
              <span className="size-1.5 rounded-full bg-long" />
            ) : (
              <span className="size-1.5 rounded-full bg-subtle" />
            )}
            <span suppressHydrationWarning>{clock.sessionLabel}</span>
          </Badge>
          <Badge tone={status.tone}>
            <span suppressHydrationWarning>{status.line}</span>
          </Badge>
          <span className="font-mono text-xs tabular-nums text-muted" suppressHydrationWarning>
            {clock.nextLabel} {clock.countdown}
          </span>
        </div>
      </div>
      <div className="px-4 pb-3 md:px-6">
        <div className="relative h-2 overflow-hidden rounded-full bg-elevated">
          <span className="absolute inset-y-0 bg-accent/15" style={{ left: `${(20 / 24) * 100}%`, width: `${(4 / 24) * 100}%` }} />
          <span className="absolute inset-y-0 bg-accent/30" style={{ left: `${(2 / 24) * 100}%`, width: `${(3 / 24) * 100}%` }} />
          <span className="absolute inset-y-0 bg-accent/50" style={{ left: `${(7 / 24) * 100}%`, width: `${(3 / 24) * 100}%` }} />
          <span className="absolute inset-y-0 bg-warn/25" style={{ left: `${(5 / 24) * 100}%`, width: `${(2 / 24) * 100}%` }} />
          <span className="absolute inset-y-0 bg-warn/25" style={{ left: `${(10 / 24) * 100}%`, width: `${(2 / 24) * 100}%` }} />
          <span className="absolute inset-y-0 bg-warn/25" style={{ left: `${(14 / 24) * 100}%`, width: `${(2 / 24) * 100}%` }} />
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
            style={{ left: `${t * 100}%` }}
            suppressHydrationWarning
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-micro uppercase tracking-label text-subtle">
          <span>00</span>
          <span>London</span>
          <span>NY</span>
          <span>PM</span>
          <span>Asia</span>
          <span>24</span>
        </div>
        {status.sub ? (
          <p className="mt-2 font-mono text-micro text-muted" suppressHydrationWarning>
            {status.sub}
            {tape ? ` · vol ${tape.volRatio.toFixed(2)}× · OI ${tape.oiDeltaPct >= 0 ? "+" : ""}${tape.oiDeltaPct.toFixed(1)}% · RS ${tape.relStrength}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
