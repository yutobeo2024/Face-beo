"use client";
import { useMemo, useState } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { addDaysStr, fmtDay, fmtDayShort, mondayOf, todayStr, weekdayOf, WEEKDAY_SHORT } from "@/lib/client/format";
import { Button, Card, cx, EmptyState, ErrorBox, IconButton, Loading, Modal, PageHeader } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";

type Shift = { id: number; name: string; startTime: string; endTime: string };
type Cell = { shiftId: number | null; isDayOff: boolean; source: "SCHEDULE" | "DEFAULT"; locked: boolean };
type Row = { id: number; code: string; name: string; department: { name: string }; defaultShiftId: number; rotating: boolean; cells: Record<string, Cell> };
type Roster = { week: string; dates: string[]; today: string; shifts: Shift[]; holidays: Record<string, string>; employees: Row[] };

const PALETTE = [
  "bg-emerald-100 text-emerald-900 ring-emerald-300",
  "bg-sky-100 text-sky-900 ring-sky-300",
  "bg-indigo-100 text-indigo-900 ring-indigo-300",
  "bg-amber-100 text-amber-900 ring-amber-300",
  "bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300",
  "bg-teal-100 text-teal-900 ring-teal-300",
];

type Choice = { kind: "shift"; shiftId: number } | { kind: "off" } | { kind: "default" };

