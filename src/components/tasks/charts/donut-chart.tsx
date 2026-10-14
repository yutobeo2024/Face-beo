"use client";
import { cx } from "@/components/ui";

export type DonutItem = { label: string; value: number; stroke: string; dot: string };

/** Biểu đồ tròn rỗng giữa: mỗi phần = một vòng cung (stroke-dasharray), giữa ghi tổng. */
export function DonutChart({ items, center }: { items: DonutItem[]; center: string }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(", ")}>
        <circle cx={60} cy={60} r={R} fill="none" className="stroke-slate-100" strokeWidth={14} />
        {total > 0 &&
          items
            .filter((i) => i.value > 0)
            .map((i) => {
              const len = (i.value / total) * C;
              const el = (
                <circle
                  key={i.label}
                  cx={60}
                  cy={60}
                  r={R}
                  fill="none"
                  className={i.stroke}
                  strokeWidth={14}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              );
              offset += len;
              return el;
            })}
        <text x={60} y={58} textAnchor="middle" className="fill-slate-800 text-[22px] font-bold">
          {total}
        </text>
        <text x={60} y={76} textAnchor="middle" className="fill-slate-400 text-[10px]">
          {center}
        </text>
      </svg>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className={cx("size-2.5 rounded-full", i.dot)} />
            <span className="text-slate-600">{i.label}</span>
            <span className="font-semibold text-slate-800 tabular-nums">{i.value}</span>
            {total > 0 && <span className="text-xs text-slate-400">({Math.round((i.value / total) * 100)}%)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
