import { fetchOkxTape, fetchWatchlist, scanMajors } from "./server/okx";
import { fetchTapeFn, fetchWatchlistFn, scanMajorsFn } from "./server/fns";
import type { RadarHit, Tape } from "./types";

export async function loadTape(symbol: string): Promise<Tape | null> {
  try {
    const res = await fetchTapeFn({ data: { symbol } });
    if (res?.ok) return res.tape;
  } catch {
    /* Vercel /_serverFn 403/seroval — fall through to OKX in the browser */
  }
  try {
    return await fetchOkxTape(symbol);
  } catch {
    return null;
  }
}

export async function loadWatchlist() {
  try {
    const res = await fetchWatchlistFn();
    if (res?.ok) return res.tickers;
  } catch {
    /* fall through */
  }
  try {
    return await fetchWatchlist();
  } catch {
    return [] as { symbol: string; price: number; changePct: number }[];
  }
}

export async function loadRadar(): Promise<{ ok: boolean; hits: RadarHit[]; error?: string }> {
  try {
    const res = await scanMajorsFn();
    if (res?.ok) return { ok: true, hits: res.hits };
  } catch {
    /* fall through */
  }
  try {
    const hits = await scanMajors();
    return { ok: true, hits };
  } catch (err) {
    return { ok: false, hits: [], error: err instanceof Error ? err.message : "Radar failed" };
  }
}
