"use client";
/**
 * Lịch công việc theo HẠN (v1.24.0) — chỉ xem, bấm một việc để mở chi tiết.
 * Tháng: lưới 6 hàng × 7 cột từ thứ Hai (tháng dài nhất cũng vừa — bản TeamTask cố định 5 tuần nên thiếu ngày).
 * Tính ngày bằng src/lib/client/format.ts (giờ VN cố định), không dùng luxon.
 */
import { Button, cx, IconButton, Segmented } from "@/components/ui";
import { addDaysStr, fmtDay, fmtDayShort, fmtTime, todayStr, vnDateOf, weekdayOf, WEEKDAY_LONG, WEEKDAY_SHORT } from "@/lib/client/format";
import { calendarRange, shiftAnchor, type CalMode } from "@/lib/tasks/view-dates";

export { calendarRange, type CalMode };
import type { TaskDto } from "@/lib/tasks/types";
import { PriorityBadge, StatusBadge } from "./task-badges";




const CHIP: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-700",
  DOING: "bg-teal-50 text-teal-800",
  REVIEW: "bg-violet-50 text-violet-800",
  DONE: "bg-emerald-50 text-emerald-700 line-through",
};

function Chip({ t, onOpen }: { t: TaskDto; onOpen: (t: TaskDto) => void }) {
  const late = t.status !== "DONE" && new Date(t.dueAt).getTime() < Date.now();
  return (
    <button onClick={() => onOpen(t)} title={`${fmtTime(t.dueAt)} · ${t.title}`} className={cx("block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight", CHIP[t.status], late && "ring-1 ring-rose-400")}>
      <span className="hidden sm:inline">{fmtTime(t.dueAt)} </span>
      {t.title}
    </button>
  );
}

export function CalendarView({
  mode,
  anchor,
  tasks,
  onMode,
  onAnchor,
  onOpen,
}: {
  mode: CalMode;
  anchor: string;
  tasks: TaskDto[];
  onMode: (m: CalMode) => void;
  onAnchor: (d: string) => void;
  onOpen: (t: TaskDto) => void;
}) {
  const today = todayStr();
  const { from, to } = calendarRange(mode, anchor);
  const byDay = new Map<string, TaskDto[]>();
  for (const t of [...tasks].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const d = vnDateOf(t.dueAt);
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const title =
    mode === "month" ? `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}` : mode === "week" ? `Tuần ${fmtDayShort(from)} – ${fmtDay(to)}` : `${WEEKDAY_LONG[weekdayOf(anchor)]}, ${fmtDay(anchor)}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon="chevronLeft" label="Trước" onClick={() => onAnchor(shiftAnchor(mode, anchor, -1))} />
        <Button size="sm" variant="secondary" onClick={() => onAnchor(today)}>
          Hôm nay
        </Button>
        <IconButton icon="chevronRight" label="Sau" onClick={() => onAnchor(shiftAnchor(mode, anchor, 1))} />
        <p className="min-w-0 flex-1 truncate font-semibold text-slate-800">{title}</p>
        <Segmented
          value={mode}
          onChange={onMode}
          options={[
            { value: "day", label: "Ngày" },
            { value: "week", label: "Tuần" },
            { value: "month", label: "Tháng" },
          ]}
        />
      </div>

      {mode === "month" && (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <div key={w} className="py-1.5">
                {WEEKDAY_SHORT[w]}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => addDaysStr(from, i)).map((d) => {
              const list = byDay.get(d) ?? [];
              const other = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <div key={d} className={cx("min-h-20 min-w-0 border-r border-b border-slate-100 p-1 sm:min-h-24", other && "bg-slate-50/70", weekdayOf(d) === 7 && "border-r-0")}>
                  <button
                    onClick={() => {
                      onAnchor(d);
                      onMode("day");
                    }}
                    className={cx("mb-0.5 inline-flex size-6 items-center justify-center rounded-full text-xs", d === today ? "bg-brand-700 font-bold text-white" : other ? "text-slate-400" : "text-slate-700 hover:bg-slate-100")}
                  >
                    {Number(d.slice(8))}
                  </button>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((t) => (
                      <Chip key={t.id} t={t} onOpen={onOpen} />
                    ))}
                    {list.length > 3 && (
                      <button
                        className="block w-full text-left text-[11px] font-semibold text-brand-700"
                        onClick={() => {
                          onAnchor(d);
                          onMode("day");
                        }}
                      >
                        +{list.length - 3} việc
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === "week" && (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDaysStr(from, i)).map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className={cx("card min-w-0 p-2", d === today && "ring-2 ring-brand-400")}>
                <p className="mb-1 text-xs font-semibold text-slate-500">
                  {WEEKDAY_SHORT[weekdayOf(d)]} {fmtDayShort(d)}
                </p>
                <div className="space-y-1">
                  {list.map((t) => (
                    <Chip key={t.id} t={t} onOpen={onOpen} />
                  ))}
                  {!list.length && <p className="text-[11px] text-slate-400">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "day" && (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {(byDay.get(anchor) ?? []).map((t) => (
            <button key={t.id} onClick={() => onOpen(t)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
              <span className="w-12 text-sm font-semibold text-slate-600 tabular-nums">{fmtTime(t.dueAt)}</span>
              <span className={cx("min-w-0 flex-1 truncate text-sm text-slate-800", t.status === "DONE" && "text-slate-400 line-through")}>{t.title}</span>
              <PriorityBadge priority={t.priority} compact />
              <StatusBadge status={t.status} />
            </button>
          ))}
          {!(byDay.get(anchor) ?? []).length && <p className="px-4 py-8 text-center text-sm text-slate-500">Không có việc nào đến hạn ngày này.</p>}
        </div>
      )}
    </div>
  );
}
