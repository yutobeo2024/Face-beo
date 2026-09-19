"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, qs, useApi } from "@/lib/client/api";
import { addDaysStr, fmtDateTime, fmtDay, fmtDayShort, mondayOf, todayStr, weekdayOf, WEEKDAY_SHORT } from "@/lib/client/format";
import { Badge, Button, Card, CardHeader, cx, EmptyState, ErrorBox, Field, IconButton, Loading, Modal, PageHeader, Segmented } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";

type Shift = { id: number; name: string; startTime: string; endTime: string };
type Cell = { shiftId: number | null; isDayOff: boolean; source: "SCHEDULE" | "PATTERN" | "DEFAULT" | "NONE"; draft: boolean };
type Row = {
  id: number;
  code: string;
  name: string;
  departmentId: number;
  department: { name: string };
  defaultShiftId: number;
  scheduleType: "FIXED" | "ROTATING";
  patternName: string | null;
  cells: Record<string, Cell>;
};
type DeptWeek = { name: string; status: "DRAFT" | "REGISTERED"; registeredAt: string | null; canEdit: boolean; needReason: boolean; lockReason: string | null; canRegister: boolean };
type Roster = {
  week: string;
  dates: string[];
  today: string;
  shifts: Shift[];
  canEditRegistered: boolean;
  departments: Record<string, DeptWeek>;
  holidays: Record<string, string>;
  employees: Row[];
};
type History = {
  items: { id: number; action: string; at: string; department: string; actor: { name: string; code: string } | null; detail: { reason?: string; late?: boolean; changes?: { code: string; name: string; date: string; before: string; after: string }[] } | null }[];
};

const PALETTE = [
  "bg-emerald-100 text-emerald-900 ring-emerald-300",
  "bg-sky-100 text-sky-900 ring-sky-300",
  "bg-indigo-100 text-indigo-900 ring-indigo-300",
  "bg-amber-100 text-amber-900 ring-amber-300",
  "bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300",
  "bg-teal-100 text-teal-900 ring-teal-300",
];

type Choice = { kind: "shift"; shiftId: number } | { kind: "off" } | { kind: "default" };
type Pending = { keys: string[]; title: string; needReason: boolean };

