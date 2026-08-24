import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-elevated text-muted border-border",
  long: "bg-long/15 text-long border-long/30",
  short: "bg-short/15 text-short border-short/30",
  warn: "bg-warn/15 text-warn border-warn/30",
  live: "bg-long/15 text-long border-long/30",
} as const;

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof tones;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
