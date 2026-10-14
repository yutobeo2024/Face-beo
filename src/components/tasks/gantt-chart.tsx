"use client";
/**
 * Gantt dự án (v1.24.0) — SVG tự vẽ, không thư viện. Thanh = ngày bắt đầu → ngày của hạn (giờ VN), trong cửa sổ
 * [from, to] do trang chọn (mặc định quanh hôm nay — dự án nhiều năm không đẩy hôm nay ra khỏi khung).
 *
 * Kéo (chuột / bút): thân thanh dời cả hai ngày; mép trái đổi ngày bắt đầu; mép phải đổi hạn — bắt theo ngày, hạn giữ
 * nguyên GIỜ cũ. Thả ra ⇒ một PATCH (máy chủ kiểm quyền sửa như sửa việc thường).
 * Cảm ứng KHÔNG kéo: vuốt để cuộn, chạm để mở chi tiết rồi sửa ngày ở đó (vuốt lỡ tay không được đổi ngày của việc).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, cx, IconButton, Segmented } from "@/components/ui";
import { addDaysStr, daysBetween, fmtDay, fmtDayShort, fmtTime, todayStr, vnDateOf, weekdayOf, WEEKDAY_SHORT } from "@/lib/client/format";
import { TASK_STATUS_LABEL, type TaskDto } from "@/lib/tasks/types";
import { dragChange, type DragMode, type GanttChange } from "@/lib/tasks/view-dates";
import { DueText, StatusBadge } from "./task-badges";

const ROW = 36;
const HEAD = 44;
const ZOOMS = { day: 40, week: 20, month: 8 } as const;
type Zoom = keyof typeof ZOOMS;
const BAR_FILL: Record<string, string> = { TODO: "fill-slate-400", DOING: "fill-teal-600", REVIEW: "fill-violet-500", DONE: "fill-emerald-500" };
/** Di chuột quá ngần này (px) mới tính là kéo — rung tay lúc bấm vẫn là "bấm để mở". */
const DRAG_PX = 6;

type Drag = { id: number; mode: DragMode; x0: number; delta: number; moved: boolean };

export type GanttProps = {
  from: string;
  to: string;
  tasks: TaskDto[];
  unscheduled: TaskDto[];
  unscheduledTotal: number;
  onWindow: (from: string) => void;
  onOpen: (t: TaskDto) => void;
  onMove: (t: TaskDto, change: GanttChange) => void;
};

