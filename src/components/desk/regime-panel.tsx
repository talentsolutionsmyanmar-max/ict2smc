import { Badge } from "./badge";
import { Button } from "@/components/ui/button";
import { windowLabel, reviewStats, type WindowStats } from "@/lib/desk/regime";
import { useDesk } from "@/lib/desk/store";
import type { AuditOutcome, AuditRow } from "@/lib/desk/types";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Hit({ label, s }: { label: string; s: WindowStats }) {
  return (
    <div className="rounded-md border border-border bg-elevated px-3 py-3">
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">{label}</p>
      <p className="mt-1 font-mono text-sm text-fg">
        {s.n} · {s.n ? pct(s.hit) : "—"} hit
      </p>
      <p className="mt-0.5 font-mono text-micro text-muted">
        {s.wins}W / {s.losses}L
      </p>
    </div>
  );
}

function outcomeLabel(o: AuditRow["outcome"]) {
  if (o === "missed_2r") return "MISSED_2R+";
  return o.replace("_", " ");
}

function outcomeTone(o: AuditRow["outcome"]): "live" | "long" | "short" | "warn" | "neutral" {
  if (o === "win") return "long";
  if (o === "loss") return "short";
  if (o === "missed_2r") return "warn";
  if (o === "scratch") return "neutral";
  return "live";
}

export function RegimePanel() {
  const audit = useDesk((s) => s.audit);
  const book = useDesk((s) => s.riskBook);
  const markAudit = useDesk((s) => s.markAudit);
  const stats = reviewStats(audit);
  const nextFull = book.needPrimaryWinner
    ? "Need one full Primary-KZ winner before size-up"
    : book.fullWinStreak >= 2
      ? "Geometric +25% armed (cap 1.5%)"
      : `${2 - book.fullWinStreak} full winner${2 - book.fullWinStreak === 1 ? "" : "s"} to size-up`;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase tracking-label text-subtle">kz-v2 book</p>
          <h2 className="text-sm font-medium text-fg">Risk · opportunity cost</h2>
        </div>
        <Badge tone={book.needPrimaryWinner ? "warn" : book.fullWinStreak >= 2 ? "live" : "neutral"}>
          streak {book.fullWinStreak}
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{nextFull}. Open half-size {book.openHalf}/2. Open risk cap 3%.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Hit label="Primary" s={stats.primary} />
        <Hit label="Secondary" s={stats.secondary} />
        <Hit label="Override" s={stats.override} />
        <div className="rounded-md border border-border bg-elevated px-3 py-3">
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">MISSED_2R+</p>
          <p className="mt-1 font-mono text-sm text-fg">{stats.missed}</p>
          <p className="mt-0.5 font-mono text-micro text-muted">{stats.woulds} would-have-beens</p>
        </div>
      </div>

      <h3 className="mt-5 text-sm font-medium text-fg">15m audit</h3>
      {audit.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Signals and would-have-beens log here on every 15m close.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {audit.slice(0, 10).map((row) => (
            <AuditItem key={row.id} row={row} onMark={markAudit} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditItem({
  row,
  onMark,
}: {
  row: AuditRow;
  onMark: (id: string, outcome: AuditOutcome) => void;
}) {
  const r = row.rMultiple;
  const canMark = row.verdict !== "STAND_ASIDE" && row.outcome === "open";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-fg">{row.pair}</span>
          <Badge tone={row.verdict === "LONG" ? "long" : row.verdict === "SHORT" ? "short" : "warn"}>
            {row.verdict.replace("_", " ")}
          </Badge>
          <Badge tone={row.window === "primary" ? "live" : row.window === "dead" || row.window === "map" ? "neutral" : "warn"}>
            {windowLabel(row.window)}
          </Badge>
          {row.wouldHaveBeen && row.outcome !== "missed_2r" ? <Badge tone="warn">would-have</Badge> : null}
          <Badge tone={outcomeTone(row.outcome)}>{outcomeLabel(row.outcome)}</Badge>
        </div>
        <span className="font-mono text-micro text-subtle">
          {new Date(row.at).toLocaleString()} · {row.size} {row.riskPct}%
          {r != null ? ` · ${r >= 0 ? "+" : ""}${r.toFixed(1)}R` : ""}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{row.sequence}</p>
      {row.verdict === "STAND_ASIDE" && row.missingPriority ? (
        <p className="mt-1 text-xs text-warn">{row.missingPriority}</p>
      ) : null}
      {canMark ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => onMark(row.id, "win")}>
            Win
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onMark(row.id, "loss")}>
            Loss
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMark(row.id, "scratch")}>
            Scratch
          </Button>
        </div>
      ) : null}
    </li>
  );
}