export default function RosterPage() {
  const toast = useToast();
  const [week, setWeek] = useState(mondayOf(todayStr()));
  const [dept, setDept] = useState("");
  const [rotatingOnly, setRotatingOnly] = useState(false);
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ keys: string[]; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const url = `/api/roster${qs({ week, departmentId: dept, rotatingOnly: rotatingOnly ? 1 : "" })}`;
  const { data, error, loading, reload, setData } = useApi<Roster>(url);

  const colorOf = useMemo(() => {
    const m = new Map<number, string>();
    data?.shifts.forEach((s, i) => m.set(s.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [data?.shifts]);
  const shiftById = useMemo(() => new Map(data?.shifts.map((s) => [s.id, s])), [data?.shifts]);

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function onCell(row: Row, date: string) {
    const key = `${row.id}|${date}`;
    if (row.cells[date].locked) return toast.info("Ngày đã qua và đã có log chấm công — chỉ ADMIN được sửa");
    if (multi) return toggle(key);
    setEditing({ keys: [key], title: `${row.name} · ${WEEKDAY_SHORT[weekdayOf(date)]} ${fmtDay(date)}` });
  }

  async function apply(choice: Choice) {
    if (!editing || !data) return;
    setSaving(true);
    const cells = editing.keys.map((k) => {
      const [employeeId, date] = k.split("|");
      return {
        employeeId: Number(employeeId),
        date,
        shiftId: choice.kind === "shift" ? choice.shiftId : null,
        isDayOff: choice.kind === "off",
        clear: choice.kind === "default" ? true : undefined,
      };
    });
    // Cập nhật lạc quan
    const prev = data;
    setData({
      ...data,
      employees: data.employees.map((e) => ({
        ...e,
        cells: Object.fromEntries(
          Object.entries(e.cells).map(([d, c]) => {
            if (!editing.keys.includes(`${e.id}|${d}`)) return [d, c];
            if (choice.kind === "default") return [d, { ...c, source: "DEFAULT", shiftId: weekdayOf(d) === 7 || data.holidays[d] ? null : e.defaultShiftId, isDayOff: weekdayOf(d) === 7 || !!data.holidays[d] }];
            return [d, { ...c, source: "SCHEDULE", shiftId: choice.kind === "shift" ? choice.shiftId : null, isDayOff: choice.kind === "off" }];
          }),
        ),
      })),
    });
    setEditing(null);
    try {
      const r = await api<{ saved: number; skipped: number }>("/api/roster", { method: "PUT", body: { cells } });
      toast.success(`Đã lưu ${r.saved} ô${r.skipped ? `, bỏ qua ${r.skipped} ô bị khóa` : ""}`);
      setSelected(new Set());
      void reload();
    } catch (e) {
      setData(prev);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function copyLastWeek() {
    setSaving(true);
    try {
      const r = await api<{ saved: number; skipped: number; message?: string }>("/api/roster/copy-week", {
        body: { fromWeek: addDaysStr(week, -7), toWeek: week, departmentId: dept || undefined },
      });
      toast.success(r.message ?? `Đã sao chép ${r.saved} ô từ tuần trước${r.skipped ? ` (bỏ qua ${r.skipped})` : ""}`);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Bảng xếp ca tuần"
        subtitle="Ô xám là ca mặc định. Bấm ô để chọn ca hoặc Nghỉ — lưu ngay."
        actions={
          <Button variant="secondary" icon="copy" onClick={copyLastWeek} loading={saving && !editing} size="sm">
            Sao chép tuần trước
          </Button>
        }
      />

      <Card className="mb-3 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronLeft" label="Tuần trước" onClick={() => setWeek(addDaysStr(week, -7))} />
          <button className="min-w-0 rounded-lg px-2 py-1 text-[15px] font-semibold text-slate-800 hover:bg-slate-100" onClick={() => setWeek(mondayOf(todayStr()))} title="Về tuần này">
            {fmtDayShort(week)} – {fmtDay(addDaysStr(week, 6))}
          </button>
          <IconButton icon="chevronRight" label="Tuần sau" onClick={() => setWeek(addDaysStr(week, 7))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeptSelect value={dept} onChange={setDept} className="w-full sm:w-52" />
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">
            <input type="checkbox" className="size-4 accent-brand-700" checked={rotatingOnly} onChange={(e) => setRotatingOnly(e.target.checked)} />
            Chỉ nhóm xoay ca
          </label>
          <Button
            size="md"
            variant={multi ? "primary" : "secondary"}
            icon="check"
            onClick={() => {
              setMulti((m) => !m);
              setSelected(new Set());
            }}
          >
            {multi ? "Đang chọn nhiều" : "Chọn nhiều"}
          </Button>
        </div>
      </Card>

      {data && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
          {data.shifts.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className={cx("size-3 rounded ring-1", colorOf.get(s.id))} /> {s.name} {s.startTime}–{s.endTime}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded bg-slate-100 ring-1 ring-slate-300" /> Ca mặc định
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded bg-white ring-1 ring-slate-300 [background-image:repeating-linear-gradient(45deg,#e2e8f0_0_2px,transparent_2px_6px)]" /> Nghỉ
          </span>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.employees.length === 0 ? (
        <Card>
          <EmptyState icon="users" title="Không có nhân viên">
            {rotatingOnly ? "Chưa có ai trong nhóm xoay ca." : "Không có nhân viên trong phạm vi bạn quản lý."}
          </EmptyState>
        </Card>
      ) : (
        data && (
          <Card className="overflow-hidden">
            <div className="scroll-x max-h-[70dvh]">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-30 w-40 min-w-40 border-r border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase sm:w-52 sm:min-w-52">Nhân viên</th>
                    {data.dates.map((d) => (
                      <th
                        key={d}
                        className={cx(
                          "sticky top-0 z-20 border-b border-slate-200 px-1.5 py-2 text-center text-xs font-semibold",
                          d === data.today ? "bg-brand-50 text-brand-800" : weekdayOf(d) === 7 ? "bg-rose-50/60 text-rose-700" : "bg-slate-50 text-slate-500",
                        )}
                      >
                        <div className="uppercase">{WEEKDAY_SHORT[weekdayOf(d)]}</div>
                        <div className="text-[13px] font-bold text-slate-700">{fmtDayShort(d)}</div>
                        {data.holidays[d] && <div className="mt-0.5 truncate text-[10px] font-semibold text-violet-700">🎉 {data.holidays[d]}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id}>
                      <td className="sticky left-0 z-10 border-r border-b border-slate-100 bg-white px-3 py-1.5">
                        <p className="truncate font-semibold text-slate-800">{e.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {e.code} · {e.department.name}
                          {e.rotating && <span className="ml-1 text-brand-700">· xoay ca</span>}
                        </p>
                      </td>
                      {data.dates.map((d) => {
                        const c = e.cells[d];
                        const key = `${e.id}|${d}`;
                        const s = c.shiftId ? shiftById.get(c.shiftId) : null;
                        const sel = selected.has(key);
                        return (
                          <td key={d} className={cx("border-b border-slate-100 p-1", d === data.today && "bg-brand-50/40")}>
                            <button
                              onClick={() => onCell(e, d)}
                              className={cx(
                                "relative flex h-12 w-full min-w-[84px] flex-col items-center justify-center rounded-lg px-1 text-xs leading-tight ring-1 transition",
                                c.isDayOff || !s
                                  ? "bg-white text-slate-400 ring-slate-200 [background-image:repeating-linear-gradient(45deg,#f1f5f9_0_3px,transparent_3px_8px)]"
                                  : c.source === "DEFAULT"
                                    ? "bg-slate-100 text-slate-500 ring-slate-200"
                                    : colorOf.get(s.id),
                                sel && "outline-2 outline-offset-1 outline-brand-600",
                                c.locked ? "cursor-not-allowed opacity-70" : "hover:brightness-95 active:scale-[.97]",
                              )}
                              aria-label={`${e.name} ${fmtDay(d)}: ${s && !c.isDayOff ? s.name : "Nghỉ"}`}
                            >
                              {c.isDayOff || !s ? (
                                <span className="font-semibold">Nghỉ</span>
                              ) : (
                                <>
                                  <span className="max-w-full truncate font-semibold">{s.name}</span>
                                  <span className="tabular-nums opacity-80">
                                    {s.startTime}–{s.endTime}
                                  </span>
                                </>
                              )}
                              {c.locked && <span className="absolute top-0.5 right-1 text-[10px]">🔒</span>}
                              {sel && (
                                <span className="absolute -top-1.5 -right-1.5 rounded-full bg-brand-700 p-0.5 text-white">
                                  <Icon name="check" className="size-3" strokeWidth={3} />
                                </span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {multi && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:pl-64">
          <div className="flex w-full max-w-md animate-slide-up items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-[var(--shadow-pop)]">
            <span className="text-sm font-semibold">Đã chọn {selected.size} ô</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-slate-200 hover:bg-white/10" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </Button>
              <Button size="sm" onClick={() => setEditing({ keys: [...selected], title: `Gán ca cho ${selected.size} ô` })}>
                Gán ca
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.title ?? ""}>
        <div className="grid gap-2 pb-2">
          {data?.shifts.map((s) => (
            <button
              key={s.id}
              disabled={saving}
              onClick={() => apply({ kind: "shift", shiftId: s.id })}
              className={cx("flex items-center justify-between rounded-xl px-4 py-3 text-left ring-1 transition hover:brightness-95", colorOf.get(s.id))}
            >
              <span className="font-semibold">{s.name}</span>
              <span className="text-sm tabular-nums">
                {s.startTime}–{s.endTime}
              </span>
            </button>
          ))}
          <button disabled={saving} onClick={() => apply({ kind: "off" })} className="rounded-xl bg-white px-4 py-3 text-left font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Nghỉ
          </button>
          <button disabled={saving} onClick={() => apply({ kind: "default" })} className="rounded-xl px-4 py-2.5 text-left text-sm font-medium text-slate-500 hover:bg-slate-100">
            ↺ Về ca mặc định (xóa lịch riêng)
          </button>
        </div>
      </Modal>
    </>
  );
}
