"use client";
import { fmtDayShort } from "@/lib/client/format";

/** Đường tiến độ: tổng việc (xám) và đã xong (xanh) theo ngày. SVG co giãn theo bề ngang khung. */
export function BurnupChart({ data }: { data: { date: string; scope: number; done: number }[] }) {
  const W = 600;
  const H = 200;
  const PAD = { l: 32, r: 8, t: 10, b: 24 };
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.scope));
  const step = data.length > 1 ? (W - PAD.l - PAD.r) / (data.length - 1) : 0;
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const line = (k: "scope" | "done") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  const labels = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  const last = data.at(-1)!;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Tiến độ: ${last.done}/${last.scope} việc xong tới ${fmtDayShort(last.date)}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-slate-100" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="fill-slate-400 text-[11px]">
              {v}
            </text>
          </g>
        ))}
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-slate-400 text-[11px]">
            {fmtDayShort(data[i].date)}
          </text>
        ))}
        <path d={line("scope")} fill="none" className="stroke-slate-400" strokeWidth={2} strokeDasharray="5 4" />
        <path d={`${line("done")} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="fill-emerald-500/10" />
        <path d={line("done")} fill="none" className="stroke-emerald-600" strokeWidth={2.5} />
      </svg>
      <figcaption className="mt-1 flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-4 bg-slate-400" /> Tổng việc
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-4 bg-emerald-600" /> Đã xong
        </span>
      </figcaption>
    </figure>
  );
}