export default function GanttChart({ from, to, tasks, unscheduled, unscheduledTotal, onWindow, onOpen, onMove }: GanttProps) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const skipClickUntil = useRef(0); // vừa nhả chuột và đã xử lý (mở / dời) ⇒ bỏ qua sự kiện click đi ngay sau
  const scroller = useRef<HTMLDivElement>(null);
  const dayW = ZOOMS[zoom];
  const today = todayStr();
  const days = daysBetween(from, to) + 1;
  const width = days * dayW;

  const rows = useMemo(() => [...tasks].sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : a.dueAt.localeCompare(b.dueAt))), [tasks]);
  const byId = useMemo(() => new Map(rows.map((t, i) => [t.id, i])), [rows]);
  const height = HEAD + rows.length * ROW;
  const xOf = (date: string) => daysBetween(from, date) * dayW;

  // Mở trang / đổi cửa sổ / đổi mức xem: cuộn tới hôm nay (lùi 1/4 khung để thấy cả mấy ngày trước).
  const hasRows = rows.length > 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el || today < from || today > to) return;
    el.scrollLeft = Math.max(0, daysBetween(from, today) * dayW - el.clientWidth / 4);
  }, [from, to, dayW, today, hasRows]);

  /** Ngày bắt đầu / hạn đang hiển thị (kể cả phần đang kéo). */
  const span = (t: TaskDto) => {
    let s = t.startDate!;
    let e = vnDateOf(t.dueAt);
    if (drag?.id === t.id && drag.delta) {
      if (drag.mode !== "end") s = addDaysStr(s, drag.delta);
      if (drag.mode !== "start") e = addDaysStr(e, drag.delta);
      if (s > e) {
        if (drag.mode === "start") s = e;
        else e = s;
      }
    }
    return { s, e };
  };

  const clearDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };
  const startDrag = (e: React.PointerEvent, t: TaskDto, mode: DragMode) => {
    if (e.pointerType === "touch" || e.button !== 0 || !t.perms.edit) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const d = { id: t.id, mode, x0: e.clientX, delta: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!(e.buttons & 1)) return clearDrag(); // nhả chuột ngoài cửa sổ mà không nhận được pointerup
    const moved = d.moved || Math.abs(e.clientX - d.x0) > DRAG_PX;
    const delta = moved ? Math.round((e.clientX - d.x0) / dayW) : 0;
    if (delta !== d.delta || moved !== d.moved) {
      const next = { ...d, delta, moved };
      dragRef.current = next;
      setDrag(next);
    }
  };
  const endDrag = () => {
    const d = dragRef.current;
    clearDrag();
    if (!d) return;
    skipClickUntil.current = Date.now() + 400;
    const t = rows.find((x) => x.id === d.id); // theo id của lần kéo, không theo thanh nhận sự kiện nhả
    if (!t) return;
    const change = dragChange(t, d.mode, d.delta);
    if (change) onMove(t, change);
    else if (!d.delta) onOpen(t); // bấm (hoặc rung tay chưa đủ một ngày) = mở chi tiết
  };
  /** Cảm ứng / việc không sửa được: không có lần kéo nào ⇒ click mở chi tiết. */
  const clickBar = (t: TaskDto) => {
    if (Date.now() < skipClickUntil.current) return;
    onOpen(t);
  };

  const ticks = Array.from({ length: days }, (_, i) => addDaysStr(from, i));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon="chevronLeft" label="Lùi 30 ngày" onClick={() => onWindow(addDaysStr(from, -30))} />
        <Button size="sm" variant="secondary" onClick={() => onWindow(addDaysStr(today, -14))}>
          Hôm nay
        </Button>
        <IconButton icon="chevronRight" label="Tới 30 ngày" onClick={() => onWindow(addDaysStr(from, 30))} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
          {fmtDay(from)} – {fmtDay(to)}
        </p>
        <Segmented
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "day", label: "Ngày" },
            { value: "week", label: "Tuần" },
            { value: "month", label: "Tháng" },
          ]}
        />
      </div>
      <p className="text-xs text-slate-500">Máy tính: kéo thanh để dời ngày, kéo mép để đổi ngày bắt đầu / hạn. Điện thoại: chạm thanh để mở và sửa ngày. Vạch đỏ đứt là hôm nay.</p>

      {rows.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">Khoảng này chưa có việc nào có ngày bắt đầu. Đặt “Ngày bắt đầu” cho việc ở mục bên dưới để hiện lên Gantt.</p>
      ) : (
        <div className="card flex overflow-hidden">
          {/* Cột tên việc cố định */}
          <div className="w-32 shrink-0 border-r border-slate-200 sm:w-56">
            <div className="flex items-end border-b border-slate-200 px-3 pb-1 text-xs font-semibold text-slate-500" style={{ height: HEAD }}>
              Công việc
            </div>
            {rows.map((t) => (
              <button key={t.id} onClick={() => onOpen(t)} className="flex w-full items-center border-b border-slate-100 px-3 text-left text-sm hover:bg-slate-50" style={{ height: ROW }} title={t.title}>
                <span className={cx("truncate", t.status === "DONE" && "text-slate-400 line-through")}>{t.title}</span>
              </button>
            ))}
          </div>
          {/* Thang ngày cuộn ngang */}
          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
            <svg
              width={width}
              height={height}
              className="block select-none"
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={clearDrag}
              onLostPointerCapture={() => dragRef.current && clearDrag()}
            >
              <defs>
                <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="fill-slate-400" />
                </marker>
              </defs>
              {ticks.map((d, i) => {
                const wd = weekdayOf(d);
                // Nhãn ngày: mỗi ngày khi phóng to nhất, còn lại chỉ thứ Hai (cách 7 cột — không chồng chữ).
                const label = dayW >= 40 || wd === 1;
                return (
                  <g key={d}>
                    {wd === 7 && <rect x={i * dayW} y={HEAD} width={dayW} height={height - HEAD} className="fill-slate-50" />}
                    {(dayW >= 20 || wd === 1) && <line x1={i * dayW} x2={i * dayW} y1={HEAD - 8} y2={height} className="stroke-slate-100" />}
                    {label && (
                      <text x={i * dayW + 3} y={HEAD - 8} className="fill-slate-500 text-[10px]">
                        {dayW >= 40 ? `${WEEKDAY_SHORT[wd]} ${fmtDayShort(d)}` : fmtDayShort(d)}
                      </text>
                    )}
                    {d.endsWith("-01") && (
                      <text x={i * dayW + 3} y={14} className="fill-slate-700 text-[11px] font-semibold">
                        Tháng {Number(d.slice(5, 7))}/{d.slice(0, 4)}
                      </text>
                    )}
                  </g>
                );
              })}
              <line x1={0} x2={width} y1={HEAD} y2={HEAD} className="stroke-slate-200" />
              {rows.map((_, i) => (
                <line key={i} x1={0} x2={width} y1={HEAD + (i + 1) * ROW} y2={HEAD + (i + 1) * ROW} className="stroke-slate-100" />
              ))}
              {today >= from && today <= to && <line x1={xOf(today) + dayW / 2} x2={xOf(today) + dayW / 2} y1={HEAD - 4} y2={height} className="stroke-rose-500" strokeDasharray="4 3" />}
              {/* Phụ thuộc: từ cuối việc phải xong trước → đầu việc chờ */}
              {rows.flatMap((t) =>
                t.dependsOn
                  .filter((id) => byId.has(id))
                  .map((id) => {
                    const a = span(rows[byId.get(id)!]);
                    const b = span(t);
                    const x1 = xOf(a.e) + dayW;
                    const y1 = HEAD + byId.get(id)! * ROW + ROW / 2;
                    const x2 = xOf(b.s);
                    const y2 = HEAD + byId.get(t.id)! * ROW + ROW / 2;
                    const mx = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 12));
                    return <path key={`${id}-${t.id}`} d={`M${x1},${y1} H${mx} V${y2} H${x2 - 1}`} fill="none" className="stroke-slate-400" markerEnd="url(#gantt-arrow)" />;
                  }),
              )}
              {rows.map((t, i) => {
                const { s, e } = span(t);
                const x = xOf(s);
                const w = Math.max(dayW, (daysBetween(s, e) + 1) * dayW);
                const y = HEAD + i * ROW + 7;
                const h = ROW - 14;
                const late = t.status !== "DONE" && new Date(t.dueAt).getTime() < Date.now();
                const edit = t.perms.edit;
                return (
                  <g key={t.id} className={cx(edit ? "cursor-grab" : "cursor-pointer", drag?.id === t.id && "cursor-grabbing")} onClick={() => clickBar(t)}>
                    <title>{`${t.title} — ${TASK_STATUS_LABEL[t.status]} · ${fmtDayShort(s)} → ${fmtDayShort(e)} ${fmtTime(t.dueAt)}`}</title>
                    <rect
                      x={x + 1}
                      y={y}
                      width={w - 2}
                      height={h}
                      rx={5}
                      className={cx(BAR_FILL[t.status] ?? "fill-slate-400", late && "stroke-rose-600", drag?.id === t.id && "opacity-80")}
                      strokeWidth={late ? 2 : 0}
                      onPointerDown={(ev) => startDrag(ev, t, "move")}
                    />
                    {w > 60 && (
                      <text x={x + 8} y={y + h / 2 + 4} className="pointer-events-none fill-white text-[11px] font-medium">
                        {t.title.length > w / 7 ? `${t.title.slice(0, Math.max(3, Math.floor(w / 7) - 1))}…` : t.title}
                      </text>
                    )}
                    {edit && (
                      <>
                        <rect x={x} y={y} width={8} height={h} className="cursor-ew-resize fill-transparent" onPointerDown={(ev) => startDrag(ev, t, "start")} />
                        <rect x={x + w - 8} y={y} width={8} height={h} className="cursor-ew-resize fill-transparent" onPointerDown={(ev) => startDrag(ev, t, "end")} />
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {unscheduledTotal > 0 && (
        <div className="card overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
            Chưa có ngày bắt đầu ({unscheduledTotal}
            {unscheduledTotal > unscheduled.length ? `, hiện ${unscheduled.length} việc hạn gần nhất` : ""}) <span className="font-normal text-slate-500">— bấm để mở và đặt ngày</span>
          </p>
          <ul className="divide-y divide-slate-100">
            {unscheduled.map((t) => (
              <li key={t.id}>
                <button onClick={() => onOpen(t)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.title}</span>
                  <StatusBadge status={t.status} />
                  <DueText dueAt={t.dueAt} status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
