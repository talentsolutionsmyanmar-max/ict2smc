export function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

export function fmtPx(n: number) {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1000) return n.toFixed(1);
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toPrecision(5);
  return n.toPrecision(5);
}

export function G(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 100) return n.toFixed(2);
  return n.toPrecision(5);
}

export function fmtUsd(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtNotional(n: number) {
  if (!Number.isFinite(n)) return "—";
  const t = Math.abs(n);
  if (t >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (t >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (t >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtSignedUsd(n: number) {
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  const body =
    abs >= 1e9
      ? `${(abs / 1e9).toFixed(2)}B`
      : abs >= 1e6
        ? `${(abs / 1e6).toFixed(1)}M`
        : abs >= 1e3
          ? `${(abs / 1e3).toFixed(1)}K`
          : abs.toFixed(0);
  return `${n >= 0 ? "+" : "−"}${body}`;
}

export function compactPair(symbol: string) {
  const t = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t.endsWith("USDT") ? t.slice(0, -4) : t || "HYPE";
}

export function normalizePair(symbol: string) {
  const t = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") || "HYPEUSDT";
  return t.endsWith("USDT") ? t : `${t}USDT`;
}
