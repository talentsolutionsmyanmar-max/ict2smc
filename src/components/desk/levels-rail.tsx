import { cn } from "@/lib/utils";
import { fitPx } from "@/lib/desk/format";
import { distPct, railChips } from "@/lib/desk/rail";
import { useDesk } from "@/lib/desk/store";

function copyPx(px: number) {
  void navigator.clipboard?.writeText(fitPx(px)).catch(() => undefined);
}

function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptic */
  }
}

export function LevelsRail({
  onFocus,
  className,
}: {
  onFocus?: (px: number) => void;
  className?: string;
}) {
  const tape = useDesk((s) => s.tape);
  const analysis = useDesk((s) => s.analysis);
  const chips = railChips(analysis, tape);
  const mark = tape?.mark || 0;
  return (
    <aside className={cn("flex flex-col justify-evenly overflow-hidden border-l border-border bg-surface", className)}>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={cn("flex flex-col items-center justify-center px-0.5 py-1", c.pending ? "text-warn" : "text-fg")}
          onClick={() => copyPx(c.px)}
          onContextMenu={(e) => {
            e.preventDefault();
            onFocus?.(c.px);
            buzz(18);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== "touch") return;
            const id = window.setTimeout(() => {
              onFocus?.(c.px);
              buzz(18);
            }, 420);
            const up = () => {
              window.clearTimeout(id);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointerup", up);
          }}
        >
          <span className="rail-lab font-mono text-kicker uppercase">{c.label}{c.filled ? " ·" : ""}</span>
          <span className="rail-px font-mono tabular-nums">{fitPx(c.px)}</span>
          <span className={cn("rail-pct font-mono tabular-nums", c.pending ? "text-warn" : "text-muted")}>
            {distPct(c.px, mark)}%
          </span>
        </button>
      ))}
    </aside>
  );
}
