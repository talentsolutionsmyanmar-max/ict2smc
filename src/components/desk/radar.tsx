import { useEffect } from "react";
import { fireTradeAlarm } from "@/lib/desk/alarm";
import { clockAt } from "@/lib/desk/session";
import { scanMajorsFn } from "@/lib/desk/server/fns";
import { useDesk } from "@/lib/desk/store";

export function MajorRadar() {
  const kzWatch = useDesk((s) => s.kzWatch);
  const alarmOn = useDesk((s) => s.alarmOn);
  const setRadar = useDesk((s) => s.setRadar);
  const pushKzAlert = useDesk((s) => s.pushKzAlert);

  useEffect(() => {
    if (!kzWatch) return;
    let dead = false;
    let inFlight = false;

    async function scan() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await scanMajorsFn();
        if (dead || !res.ok) return;
        setRadar(res.hits);
        const clock = clockAt();
        for (const hit of res.hits) {
          if (hit.verdict !== "LONG" && hit.verdict !== "SHORT") continue;
          if (alarmOn) fireTradeAlarm(hit);
          pushKzAlert({
            id: `${hit.pair}:${hit.closedAt}:${hit.verdict}`,
            at: Date.now(),
            pair: hit.pair,
            session: clock.sessionLabel,
            verdict: hit.verdict,
            note: `${hit.size} ${hit.riskPct}% · ${hit.entry} · ${hit.sequence}`,
            usedLlm: false,
            score: 6,
          });
        }
      } catch {
        /* keep last radar */
      } finally {
        inFlight = false;
      }
    }

    void scan();
    const id = window.setInterval(() => void scan(), 45000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [kzWatch, alarmOn, setRadar, pushKzAlert]);

  return null;
}
