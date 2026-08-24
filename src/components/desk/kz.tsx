import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";
import { fireTradeAlarm, enableAlarms, disableAlarms } from "@/lib/desk/alarm";
import { G } from "@/lib/desk/format";
import { closedBars, londonDay, scanRaid, sessionLevels, structureOf } from "@/lib/desk/ict";
import { mechanicalRead, tapePrompt } from "@/lib/desk/mechanical";
import { detectRegime, liveStatus, openRiskOf } from "@/lib/desk/regime";
import { clockAt, KILL_ZONES, RAID_STEPS } from "@/lib/desk/session";
import { scanKzFn } from "@/lib/desk/server/fns";
import { useDesk } from "@/lib/desk/store";

const LLM_CAP = 8;

export function SessionLevelsCard() {
  const tape = useDesk((s) => s.tape);
  if (!tape?.candles.length) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <p className="font-mono text-micro uppercase tracking-label text-subtle">Session levels</p>
        <p className="mt-2 text-sm text-muted">Waiting on 15m tape to mark Asia H/L and PDH/PDL.</p>
      </section>
    );
  }
  const levels = sessionLevels(tape.candles);
  const day = londonDay(tape.candles);
  const mark = tape.mark || tape.last;
  const rows = [
    { k: "Asia high", v: levels.asiaHigh, side: "high" as const },
    { k: "Asia low", v: levels.asiaLow, side: "low" as const },
    { k: "Prior Asia high", v: levels.priorAsiaHigh, side: "high" as const },
    { k: "Prior Asia low", v: levels.priorAsiaLow, side: "low" as const },
    { k: "PDH", v: levels.pdh, side: "high" as const },
    { k: "PDL", v: levels.pdl, side: "low" as const },
    { k: "London high", v: levels.londonHigh, side: "high" as const },
    { k: "London low", v: levels.londonLow, side: "low" as const },
  ];
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">Session levels</p>
          <h2 className="text-sm font-medium text-fg">{day.bias ? `London day ${day.bias}` : "Asia range → London raid"}</h2>
        </div>
        <p className="font-mono text-micro text-subtle">
          {levels.asiaSweepable ? (levels.asiaComplete ? "Asia complete · sweepable" : "Asia paused · sweepable") : "Asia forming · no sweep"}
        </p>
      </div>
      {day.bias ? <p className="mt-2 text-xs leading-relaxed text-muted">{day.reason}</p> : null}
      <ul className="mt-3 divide-y divide-border">
        {rows.map((row) => {
          const taken = row.v != null && (row.side === "high" ? mark > row.v : mark < row.v);
          return (
            <li key={row.k} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted">{row.k}</span>
              <span className={cn("font-mono text-sm tabular-nums", taken ? "text-warn" : "text-fg")}>
                {row.v == null ? "—" : G(row.v)}
                {taken ? " · taken" : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        London open should hunt the Asia high or low. If neither side is taken yet, wait. If a side is taken and price
        closed back inside, that is the setup — limit the FVG, do not chase.
      </p>
    </section>
  );
}

export function KillZoneWatch() {
  const pair = useDesk((s) => s.pair);
  const tape = useDesk((s) => s.tape);
  const notes = useDesk((s) => s.notes);
  const analysis = useDesk((s) => s.analysis);
  const kzWatch = useDesk((s) => s.kzWatch);
  const setKzWatch = useDesk((s) => s.setKzWatch);
  const alerts = useDesk((s) => s.kzAlerts);
  const pushKzAlert = useDesk((s) => s.pushKzAlert);
  const lastScan = useDesk((s) => s.lastScanCandle);
  const markScan = useDesk((s) => s.markScan);
  const llmCalls = useDesk((s) => s.llmCalls);
  const riskBook = useDesk((s) => s.riskBook);
  const alarmOn = useDesk((s) => s.alarmOn);
  const setAlarmOn = useDesk((s) => s.setAlarmOn);
  const [scanning, setScanning] = useState(false);
  const lock = useRef(false);

  const clock = clockAt();
  const regime = useMemo(() => (tape ? detectRegime(tape, notes) : { trending: false, reasons: [] }), [tape, notes]);
  const status = liveStatus({
    clock,
    regime,
    overrideReady: analysis?.overrideReady ?? false,
    window: analysis?.window ?? (clock.inPrimary ? "primary" : clock.inAsia ? "map" : clock.inSecondary ? "secondary" : "dead"),
    verdict: analysis?.verdict,
    missingPriority: analysis?.missingPriority,
  });

  useEffect(() => {
    if (!kzWatch || !tape?.candles.length) return;
    const bars = closedBars(tape.candles);
    const last = bars[bars.length - 1];
    if (!last || last.t === lastScan) return;
    if (!clockAt().inPrimary) return;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kzWatch, tape?.candles, tape?.at, lastScan]);

  async function run(manual: boolean) {
    if (lock.current) return;
    lock.current = true;
    const current = useDesk.getState().tape;
    if (!current?.candles.length) {
      lock.current = false;
      if (manual) toast.error("Wait for the 15m tape to load.");
      return;
    }
    const nowClock = clockAt();
    const bias4h = structureOf(current.h4)?.bias ?? "unclear";
    const raid = scanRaid(current.candles, bias4h);
    if (!raid) {
      lock.current = false;
      if (manual) toast.error("Not enough 15m bars yet.");
      return;
    }
    if (raid.closedAt === useDesk.getState().lastScanCandle && !manual) {
      lock.current = false;
      return;
    }
    const mech = mechanicalRead(current, pair, useDesk.getState().riskBook, useDesk.getState().notes, openRiskOf(useDesk.getState().audit));
    const countsAgainstCap = mech.window === "primary" && mech.verdict !== "STAND_ASIDE";
    markScan(raid.closedAt, false);
    setScanning(true);
    try {
      const shouldLlm =
        raid.score >= 2 &&
        useDesk.getState().llmCalls < LLM_CAP &&
        countsAgainstCap &&
        (nowClock.inPrimary || manual) &&
        (raid.timeBased || raid.displacement || manual);
      if (!shouldLlm) {
        if (manual || raid.score >= 1) {
          pushKzAlert({
            id: `${raid.closedAt}`,
            at: Date.now(),
            pair,
            session: nowClock.sessionLabel,
            verdict: mech.verdict === "STAND_ASIDE" ? "MECH" : mech.verdict,
            note: mech.signalBlock.split("\n").slice(0, 3).join(" · ") || raid.notes.join(". "),
            usedLlm: false,
            score: raid.score,
          });
          if (mech.verdict === "LONG" || mech.verdict === "SHORT") fireTradeAlarm(mech);
        }
        return;
      }
      const bars = closedBars(current.candles)
        .slice(-40)
        .map((c) => ({
          t: c.t,
          o: Number(c.open.toPrecision(6)),
          h: Number(c.high.toPrecision(6)),
          l: Number(c.low.toPrecision(6)),
          c: Number(c.close.toPrecision(6)),
        }));
      const res = await scanKzFn({
        data: {
          pair,
          session: nowClock.sessionLabel,
          notes: raid.notes,
          sweep: raid.sweep,
          lastClose: raid.lastClose,
          tape: tapePrompt(current),
          bars,
        },
      });
      if (res?.ok) markScan(raid.closedAt, true);
      if (!res?.ok) {
        pushKzAlert({
          id: `${raid.closedAt}`,
          at: Date.now(),
          pair,
          session: nowClock.sessionLabel,
          verdict: "WATCH",
          note: raid.notes.join(". "),
          usedLlm: false,
          score: raid.score,
        });
        if (manual) toast.error(res?.error ?? "Scan failed — mechanical flags kept.");
        return;
      }
      pushKzAlert({
        id: `${raid.closedAt}`,
        at: Date.now(),
        pair,
        session: nowClock.sessionLabel,
        verdict: res.verdict,
        note: res.note || raid.notes.join(". "),
        usedLlm: true,
        score: raid.score,
      });
      if (res.verdict === "SETUP") toast.success(`KZ SETUP · ${pair}`);
      else if (manual) toast.success(`${res.verdict} · ${res.confidence}%`);
    } finally {
      lock.current = false;
      setScanning(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">15m Kill Zone watch</p>
          <h2 className="text-sm font-medium text-fg">{kzWatch ? status.line : "Off"}</h2>
          {kzWatch ? <p className="mt-0.5 font-mono text-micro text-muted">{status.sub}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={scanning} onClick={() => void run(true)}>
            {scanning ? "Scanning" : "Scan 15m"}
          </Button>
          <Button variant={kzWatch ? "primary" : "secondary"} size="sm" onClick={() => setKzWatch(!kzWatch)}>
            {kzWatch ? "Watch on" : "Watch off"}
          </Button>
          <Button
            variant={alarmOn ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              if (alarmOn) {
                disableAlarms();
                setAlarmOn(false);
              } else {
                void enableAlarms().then(() => setAlarmOn(true));
              }
            }}
          >
            {alarmOn ? "Alarm on" : "Alarm off"}
          </Button>
        </div>
      </div>
      <p className="px-4 py-3 text-xs leading-relaxed text-muted">
        Mechanical check is free on every 15m close. LONG/SHORT fires a sound + phone banner if Alarm is on — keep this
        <a href="/?install=1" className="text-fg underline-offset-2 hover:underline">
          Add to home screen
        </a>{" "}
        so the alarm can fire like an app.
        this session ({llmCalls} used). Override / half-size reads do not count. STAND ASIDE that later expands ≥2R is flagged MISSED_2R+. Open half: {riskBook.openHalf}
        / 2.
      </p>
      {alerts.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted">No 15m alerts yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {alerts.slice(0, 6).map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "font-mono text-xs",
                    a.verdict === "SETUP" || a.verdict === "LONG"
                      ? "text-long"
                      : a.verdict === "SHORT"
                        ? "text-short"
                        : a.verdict === "CLEAR"
                          ? "text-muted"
                          : "text-warn",
                  )}
                >
                  {a.verdict}
                </span>
                <span className="font-mono text-micro text-subtle">
                  {a.pair} · {a.usedLlm ? "fast" : "mech"}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-fg">{a.note}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Playbook() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-fg">Adaptive kill-zone model</h2>
      <ol className="mt-3 space-y-3">
        {RAID_STEPS.map((s) => (
          <li key={s.n} className="grid grid-cols-[auto_1fr] gap-3">
            <span className="font-mono text-xs text-subtle">{s.n}</span>
            <div>
              <p className="text-sm text-fg">{s.t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3 className="mt-5 text-sm font-medium text-fg">Kill Zones</h3>
      <ul className="mt-2 space-y-2">
        {KILL_ZONES.map((z) => (
          <li key={z.name} className="text-xs leading-relaxed text-muted">
            <span className="text-fg">{z.name}</span>
            <br />
            {z.ny}
            <br />
            {z.mmt}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExternalLinks() {
  const pair = useDesk((s) => s.pair);
  const base = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const coin = base.endsWith("USDT") ? base.slice(0, -4) : base || "HYPE";
  const links = [
    { href: `https://www.coinglass.com/pro/futures/LiquidationHeatMap?coin=${coin}`, label: "CoinGlass heatmap" },
    { href: `https://www.coinglass.com/tv/Binance_${coin}USDT`, label: "CoinGlass CVD" },
    { href: "https://legend.coinglass.com/", label: "Legend" },
    { href: "https://screener.orionterminal.com/", label: "Orion screener" },
    { href: `https://app.hyperliquid.xyz/trade/${coin}`, label: "Hyperliquid" },
  ];
  return (
    <nav className="flex flex-wrap gap-2">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center rounded-sm border border-border bg-elevated px-3 text-xs text-muted hover:text-fg"
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}

export function RecentReads() {
  const history = useDesk((s) => s.history);
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-fg">Recent reads</h2>
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No analyses yet. They stay on this device.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {history.map((h) => (
            <li key={h.id} className="rounded-md border border-border bg-elevated px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-fg">{h.pair}</span>
                <Badge tone={h.verdict === "LONG" ? "long" : h.verdict === "SHORT" ? "short" : "warn"}>
                  {h.verdict.replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-micro tabular-nums text-muted">
                {new Date(h.at).toLocaleString()} · {h.confidence}%
              </p>
              <p className="mt-1 font-mono text-micro text-subtle">
                E {h.entry} · SL {h.stopLoss} · TP {h.takeProfit1}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
