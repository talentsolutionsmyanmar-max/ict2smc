import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDesk } from "@/lib/desk/store";
import type { Timeframe } from "@/lib/desk/types";
import { runRead } from "./run-read";

const TFS: Timeframe[] = ["4H", "1H", "15M", "1M"];
const HINT: Record<Timeframe, string> = {
  "4H": "HTF bias",
  "1H": "intraday",
  "15M": "entry",
  "1M": "precision",
};

const MAX_EDGE = 720;
const MAX_BYTES = 160000;

function cropDark(img: ImageBitmap) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  ctx.drawImage(img, 0, 0, 64, 64);
  const { data } = ctx.getImageData(0, 0, 64, 64);
  let minX = 64,
    minY = 64,
    maxX = 0,
    maxY = 0,
    dark = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (lum < 92) {
        dark += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const area = (maxX - minX + 1) * (maxY - minY + 1);
  if (dark < 655.36 || area < 1146.88) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(63, maxX + 2);
  maxY = Math.min(63, maxY + 2);
  return {
    sx: Math.round((minX / 64) * img.width),
    sy: Math.round((minY / 64) * img.height),
    sw: Math.round(((maxX - minX + 1) / 64) * img.width),
    sh: Math.round(((maxY - minY + 1) / 64) * img.height),
  };
}

async function compress(file: File) {
  const bmp = await createImageBitmap(file);
  const box = cropDark(bmp);
  let scale = Math.min(1, MAX_EDGE / Math.max(box.sw, box.sh));
  let w = Math.max(1, Math.round(box.sw * scale));
  let h = Math.max(1, Math.round(box.sh * scale));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  let q = 0.5;
  let blob: Blob | null = null;
  for (let i = 0; i < 4; i++) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bmp, box.sx, box.sy, box.sw, box.sh, 0, 0, w, h);
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Compress failed"))), "image/jpeg", q);
    });
    if (blob.size <= MAX_BYTES) break;
    q = Math.max(0.38, q - 0.08);
    w = Math.max(480, Math.round(w * 0.86));
    h = Math.max(270, Math.round(h * 0.86));
  }
  bmp.close();
  const data = await blobToB64(blob!);
  return { mime: "image/jpeg", data, preview: URL.createObjectURL(blob!) };
}

function blobToB64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Read failed"));
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

function guessTf(name: string): Timeframe | null {
  const t = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.includes("15m") || t.includes("m15") || t.includes("15min")) return "15M";
  if (t.includes("4h") || t.includes("h4") || t.includes("240m")) return "4H";
  if (t.includes("1h") || t.includes("h1") || t.includes("60m") || t.includes("60min")) return "1H";
  if (t.includes("1m") || t.includes("m1") || t.includes("1min")) return "1M";
  return null;
}

function nextTf(slots: Partial<Record<Timeframe, unknown>>, prefer?: Timeframe | null): Timeframe {
  if (prefer && !slots[prefer]) return prefer;
  return TFS.find((tf) => !slots[tf]) ?? prefer ?? "4H";
}

async function ingest(files: File[], prefer?: Timeframe) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) {
    if (files.length) toast.error("Upload chart screenshots.");
    return;
  }
  try {
    if (images.length === 1) {
      const file = images[0];
      const tf = prefer ?? guessTf(file.name) ?? nextTf(useDesk.getState().slots);
      useDesk.getState().setSlot(tf, await compress(file));
      return;
    }
    const used = new Set<Timeframe>();
    const leftover: File[] = [];
    for (const file of images) {
      const tf = guessTf(file.name);
      if (tf && !used.has(tf)) {
        used.add(tf);
        useDesk.getState().setSlot(tf, await compress(file));
      } else leftover.push(file);
    }
    const order = prefer ? [prefer, ...TFS.filter((t) => t !== prefer)] : [...TFS];
    for (const file of leftover) {
      const slots = useDesk.getState().slots;
      const tf = order.find((t) => !used.has(t) && !slots[t]) ?? order.find((t) => !used.has(t));
      if (!tf) break;
      used.add(tf);
      useDesk.getState().setSlot(tf, await compress(file));
    }
  } catch {
    toast.error("Could not read that image.");
  }
}

