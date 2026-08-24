import type { Analysis } from "./types";

export type AlarmPayload = Pick<Analysis, "pair" | "verdict" | "size" | "riskPct" | "entry" | "stopLoss" | "closedAt">;

const ALARM_PREF = "casper-alarm-on";
const ALARM_FIRED = "casper-alarm-fired";

export function alarmPrefOn(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(ALARM_PREF);
  return v === null || v === "1";
}

export function setAlarmPref(on: boolean) {
  try {
    localStorage.setItem(ALARM_PREF, on ? "1" : "0");
  } catch {
    /* quota */
  }
}

function firedKey(analysis: AlarmPayload) {
  const entry = (analysis.entry || "").replace(/\s+/g, " ").slice(0, 48);
  return `${analysis.pair}:${analysis.verdict}:${entry}`;
}

function alreadyFired(key: string) {
  try {
    const raw = localStorage.getItem(ALARM_FIRED);
    const set = raw ? (JSON.parse(raw) as string[]) : [];
    return set.includes(key);
  } catch {
    return false;
  }
}

function markFired(key: string) {
  try {
    const raw = localStorage.getItem(ALARM_FIRED);
    const set = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [key, ...set.filter((k) => k !== key)].slice(0, 40);
    localStorage.setItem(ALARM_FIRED, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

function playTone() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const now = ctx.currentTime;
  const beeps = [
    { t: 0, f: 880 },
    { t: 0.2, f: 1174 },
    { t: 0.4, f: 880 },
    { t: 0.6, f: 1318 },
  ];
  for (const b of beeps) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = b.f;
    g.gain.setValueAtTime(0.0001, now + b.t);
    g.gain.exponentialRampToValueAtTime(0.16, now + b.t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + b.t + 0.16);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(now + b.t);
    o.stop(now + b.t + 0.18);
  }
  window.setTimeout(() => void ctx.close(), 1400);
}

function vibrate() {
  try {
    navigator.vibrate?.([180, 80, 180, 80, 320]);
  } catch {
    /* no haptic */
  }
}

function banner(analysis: AlarmPayload) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(`Casper · ${analysis.verdict} ${analysis.pair}`, {
      body: `${analysis.size} ${analysis.riskPct}% · ${analysis.entry} · SL ${analysis.stopLoss}`,
      tag: firedKey(analysis),
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* blocked */
  }
}

export async function enableAlarms(): Promise<boolean> {
  setAlarmPref(true);
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
  playTone();
  vibrate();
  return Notification?.permission === "granted";
}

export function disableAlarms() {
  setAlarmPref(false);
}

export function fireTradeAlarm(analysis: AlarmPayload) {
  if (analysis.verdict !== "LONG" && analysis.verdict !== "SHORT") return;
  if (!alarmPrefOn()) return;
  const key = firedKey(analysis);
  if (alreadyFired(key)) return;
  markFired(key);
  playTone();
  vibrate();
  banner(analysis);
  try {
    document.title = `${analysis.verdict} · ${analysis.pair}`;
  } catch {
    /* ssr */
  }
  window.dispatchEvent(new CustomEvent("casper-alarm", { detail: { verdict: analysis.verdict, pair: analysis.pair } }));
}
