"use client";
import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const Ctx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 lg:top-4 lg:right-4 lg:bottom-auto lg:left-auto lg:items-end"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-sm animate-slide-up items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-[var(--shadow-pop)] ${
              t.kind === "success" ? "bg-emerald-600" : t.kind === "error" ? "bg-rose-600" : "bg-slate-800"
            }`}
          >
            <span aria-hidden>{t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return {
    success: (t: string) => push("success", t),
    error: (t: string) => push("error", t),
    info: (t: string) => push("info", t),
  };
}