export function ChartDrop() {
  const input = useRef<HTMLInputElement>(null);
  const busy = useDesk((s) => s.busy);
  const n = useDesk((s) => Object.keys(s.slots).length);
  return (
    <section className="space-y-3">
      <div
        className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void ingest(Array.from(e.dataTransfer.files));
        }}
      >
        <div>
          <p className="text-sm text-fg">Charts optional — live 15m already reads</p>
          <p className="mt-0.5 text-xs text-muted">
            Drop 4H or 15M to confirm with vision. One photo is enough. Auto-runs, then falls back to live tape if vision
            is slow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void ingest(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {n ? "Add charts" : "Upload charts"}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TFS.map((tf) => (
          <Slot key={tf} tf={tf} />
        ))}
      </div>
    </section>
  );
}

function Slot({ tf }: { tf: Timeframe }) {
  const input = useRef<HTMLInputElement>(null);
  const slot = useDesk((s) => s.slots[tf]);
  const clearSlot = useDesk((s) => s.clearSlot);
  const swapSlots = useDesk((s) => s.swapSlots);
  const busy = useDesk((s) => s.busy);
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn(
        "relative min-h-[168px] overflow-hidden rounded-lg border bg-elevated",
        over ? "border-accent" : "border-border",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const from = e.dataTransfer.getData("text/tf") as Timeframe;
        if (from && TFS.includes(from)) {
          swapSlots(from, tf);
          return;
        }
        void ingest(Array.from(e.dataTransfer.files), tf);
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          void ingest(Array.from(e.target.files ?? []), tf);
          e.target.value = "";
        }}
      />
      {slot ? (
        <>
          <img
            src={slot.preview}
            alt={`${tf} chart`}
            draggable={!busy}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/tf", tf);
              e.dataTransfer.effectAllowed = "move";
            }}
            className="h-40 w-full object-cover object-top md:h-44"
          />
          <button
            type="button"
            aria-label={`Remove ${tf}`}
            disabled={busy}
            onClick={() => clearSlot(tf)}
            className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-sm bg-bg/80 text-fg"
          >
            <X className="size-4" />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 px-3 text-center md:h-44"
        >
          <ImagePlus className="size-5 text-muted" />
          <span className="text-sm text-muted">Drop {tf}</span>
        </button>
      )}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <div>
          <p className="font-mono text-xs text-fg">{tf}</p>
          <p className="text-micro text-subtle">{HINT[tf]}</p>
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
          {slot ? "Replace" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

export function TranslateForm() {
  const pair = useDesk((s) => s.pair);
  const setPair = useDesk((s) => s.setPair);
  const notes = useDesk((s) => s.notes);
  const setNotes = useDesk((s) => s.setNotes);
  const busy = useDesk((s) => s.busy);
  const pending = useDesk((s) => s.pending);
  const clearAll = useDesk((s) => s.clearAll);
  const slots = useDesk((s) => s.slots);
  const tape = useDesk((s) => s.tape);
  const n = Object.keys(slots).length;
  const ready = n > 0 || !!tape?.candles.length;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex-1">
          <span className="font-mono text-micro uppercase tracking-label text-subtle">Pair</span>
          <input
            value={pair}
            onChange={(e) => setPair(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void runRead({ forceLlm: true });
            }}
            className="mt-1 h-11 w-full rounded-sm border border-border bg-elevated px-3 font-mono text-sm text-fg outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="HYPEUSDT"
            disabled={busy}
          />
        </label>
        <label className="flex-[2]">
          <span className="font-mono text-micro uppercase tracking-label text-subtle">Notes</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 h-11 w-full rounded-sm border border-border bg-elevated px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Optional: news, session"
            disabled={busy}
          />
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={clearAll} disabled={busy}>
            Clear
          </Button>
          <Button onClick={() => void runRead({ forceLlm: true })} disabled={busy || !ready}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {busy ? "Reading" : pending ? "Auto…" : n ? "Re-run" : "Read live 15m"}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        {pending
          ? "Auto-translating charts. If vision is slow, live 15m + OI/CVD takes over."
          : n
            ? tape
              ? `Charts + tape. ${tape.read.split(".")[0]}.`
              : "Charts in. Live tape will attach as soon as it lands."
            : tape
              ? "No screenshot needed — desk auto-reads live 4H / 1H / 15m + OI, CVD, heatmap. Drop a 4H photo only if you want vision confirmation."
              : "Waiting on live tape. Charts are optional."}
      </p>
    </div>
  );
}
