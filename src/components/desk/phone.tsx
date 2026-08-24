import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fitPx } from "@/lib/desk/format";
import { dockPreview, engineState, type EngineState } from "@/lib/desk/rail";
import { clockAt } from "@/lib/desk/session";
import { useDesk } from "@/lib/desk/store";
import { CandleChart } from "./chart";
import { LevelsRail } from "./levels-rail";
import { enableAlarms, disableAlarms } from "@/lib/desk/alarm";

type Detent = "peek" | "open";

function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptic */
  }
}

function HeatLadder() {
  const tape = useDesk((s) => s.tape);
  const cells = useMemo(() => {
    const bands = tape?.bands ?? [];
    if (!bands.length) return Array.from({ length: 20 }, () => ({ a: 0, long: true }));
    const step = Math.max(1, Math.floor(bands.length / 5));
    const rows = Array.from({ length: 5 }, (_, r) => bands[Math.min(bands.length - 1, r * step)]);
    const maxI = Math.max(...rows.map((b) => b.intensity), 0.001);
    return rows.flatMap((b) => {
      const long = b.longLiq >= b.shortLiq;
      const a = b.intensity / maxI;
      return [0.25, 0.5, 0.75, 1].map((k) => ({ a: a * k, long }));
    });
  }, [tape]);
  return (
    <div className="phone-heat" aria-hidden>
      {cells.map((c, i) => (
        <span
          key={i}
          className={cn("block rounded-xs", c.long ? "bg-long" : "bg-short")}
          style={{ opacity: 0.15 + c.a * 0.75 }}
        />
      ))}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "warn" | "long" | "short" | "muted" }) {
  return (
    <div className="phone-row px-3">
      <p className="font-mono text-kicker uppercase tracking-label text-subtle">{k}</p>
      <p
        className={cn(
          "font-mono text-num tabular-nums leading-snug",
          tone === "warn" ? "text-warn" : tone === "long" ? "text-long" : tone === "short" ? "text-short" : "text-fg",
        )}
      >
        {v}
      </p>
    </div>
  );
}

function statusCopy(state: EngineState, analysis: ReturnType<typeof useDesk.getState>["analysis"]) {
  if (state === "first-run") return "Waiting on 15m tape";
  if (state === "stale") return "Tape stale — reconnecting";
  if (state === "invalidated") return analysis?.missingPriority || "Setup dead";
  if (state === "in-trade") return analysis?.invalidation || analysis?.sequence || "";
  return analysis?.missingPriority || "Wait for a fresh raid";
}