function RosterInner() {
  const toast = useToast();
  const sp = useSearchParams();
  const [week, setWeek] = useState(mondayOf(sp.get("week") ?? todayStr()));
  const [dept, setDept] = useState("");
  const [group, setGroup] = useState<"rotating" | "all">("rotating");
  const [tab, setTab] = useState<"grid" | "history">("grid");
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Pending | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const url = `/api/roster${qs({ week, departmentId: dept, group })}`;
  const { data, error, loading, reload } = useApi<Roster>(url);
  const history = useApi<History>(tab === "history" ? `/api/roster/history?week=${week}` : null);

  const colorOf = useMemo(() => {
    const m = new Map<number, string>();
    data?.shifts.forEach((s, i) => m.set(s.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [data?.shifts]);
  const shiftById = useMemo(() => new Map(data?.shifts.map((s) => [s.id, s])), [data?.shifts]);
  const deptOf = (id: number) => data?.departments[String(id)];

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function onCell(row: Row, date: string) {
    const dw = deptOf(row.departmentId);
    if (!dw?.canEdit) return toast.info(dw?.lockReason ?? "Không sửa được tuần này");
    const key = `${row.id}|${date}`;
    if (multi) return toggle(key);
    setEditing({ keys: [key], title: `${row.name} · ${WEEKDAY_SHORT[weekdayOf(date)]} ${fmtDay(date)}`, needReason: dw.needReason });
  }

  async function apply(c: Choice) {
    if (!editing) return;
    if (editing.needReason && reason.trim().length < 5) {
      setChoice(c);
      return;
    }
    setSaving(true);
    const cells = editing.keys.map((k) => {
      const [employeeId, date] = k.split("|");
      return { employeeId: Number(employeeId), date, shiftId: c.kind === "shift" ? c.shiftId : null, isDayOff: c.kind === "off", clear: c.kind === "default" ? true : undefined };
    });
    try {
      const r = await api<{ saved: number; changed: number }>("/api/roster", { method: "PUT", body: { cells, reason: reason.trim() || undefined } });
      toast.success(editing.needReason ? `Đã sửa ${r.changed} ô — đã ghi nhật ký và báo nhóm Zalo` : `Đã lưu ${r.saved} ô (nháp)`);
      setEditing(null);
      setChoice(null);
      setReason("");
      setSelected(new Set());
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function register(deptIds: number[]) {
    setSaving(true);
    try {
      const r = await api<{ registered: number }>("/api/roster/register", { body: { week, departmentIds: deptIds } });
      toast.success(`Đã đăng ký ca tuần cho ${r.registered} phòng — lịch có hiệu lực tính công`);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function copyLastWeek() {
    setSaving(true);
    try {
      const r = await api<{ saved: number; message?: string }>("/api/roster/copy-week", { body: { fromWeek: addDaysStr(week, -7), toWeek: week, departmentId: dept || undefined } });
      toast.success(r.message ?? `Đã sao chép ${r.saved} ô từ tuần trước (nháp — nhớ bấm Đăng ký)`);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const depts = data ? Object.entries(data.departments) : [];
  const registerable = depts.filter(([, d]) => d.canRegister).map(([id]) => Number(id));

  return (
    <>
      <PageHeader
        title="Bảng xếp ca tuần"
        subtitle="Lịch chỉ có hiệu lực tính công sau khi ĐĂNG KÝ. Quản lý đăng ký trước 00:00 thứ Hai; sau đó chỉ Nhân sự sửa được (kèm lý do)."
        actions={
          <>
            <Button variant="secondary" icon="copy" size="sm" onClick={copyLastWeek} loading={saving && !editing}>
              Sao chép tuần trước
            </Button>
            {registerable.length > 0 && (
              <Button icon="check" size="sm" onClick={() => register(registerable)} loading={saving && !editing}>
                Đăng ký ca tuần ({registerable.length} phòng)
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-3 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronLeft" label="Tuần trước" onClick={() => setWeek(addDaysStr(week, -7))} />
          <button className="min-w-0 rounded-lg px-2 py-1 text-[15px] font-semibold text-slate-800 hover:bg-slate-100" onClick={() => setWeek(mondayOf(todayStr()))} title="Về tuần này">
            {fmtDayShort(week)} – {fmtDay(addDaysStr(week, 6))}
          </button>
          <IconButton icon="chevronRight" label="Tuần sau" onClick={() => setWeek(addDaysStr(week, 7))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={group}
            onChange={setGroup}
            options={[
              { value: "rotating", label: "Nhóm xoay ca" },
              { value: "all", label: "Tất cả" },
            ]}
          />
          <DeptSelect value={dept} onChange={setDept} className="w-full sm:w-52" />
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "grid", label: "Lịch" },
              { value: "history", label: "Lịch sử" },
            ]}
          />
        </div>
      </Card>

      {data && depts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {depts.map(([id, d]) => (
            <span
              key={id}
              className={cx(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1",
                d.status === "REGISTERED" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-amber-200",
              )}
              title={d.lockReason ?? undefined}
            >
              {d.status === "REGISTERED" ? "🔒" : "✏️"} {d.name}: {d.status === "REGISTERED" ? `Đã đăng ký${d.registeredAt ? ` ${fmtDateTime(d.registeredAt)}` : ""}` : "Nháp — chưa tính công"}
              {d.canRegister && (
                <button className="rounded-full bg-brand-700 px-2 py-0.5 text-white hover:bg-brand-800" onClick={() => register([Number(id)])} disabled={saving}>
                  Đăng ký
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {tab === "history" ? (
        <HistoryList data={history.data} loading={history.loading} error={history.error} />
      ) : (
        <>
          {data && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
              {data.shifts.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5">
                  <span className={cx("size-3 rounded ring-1", colorOf.get(s.id))} /> {s.name} {s.startTime}–{s.endTime}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded bg-slate-100 ring-1 ring-slate-300" /> Theo mẫu tuần / mặc định
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded border border-dashed border-amber-500" /> Nháp
              </span>
              <Button size="sm" variant={multi ? "primary" : "secondary"} icon="check" onClick={() => (setMulti((m) => !m), setSelected(new Set()))}>
                {multi ? "Đang chọn nhiều" : "Chọn nhiều"}
              </Button>
            </div>
          )}

          {error && <ErrorBox message={error} onRetry={reload} />}
          {loading && !data ? (
            <Loading />
          ) : data && data.employees.length === 0 ? (
            <Card>
              <EmptyState icon="users" title="Không có nhân viên">
                {group === "rotating" ? "Không có nhân viên xoay ca trong phạm vi. Chọn “Tất cả” để xem nhóm ca cố định." : "Không có nhân viên trong phạm vi bạn quản lý."}
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
                      {data.employees.map((e) => {
                        const dw = deptOf(e.departmentId);
                        return (
                          <tr key={e.id}>
                            <td className="sticky left-0 z-10 border-r border-b border-slate-100 bg-white px-3 py-1.5">
                              <p className="truncate font-semibold text-slate-800">{e.name}</p>
                              <p className="truncate text-xs text-slate-500">
                                {e.code} · {e.department.name}
                                <span className={e.scheduleType === "ROTATING" ? "ml-1 text-brand-700" : "ml-1"}>
                                  · {e.scheduleType === "ROTATING" ? "xoay ca" : (e.patternName ?? "cố định")}
                                </span>
                              </p>
                            </td>
                            {data.dates.map((d) => {
                              const c = e.cells[d];
                              const key = `${e.id}|${d}`;
                              const s = c.shiftId ? shiftById.get(c.shiftId) : null;
                              const sel = selected.has(key);
                              const locked = !dw?.canEdit;
                              return (
                                <td key={d} className={cx("border-b border-slate-100 p-1", d === data.today && "bg-brand-50/40")}>
                                  <button
                                    onClick={() => onCell(e, d)}
                                    className={cx(
                                      "relative flex h-12 w-full min-w-[84px] flex-col items-center justify-center rounded-lg px-1 text-xs leading-tight ring-1 transition",
                                      c.source === "NONE"
                                        ? "bg-white text-amber-700 ring-amber-200"
                                        : c.isDayOff || !s
                                          ? "bg-white text-slate-400 ring-slate-200 [background-image:repeating-linear-gradient(45deg,#f1f5f9_0_3px,transparent_3px_8px)]"
                                          : c.source === "SCHEDULE"
                                            ? colorOf.get(s.id)
                                            : "bg-slate-100 text-slate-500 ring-slate-200",
                                      c.draft && "outline-2 outline-offset-[-3px] outline-amber-500 outline-dashed",
                                      sel && "outline-2 outline-offset-1 outline-brand-600",
                                      locked ? "cursor-not-allowed opacity-80" : "hover:brightness-95 active:scale-[.97]",
                                    )}
                                    aria-label={`${e.name} ${fmtDay(d)}: ${c.source === "NONE" ? "chưa xếp" : s && !c.isDayOff ? s.name : "Nghỉ"}`}
                                  >
                                    {c.source === "NONE" ? (
                                      <span className="font-semibold">Chưa xếp</span>
                                    ) : c.isDayOff || !s ? (
                                      <span className="font-semibold">Nghỉ</span>
                                    ) : (
                                      <>
                                        <span className="max-w-full truncate font-semibold">{s.name}</span>
                                        <span className="tabular-nums opacity-80">
                                          {s.startTime}–{s.endTime}
                                        </span>
                                      </>
                                    )}
                                    {locked && <span className="absolute top-0.5 right-1 text-[10px]">🔒</span>}
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}
        </>
      )}

      {multi && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:pl-64">
          <div className="flex w-full max-w-md animate-slide-up items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-[var(--shadow-pop)]">
            <span className="text-sm font-semibold">Đã chọn {selected.size} ô</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-slate-200 hover:bg-white/10" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const needReason = [...selected].some((k) => {
                    const emp = data?.employees.find((x) => x.id === Number(k.split("|")[0]));
                    return emp ? !!deptOf(emp.departmentId)?.needReason : false;
                  });
                  setEditing({ keys: [...selected], title: `Gán ca cho ${selected.size} ô`, needReason });
                }}
              >
                Gán ca
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!editing} onClose={() => (setEditing(null), setChoice(null), setReason(""))} title={editing?.title ?? ""}>
        {editing?.needReason && (
          <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Tuần này đã đăng ký — thay đổi có hiệu lực ngay, được ghi nhật ký và gửi vào nhóm Zalo.</p>
            <Field label="Lý do sửa (bắt buộc)" className="mt-2">
              {(id) => <textarea id={id} className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đổi ca theo đề nghị của trưởng kho" />}
            </Field>
            {choice && reason.trim().length >= 5 && (
              <Button className="mt-2 w-full" loading={saving} onClick={() => apply(choice)}>
                Xác nhận sửa
              </Button>
            )}
          </div>
        )}
        <div className="grid gap-2 pb-2">
          {data?.shifts.map((s) => (
            <button
              key={s.id}
              disabled={saving}
              onClick={() => apply({ kind: "shift", shiftId: s.id })}
              className={cx("flex items-center justify-between rounded-xl px-4 py-3 text-left ring-1 transition hover:brightness-95", colorOf.get(s.id), choice?.kind === "shift" && choice.shiftId === s.id && "outline-2 outline-brand-600")}
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
            ↺ Xóa lịch riêng (về mẫu tuần / ca mặc định)
          </button>
        </div>
      </Modal>
    </>
  );
}

function HistoryList({ data, loading, error }: { data: History | null; loading: boolean; error: string | null }) {
  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Loading />;
  if (!data.items.length)
    return (
      <Card>
        <EmptyState icon="calendar" title="Chưa có thay đổi nào trong tuần này" />
      </Card>
    );
  return (
    <Card>
      <CardHeader title="Lịch sử đăng ký & sửa ca" />
      <ul className="divide-y divide-slate-100">
        {data.items.map((it) => (
          <li key={it.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {it.action === "ROSTER_REGISTER" ? <Badge tone="ontime">Đăng ký</Badge> : <Badge tone="late">Sửa sau đăng ký</Badge>}
              <span className="font-semibold text-slate-800">{it.department}</span>
              <span className="text-slate-500">
                {it.actor ? `${it.actor.name} (${it.actor.code})` : "Hệ thống"} · {fmtDateTime(it.at)}
              </span>
              {it.detail?.late && <Badge tone="absent">Đăng ký muộn</Badge>}
            </div>
            {it.detail?.reason && <p className="mt-1 text-slate-600">Lý do: “{it.detail.reason}”</p>}
            {it.detail?.changes && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {it.detail.changes.map((c, i) => (
                  <li key={i}>
                    {c.code} {c.name} — {fmtDay(c.date)}: {c.before} → <b>{c.after}</b>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function RosterPage() {
  return (
    <Suspense>
      <RosterInner />
    </Suspense>
  );
}
