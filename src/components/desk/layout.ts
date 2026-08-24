import { useEffect, useState } from "react";

const KEY = "casper-layout";
export type DeskLayout = "phone" | "desk";

export function autoLayout(): DeskLayout {
  if (typeof window === "undefined") return "desk";
  if (window.innerWidth < 1024) return "phone";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return coarse ? "phone" : "desk";
}

export function useDeskLayout() {
  const [layout, setLayout] = useState<DeskLayout>(() => autoLayout());

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    const apply = saved === "phone" || saved === "desk" ? saved : autoLayout();
    document.documentElement.dataset.layout = apply;
    setLayout(apply);
    const on = () => {
      if (localStorage.getItem(KEY) === "phone" || localStorage.getItem(KEY) === "desk") return;
      const next = autoLayout();
      document.documentElement.dataset.layout = next;
      setLayout(next);
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  function choose(next: DeskLayout) {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* quota */
    }
    setLayout(next);
    document.documentElement.dataset.layout = next;
  }

  return { layout, choose };
}
