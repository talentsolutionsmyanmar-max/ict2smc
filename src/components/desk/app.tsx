import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/desk/format";
import { clockAt } from "@/lib/desk/session";
import { fetchTapeFn } from "@/lib/desk/server/fns";
import { useDesk } from "@/lib/desk/store";
import { AnalysisCard } from "./analysis";
import { SessionStrip } from "./clock";
import { DeskChart, Heatmap } from "./chart";
import { OrderBook, OrderFlow } from "./book-flow";
import { ExternalLinks, KillZoneWatch, Playbook, RecentReads, SessionLevelsCard } from "./kz";
import { RegimePanel } from "./regime-panel";
import { lastClosedKey, runRead, slotFingerprint } from "./run-read";
import { ChartDrop, TranslateForm } from "./translate";
import { Watchlist } from "./watchlist";
import { MajorRadar } from "./radar";
import { PhoneDesk } from "./phone";
import { useDeskLayout } from "./layout";

function AlarmFlash() {
  const [hit, setHit] = useState<{ verdict: string; pair: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ verdict: string; pair: string }>).detail;
      setHit(d);
      window.setTimeout(() => setHit(null), 8000);
    };
    window.addEventListener("casper-alarm", on);
    return () => window.removeEventListener("casper-alarm", on);
  }, []);
  if (!hit) return null;
  const long = hit.verdict === "LONG";
  return (
    <div
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b px-4 py-3 text-center text-sm font-medium",
        long ? "border-long/40 bg-long text-bg" : "border-short/40 bg-short text-bg",
      )}
    >
      {hit.verdict} {hit.pair} — limit the FVG, do not chase. Alarm on.
    </div>
  );
}

function ViewToggle() {
  const view = useDesk((s) => s.view);
  const setView = useDesk((s) => s.setView);
  return (
    <div className="inline-flex rounded-md border border-border bg-elevated p-1">
      {(
        [
          { id: "live", label: "Terminal" },
          { id: "translate", label: "Translate" },
        ] as const
      ).map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setView(tab.id)}
          className={cn(
            "h-9 min-w-24 px-3 text-sm",
            view === tab.id ? "rounded-sm bg-fg text-bg" : "text-muted hover:text-fg",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function TapePoller() {
  const pair = useDesk((s) => s.pair);
  const setTape = useDesk((s) => s.setTape);
  const tickMissed = useDesk((s) => s.tickMissed);
  useEffect(() => {
    let dead = false;
    async function pull() {
      try {
        const res = await fetchTapeFn({ data: { symbol: pair } });
        if (dead) return;
        if (res?.ok) {
          setTape(res.tape);
          tickMissed(res.tape.symbol, res.tape.mark);
        }
      } catch {
        /* keep last */
      }
    }
    void pull();
    const id = window.setInterval(() => void pull(), 12000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [pair, setTape, tickMissed]);
  return null;
}

function AutoRead() {
  const slots = useDesk((s) => s.slots);
  const busy = useDesk((s) => s.busy);
  const tape = useDesk((s) => s.tape);
  const pair = useDesk((s) => s.pair);
  const setPending = useDesk((s) => s.setPending);
  const chartsKey = useRef("");
  const tapeKey = useRef("");

  useEffect(() => {
    tapeKey.current = "";
  }, [pair]);

  useEffect(() => {
    if (!Object.keys(slots).length) {
      setPending(false);
      chartsKey.current = "";
      return;
    }
    if (busy) return;
    const fp = slotFingerprint(slots);
    if (fp === chartsKey.current) return;
    setPending(true);
    const id = window.setTimeout(() => {
      chartsKey.current = fp;
      void runRead({ forceLlm: true });
    }, 700);
    return () => window.clearTimeout(id);
  }, [slots, busy, setPending]);

  useEffect(() => {
    if (busy || !tape?.candles.length || Object.keys(slots).length) return;
    const key = `${lastClosedKey(tape, pair)}:${clockAt().session}`;
    if (!key || key === tapeKey.current) return;
    tapeKey.current = key;
    void runRead({ forceLlm: false, fromClose: true });
  }, [tape, pair, busy, slots]);

  return null;
}

export function DeskApp() {
  const hydrate = useDesk((s) => s.hydrateHistory);
  const view = useDesk((s) => s.view);
  const tape = useDesk((s) => s.tape);
  const analysis = useDesk((s) => s.analysis);
  const { layout, choose } = useDeskLayout();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const subtitle = tape
    ? `${tape.symbol} ${tape.mark.toFixed(tape.mark >= 100 ? 2 : 3)} · OI ${fmtUsd(tape.oiUsd)} · ${tape.read.split(".")[0]}.${analysis ? ` ${analysis.verdict.replace("_", " ")} · ${analysis.window} · ${analysis.size}.` : ""}`
    : "Adaptive kill-zone · live 15m · Override when structure is complete";

  return (
    <div className="bg-bg">
      <AlarmFlash />
      <MajorRadar />
      <AutoRead />
      <TapePoller />
      <PhoneDesk onDesk={() => choose("desk")} />
      <div className="desk-grid desk-only min-h-dvh bg-bg">
      <header className="border-b border-border bg-bg/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 py-5 md:px-6">
          <div>
            <p className="font-mono text-micro uppercase tracking-label text-subtle">CasperSMC · kz-v2</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-fg md:text-3xl">Casper Desk</h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <ViewToggle />
          <button
            type="button"
            className="h-9 rounded-md bg-fg px-3 text-sm font-medium text-bg"
            onClick={() => choose("phone")}
          >
            Phone UI
          </button>
          </div>
        </div>
        <SessionStrip />
      </header>
      <main
        className={cn(
          "mx-auto grid max-w-7xl gap-4 px-4 py-5 md:px-6",
          view === "translate" ? "lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start" : "lg:items-start",
        )}
      >
        {view === "live" ? (
          <>
            <DeskChart />
            <SessionLevelsCard />
            <div className="grid gap-4 lg:grid-cols-2">
              <Heatmap />
              <OrderBook />
            </div>
            <OrderFlow />
            <KillZoneWatch />
            <AnalysisCard />
            <RegimePanel />
            <ExternalLinks />
            <div className="grid gap-4 lg:grid-cols-3">
              <Watchlist />
              <Playbook />
              <RecentReads />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <ChartDrop />
              <TranslateForm />
              <AnalysisCard />
            </div>
            <aside className="space-y-4 lg:sticky lg:top-4">
              <SessionLevelsCard />
              <KillZoneWatch />
              <RegimePanel />
              <OrderFlow compact />
              <Watchlist />
              <Playbook />
              <RecentReads />
            </aside>
          </>
        )}
      </main>
      <Toaster theme="dark" position="bottom-right" />
      </div>
    </div>
  );
}
