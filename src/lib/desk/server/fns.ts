import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { blankAnalysis, mechanicalRead, tapePrompt } from "../mechanical";
import { barTape, scanRaid, sessionLevels } from "../ict";
import type { Analysis, Tape, Timeframe } from "../types";
import { fetchOkxTape, fetchWatchlist, scanMajors } from "./okx";
import { G, plain } from "../format";

const analysisSchema = z.object({
  pair: z.string(),
  priceRead: z.string(),
  bias4h: z.enum(["bullish", "bearish", "unclear"]),
  drawOnLiquidity: z.string(),
  structure1h: z.string(),
  structure15m: z.string(),
  structure1m: z.string(),
  liquiditySweep: z.object({
    occurred: z.boolean(),
    notes: z.string(),
    level: z.string().optional(),
  }),
  mss: z.object({
    occurred: z.boolean(),
    notes: z.string(),
    timeframe: z.string().optional(),
  }),
  fvg: z.object({
    occurred: z.boolean(),
    notes: z.string(),
    level: z.string().optional(),
  }),
  displacement: z.object({
    occurred: z.boolean(),
    notes: z.string(),
  }),
  killzone: z.object({
    aligned: z.boolean(),
    session: z.string(),
  }),
  premiumDiscount: z.string(),
  verdict: z.enum(["LONG", "SHORT", "STAND_ASIDE"]),
  confidence: z.number(),
  entry: z.string(),
  stopLoss: z.string(),
  takeProfit1: z.string(),
  takeProfit2: z.string(),
  riskReward: z.string(),
  checklist: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      pass: z.boolean(),
    }),
  ),
  missing: z.array(z.string()),
  narrative: z.string(),
  invalidation: z.string(),
});

const CASPER_SYSTEM = `You are Casper Desk v2 — Adaptive Kill-Zone Engine for crypto perps.
Non-negotiable hierarchy: 4H bias first → 15M confirmation → 1M entry. No trade if 4H is unclear or fights the 15M sequence.

Hard vetoes (never soften):
- Displacement = true ONLY if the impulse candle range ≥ 1.2 × 14-period 15M ATR. Below that, Override is blocked.
- 15M MSS direction AND FVG direction must both exactly equal current 4H bias. Any mismatch → STAND_ASIDE.
- Never invent levels or sequences.

London raid model:
1. Asia 20:00–00:00 NY maps the range. Do not trade the grind unless Exceptional Override or vol+OI spike ≥1.5× (then half-size only).
2. Primary KZ (full 0.5–1.0%): London 02:00–05:00 NY and NY 07:00–10:00 NY.
3. Sequence: time-based Sweep of Asia H/L, London H/L or PDH/PDL → Displacement (≥1.2×ATR) → 15M MSS → first FVG (or OB) of the displacement. Limit at 50% of that FVG.
4. Secondary (half 0.25–0.5%): London close, NY 10:00–12:00 and 14:00–16:00, Asia only if volume AND OI ≥1.5× 20-period average.
5. Exceptional Override (half-size, clock is NOT a veto) only when ALL are true: 4H bias clear AND complete sequence AND 15M MSS+FVG match 4H AND ≥2 of OI / CVD / heatmap / RS vs BTC. Alts require RS vs BTC leading (alt 4H return > BTC 4H return over last 4 candles, or alt HH/HL while BTC is flat/weaker).
6. NY is continuation of London, not a reverse.
7. If incomplete, STAND_ASIDE and name the single highest-priority missing piece.
8. Invalidation = reclaim of the swept level with force.
Return JSON only. confidence 0-100. verdict LONG | SHORT | STAND_ASIDE.`;

async function grokJson(opts: {
  model: string;
  messages: { role: "system" | "user"; content: unknown }[];
  max_tokens: number;
}): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("AI is not available in this environment");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: 0.2,
      max_tokens: opts.max_tokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI API error ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]?.message.content ?? "";
}

function parseAnalysis(raw: string, fallback: Analysis, source: Analysis["source"], model: string): Analysis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  const parsed = analysisSchema.safeParse(JSON.parse(json));
  if (!parsed.success) return fallback;
  return { ...fallback, ...parsed.data, source, model };
}

export const fetchTapeFn = createServerFn({ method: "POST" })
  .validator((input: { symbol: string }) => input)
  .handler(async ({ data }) => {
    try {
      const tape = await fetchOkxTape(data.symbol);
      return { ok: true as const, tape: plain(tape) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tape failed";
      return { ok: false as const, error: message };
    }
  });

export const fetchWatchlistFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const tickers = await fetchWatchlist();
    return { ok: true as const, tickers: plain(tickers) };
  } catch {
    return { ok: false as const, tickers: [] as { symbol: string; price: number; changePct: number }[] };
  }
});

export const scanMajorsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const hits = await scanMajors();
    return { ok: true as const, hits: plain(hits) };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Radar failed";
    return { ok: false as const, hits: [], error };
  }
});

