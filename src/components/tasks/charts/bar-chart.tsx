"use client";
import { cx } from "@/components/ui";

export type BarItem = { key: string | number; label: string; value: number; part?: number; hint?: string; bar?: string };

/** Cột ngang: chiều dài theo `value`, phần tô đậm theo `part` (vd. đã xong trong tổng). */
export function BarChart({ items, partLabel }: { items: BarItem[]; partLabel?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.key}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className="shrink-0 text-xs text-slate-500 tabular-nums">
              {i.part !== undefined && partLabel ? `${i.part} ${partLabel} / ` : ""}
              <b className="text-slate-800">{i.value}</b>
              {i.hint ? ` · ${i.hint}` : ""}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cx("relative h-full rounded-full", i.bar ?? "bg-slate-300")} style={{ width: `${(i.value / max) * 100}%` }}>
              {i.part !== undefined && i.value > 0 && <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${(i.part / i.value) * 100}%` }} />}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