export function PhoneDesk({ onDesk }: { onDesk?: () => void }) {
  const pair = useDesk((s) => s.pair);
  const tape = useDesk((s) => s.tape);
  const analysis = useDesk((s) => s.analysis);
  const audit = useDesk((s) => s.audit);
  const alarmOn = useDesk((s) => s.alarmOn);
  const setAlarmOn = useDesk((s) => s.setAlarmOn);
  const kzWatch = useDesk((s) => s.kzWatch);
  const setKzWatch = useDesk((s) => s.setKzWatch);
  const [detent, setDetent] = useState<Detent>("peek");
  const [focusPx, setFocusPx] = useState<number | null>(null);
  const [clock, setClock] = useState(() => clockAt());
  const drag = useRef<{ y: number; start: Detent } | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setClock(clockAt()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const state = engineState(analysis, tape);
  const preview = dockPreview(analysis, tape);
  const mark = tape?.mark || 0;
  const wins = audit.filter((r) => r.outcome === "win").length;
  const losses = audit.filter((r) => r.outcome === "loss").length;

  function setDock(next: Detent) {
    if (next !== detent) buzz(10);
    setDetent(next);
  }

  function onHandleStart(clientY: number) {
    drag.current = { y: clientY, start: detent };
  }
  function onHandleMove(clientY: number) {
    if (!drag.current) return;
    const dy = drag.current.y - clientY;
    if (dy > 36) setDock("open");
    if (dy < -36) setDock("peek");
  }
  function onHandleEnd() {
    drag.current = null;
  }

  const inTrade = state === "in-trade";
  const side = analysis?.verdict === "SHORT" ? "short" : "long";

  return (
    <div className="phone-desk" data-detent={detent} data-state={state}>
      <header className="phone-status flex items-center gap-2 border-b border-border bg-surface px-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-kicker uppercase tracking-label text-subtle">{clock.sessionLabel}</p>
          <div className="flex items-baseline gap-2">
            <p className="min-w-0 truncate font-mono text-label text-muted">{pair}</p>
            <p className="shrink-0 font-mono text-verdict tabular-nums leading-none text-fg">
              {mark ? fitPx(mark) : "—"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={cn("h-9 rounded-sm px-1.5 font-mono text-kicker uppercase tracking-label", kzWatch ? "bg-elevated text-fg" : "text-muted")}
            onClick={() => setKzWatch(!kzWatch)}
          >
            Watch
          </button>
          <button
            type="button"
            className={cn("h-9 rounded-sm px-1.5 font-mono text-kicker uppercase tracking-label", alarmOn ? "bg-elevated text-fg" : "text-muted")}
            onClick={() => {
              if (alarmOn) {
                disableAlarms();
                setAlarmOn(false);
              } else {
                void enableAlarms().then(() => setAlarmOn(true));
              }
            }}
          >
            Alarm
          </button>
          <button
            type="button"
            className="h-9 rounded-sm px-1.5 font-mono text-kicker uppercase tracking-label text-muted"
            onClick={() => onDesk?.()}
          >
            Desk
          </button>
        </div>
      </header>

      <section className="phone-chart relative bg-bg">
        <CandleChart candles={tape?.candles ?? []} focusPx={focusPx} compact />
        {state === "first-run" ? (
          <p className="absolute inset-0 flex items-center justify-center text-body text-muted">Pulling OKX 15m tape</p>
        ) : null}
      </section>

      <aside className="phone-rail">
        <LevelsRail onFocus={setFocusPx} className="h-full" />
      </aside>

      <div
        className={cn(
          "phone-verdict flex items-center justify-between gap-3 border-y border-border px-3",
          inTrade && side === "long" ? "bg-long/15" : inTrade && side === "short" ? "bg-short/15" : "bg-surface",
        )}
      >
        <p
          className={cn(
            "font-medium text-verdict tracking-tight",
            inTrade ? (side === "long" ? "text-long" : "text-short") : state === "invalidated" ? "text-muted" : "text-warn",
          )}
        >
          {state === "in-trade" ? analysis?.verdict : state === "invalidated" ? "INVALID" : "STAND ASIDE"}
        </p>
        <p className="min-w-0 font-mono text-label leading-snug text-muted" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {statusCopy(state, analysis)}
        </p>
      </div>

      <section className="phone-sheet border-t border-border bg-surface">
        <button
          type="button"
          className="flex h-9 w-full items-center justify-center"
          aria-label="Resize setup sheet"
          onClick={() => setDock(detent === "peek" ? "open" : "peek")}
          onPointerDown={(e) => onHandleStart(e.clientY)}
          onPointerMove={(e) => e.buttons && onHandleMove(e.clientY)}
          onPointerUp={onHandleEnd}
        >
          <span className="block h-1 w-10 rounded-full bg-border" />
        </button>
        {state === "in-trade" ? (
          <>
            <Row k="SIZE" v={`${analysis?.size} ${analysis?.riskPct}%`} />
            <Row k="ENTRY" v={preview.entry} tone={side} />
            <Row k="INV" v={preview.sl} />
            <Row k="TP1 / TP2" v={preview.tp} />
          </>
        ) : state === "invalidated" ? (
          <>
            <Row k="RESULT" v={analysis?.missingPriority || "Dead"} />
            <Row k="SESSION" v={`${wins}W–${losses}L`} />
            <Row k="NEXT" v={clock.nextLabel} />
            <Row k="COOLDOWN" v={clock.countdown} />
          </>
        ) : (
          <>
            <Row k="NEXT TRIG" v={preview.trig} tone="warn" />
            <Row k="DIST" v={preview.dist} tone="warn" />
            <Row k="SL" v={preview.sl} tone="warn" />
            <Row k="TP1 / TP2" v={preview.tp} tone="warn" />
          </>
        )}
        {detent === "open" ? (
          <>
            <Row k="4H" v={analysis?.bias4h ?? "unclear"} />
            <Row k="SEQ" v={analysis?.sequence ?? "Sequence incomplete"} />
            <div className="px-3 py-2">
              <p className="mb-1 font-mono text-kicker uppercase tracking-label text-subtle">Heat</p>
              <HeatLadder />
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