export const analyzeTapeFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      pair: string;
      notes?: string;
      tape: string;
      bars15?: string;
      bars1h?: string;
      bars4h?: string;
      mech?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI is not available" };
    try {
      const raw = await grokJson({
        model: "grok-4.5",
        max_tokens: 1100,
        messages: [
          { role: "system", content: CASPER_SYSTEM },
          {
            role: "user",
            content: [
              `Pair: ${data.pair}`,
              data.notes ? `Trader notes: ${data.notes}` : "",
              data.mech ? `Mechanical flags: ${data.mech}` : "",
              data.tape,
              data.bars15 ? `15m bars:\n${data.bars15}` : "",
              data.bars1h ? `1H bars:\n${data.bars1h}` : "",
              data.bars4h ? `4H bars:\n${data.bars4h}` : "",
              "Respond with a single JSON object for the analysis schema.",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      });
      const stub = blankAnalysis(data.pair);
      stub.source = "tape";
      stub.model = "grok-4.5";
      return { ok: true as const, analysis: parseAnalysis(raw, stub, "tape", "grok-4.5") };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Read failed" };
    }
  });

export const analyzeVisionFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      pair: string;
      notes?: string;
      tape?: string;
      charts: { tf: Timeframe; mime: string; data: string }[];
    }) => input,
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI is not available" };
    try {
      const images = data.charts.slice(0, 4).map((c) => ({
        type: "image_url" as const,
        image_url: { url: `data:${c.mime};base64,${c.data}` },
      }));
      const content = [
        {
          type: "text" as const,
          text: [
            `Pair: ${data.pair}. Timeframes attached: ${data.charts.map((c) => c.tf).join(", ")}.`,
            data.notes ? `Notes: ${data.notes}` : "",
            data.tape ?? "",
            "Read the Casper v2 sequence from the screenshots + tape. JSON only. Do not invent a setup if Sweep → MSS → FVG is incomplete.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        ...images,
      ];
      const raw = await grokJson({
        model: "grok-4.5",
        max_tokens: 1200,
        messages: [
          { role: "system", content: CASPER_SYSTEM },
          { role: "user", content },
        ],
      });
      const stub = blankAnalysis(data.pair);
      stub.source = "vision";
      stub.model = "grok-4.5";
      return { ok: true as const, analysis: parseAnalysis(raw, stub, "vision", "grok-4.5") };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Vision failed" };
    }
  });

export const scanKzFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      pair: string;
      session: string;
      notes: string[];
      sweep: "bullish" | "bearish" | null;
      lastClose: number;
      tape: string;
      bars: { t: number; o: number; h: number; l: number; c: number }[];
    }) => input,
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI is not available" };
    try {
      const raw = await grokJson({
        model: "grok-4.5",
        max_tokens: 280,
        messages: [
          {
            role: "system",
            content:
              'You confirm Casper v2 15m kill-zone raids. JSON: {"verdict":"SETUP"|"CLEAR"|"WATCH","confidence":0-100,"note":"one tight sentence"}. SETUP only if a time-based Asia/PDH-PDL raid + displacement is present, 4H does not conflict, and it is not fading the London day. Override (half-size) is allowed outside London/NY when the sequence is complete.',
          },
          {
            role: "user",
            content: [
              `${data.pair} · ${data.session} · last ${G(data.lastClose)} · sweep ${data.sweep ?? "none"}`,
              data.notes.join(". "),
              data.tape,
              data.bars
                .slice(-16)
                .map((b) => `${b.t} o${b.o} h${b.h} l${b.l} c${b.c}`)
                .join("\n"),
            ].join("\n"),
          },
        ],
      });
      const parsed = z
        .object({
          verdict: z.enum(["SETUP", "CLEAR", "WATCH"]),
          confidence: z.number().optional(),
          note: z.string(),
        })
        .parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
      return { ok: true as const, ...parsed, confidence: parsed.confidence ?? 50 };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Scan failed" };
    }
  });

export function mechFlags(tape: Tape) {
  const levels = sessionLevels(tape.candles);
  const raid = scanRaid(tape.candles);
  const asia = `Asia ${levels.asiaLow ? G(levels.asiaLow) : "—"}–${levels.asiaHigh ? G(levels.asiaHigh) : "—"} | PDH ${levels.pdh ? G(levels.pdh) : "—"} PDL ${levels.pdl ? G(levels.pdl) : "—"}`;
  const flow = `OI Δ ${tape.oiDeltaPct.toFixed(1)}% · vol ${tape.volRatio.toFixed(2)}× · RS ${tape.relStrength} · CVD ${tape.cvd >= 0 ? "up" : "down"}`;
  return [asia, flow, raid?.notes.join("; ")].filter(Boolean).join(" | ");
}

export { barTape, mechanicalRead, tapePrompt };
