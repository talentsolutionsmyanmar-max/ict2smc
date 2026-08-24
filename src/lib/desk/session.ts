import type { ClockState } from "./types";
import { pad2 } from "./format";

export const NY_TZ = "America/New_York";
export const MMT_TZ = "Asia/Yangon";

export const ASIA = { start: 1200, end: 1440 };
export const LONDON = { start: 120, end: 300 };
export const NY_KZ = { start: 420, end: 600 };
export const NY_AM = { start: 570, end: 660 };
export const LONDON_CLOSE = { start: 300, end: 420 };
export const NY_LUNCH = { start: 600, end: 720 };
export const NY_PM = { start: 840, end: 960 };

export const KILL_ZONES = [
  {
    name: "Asia (map · half if spike)",
    ny: "20:00–00:00 NY",
    mmt: "08:30–12:30 MMT (EDT) — map Asia H/L. Half-size only on vol/OI spike ≥1.5× or Override.",
  },
  {
    name: "London KZ (full)",
    ny: "02:00–05:00 NY",
    mmt: "13:30–16:30 MMT (EDT) — raid Asia high or low. Primary, full size.",
  },
  {
    name: "NY KZ (full)",
    ny: "07:00–10:00 NY",
    mmt: "18:30–21:30 MMT (EDT) — continuation of London. First 90m after 09:30 is highest quality.",
  },
  {
    name: "Secondary (half)",
    ny: "05:00–07:00 · 10:00–12:00 · 14:00–16:00 NY",
    mmt: "London close, NY lunch, NY afternoon — half size, regime or Override required.",
  },
] as const;

export const RAID_STEPS = [
  {
    n: "01",
    t: "Asia — map, don't chase",
    d: "20:00–00:00 NY. Mark Asia high and low. Half-size only if vol+OI spike 1.5× or Exceptional Override.",
  },
  {
    n: "02",
    t: "London open — raid that range",
    d: "02:00–05:00 NY. Price runs Asia high or Asia low (or PDH/PDL), then displaces the other way. Full-size day's trade.",
  },
  {
    n: "03",
    t: "15M MSS + first FVG",
    d: "Displacement candle same color as the trade, ≥1.2× 14-period 15M ATR, then MSS = close back through the swept level. Enter the first unfilled, reachable 15M FVG (50% / 1M). Never buy/sell the close.",
  },
  {
    n: "04",
    t: "NY — continuation, not a reverse",
    d: "07:00–10:00 NY full. If London closed through Asia high, that high is DOL — not a short. Secondary 10:00–12:00 and 14:00–16:00 are half-size only.",
  },
  {
    n: "05",
    t: "Override + size",
    d: "Clock is not a veto when 4H agrees with the 15M sequence, displacement is ≥1.2×ATR, and two of OI/CVD/heatmap/RS confirm. Alts need RS vs BTC. Half-size. Full 0.5–1.0%, half 0.25–0.5%, open risk ≤ 3%.",
  },
] as const;

export function formatTzClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function nyHms(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: num("hour"), m: num("minute"), s: num("second") };
}

export function wrapMinutes(from: number, to: number) {
  let n = to - from;
  if (n < 0) n += 1440;
  return n;
}

export function formatCountdown(minutesLeft: number, seconds: number) {
  const h = Math.floor(minutesLeft / 60);
  const m = minutesLeft % 60;
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m ${pad2(seconds)}s`;
}

export type NyParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
  minutes: number;
  dayKey: string;
};

export function nyParts(ts: number): NyParts {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute,
    minutes: hour * 60 + minute,
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function previousDayKey(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return nyParts(Date.UTC(y, m - 1, d, 12, 0, 0) - 86400000).dayKey;
}

function inRange(n: number, w: { start: number; end: number }) {
  return n >= w.start && n < w.end;
}

export function clockAt(date = new Date()): ClockState {
  const t = nyHms(date);
  const n = t.h * 60 + t.m;
  const inAsia = n >= ASIA.start;
  const inLondon = inRange(n, LONDON);
  const inNy = inRange(n, NY_KZ);
  const inNyAm = inRange(n, NY_AM);
  const preLondon = n >= 0 && n < LONDON.start;
  const inSecondary =
    inRange(n, LONDON_CLOSE) || inRange(n, NY_LUNCH) || inRange(n, NY_PM);

  let session = "OFF";
  let sessionLabel = "Outside Kill Zone";
  let inPrimary = false;
  let role: ClockState["role"] = "wait";
  let countdown = "";
  let nextLabel = "London open";

  if (inAsia) {
    session = "ASIA";
    sessionLabel = "Asia · map the range";
    role = "map";
    countdown = formatCountdown(wrapMinutes(n, LONDON.start), 59 - t.s);
    nextLabel = "London open";
  } else if (preLondon) {
    session = "PRELONDON";
    sessionLabel = "Pre-London · Asia H/L armed";
    role = "wait";
    countdown = formatCountdown(LONDON.start - n, 59 - t.s);
    nextLabel = "London open";
  } else if (inLondon) {
    session = "LONDON";
    sessionLabel = "London KZ · raid Asia";
    inPrimary = true;
    role = "trade";
    countdown = formatCountdown(LONDON.end - n, 59 - t.s);
    nextLabel = "London close";
  } else if (inNy) {
    session = inNyAm ? "NY_AM" : "NY";
    sessionLabel = inNyAm ? "NY KZ · equity open" : "NY KZ · London continuation";
    inPrimary = true;
    role = "trade";
    countdown = formatCountdown(NY_KZ.end - n, 59 - t.s);
    nextLabel = "NY KZ close";
  } else if (inRange(n, LONDON_CLOSE)) {
    session = "LONDON_CLOSE";
    sessionLabel = "London close · secondary";
    role = "wait";
    countdown = formatCountdown(NY_KZ.start - n, 59 - t.s);
    nextLabel = "NY open";
  } else if (inRange(n, NY_LUNCH)) {
    session = "NY_LUNCH";
    sessionLabel = "NY lunch · secondary";
    role = "wait";
    countdown = formatCountdown(wrapMinutes(n, NY_PM.start), 59 - t.s);
    nextLabel = "NY afternoon";
  } else if (inRange(n, NY_PM)) {
    session = "NY_PM";
    sessionLabel = "NY afternoon · secondary";
    role = "wait";
    countdown = formatCountdown(NY_PM.end - n, 59 - t.s);
    nextLabel = "PM close";
  } else if (n < NY_KZ.start) {
    countdown = formatCountdown(wrapMinutes(n, NY_KZ.start), 59 - t.s);
    nextLabel = "NY open";
    sessionLabel = "London done · wait NY";
    role = "wait";
  } else {
    countdown = formatCountdown(wrapMinutes(n, ASIA.start), 59 - t.s);
    nextLabel = "Asia range";
    sessionLabel = "Dead zone · no chase";
    role = "wait";
  }

  return {
    mmtLabel: formatTzClock(date, MMT_TZ),
    nyLabel: formatTzClock(date, NY_TZ),
    utcLabel: formatTzClock(date, "UTC"),
    nyMinutes: n,
    session,
    sessionLabel,
    inPrimary,
    inSecondary,
    inAsia,
    role,
    countdown,
    nextLabel,
  };
}
