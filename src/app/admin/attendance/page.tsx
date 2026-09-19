"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, qs, useApi } from "@/lib/client/api";
import { fmtDateTime, fmtDay, fmtMinutes, fromLocalInput, todayStr, toLocalInput } from "@/lib/client/format";
import { Avatar, Badge, Button, Card, CardHeader, cx, EmptyState, ErrorBox, Field, IconButton, Loading, Modal, PageHeader, Segmented, Select } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { DayStatusBadge } from "@/components/status";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useCan } from "../admin-nav";

type Log = {
  id: number;
  type: string;
  time: string;
  checkTime: string;
  source: string;
  isLate: boolean;
  lateMinutes: number;
  isEarly: boolean;
  earlyMinutes: number;
  snapshotUrl: string | null;
  matchScore: number | null;
  livenessScore: number | null;
  verified3D: boolean;
  outOfShift: boolean;
  note: string | null;
  excusedByRequestId: number | null;
};
type Row = {
  employee: { id: number; code: string; name: string; department: string; enrolled: boolean };
  date: string;
  status: string;
  shift: { name: string; startTime: string; endTime: string } | null;
  inTime: string | null;
  outTime: string | null;
  lateMinutes: number;
  earlyMinutes: number;
  isLate: boolean;
  isEarly: boolean;
  otMinutes: number;
  workDayUnits: number;
  leaveDayUnits: number;
  workMinutes: number;
  missingOut: boolean;
  holidayWork: boolean;
  hasManual: boolean;
  pendingLeave: boolean;
  relatedRequestIds: number[];
  logs: Log[];
};

const FLAGS = [
  { value: "all", label: "Tất cả" },
  { value: "late", label: "Đi trễ" },
  { value: "early", label: "Về sớm" },
  { value: "absent", label: "Vắng" },
  { value: "missingOut", label: "Thiếu giờ ra" },
  { value: "outOfShift", label: "Ngoài ca" },
  { value: "manual", label: "Sửa tay" },
  { value: "leave", label: "Nghỉ phép" },
];

function Flags({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.isEarly && <Badge tone="late">Sớm {r.earlyMinutes}p</Badge>}
      {r.missingOut && <Badge tone="absent">Thiếu giờ ra</Badge>}
      {r.logs.some((l) => l.outOfShift) && <Badge tone="violet">Ngoài ca</Badge>}
      {r.hasManual && <Badge tone="neutral">Sửa tay</Badge>}
      {r.holidayWork && <Badge tone="violet">Làm ngày lễ</Badge>}
      {r.otMinutes > 0 && <Badge tone="brand">OT {fmtMinutes(r.otMinutes)}</Badge>}
      {r.workDayUnits > 0 && r.workDayUnits !== 1 && <Badge tone="ontime">{r.workDayUnits} công</Badge>}
      {r.leaveDayUnits > 0 && r.leaveDayUnits !== 1 && <Badge tone="leave">{r.leaveDayUnits} phép</Badge>}
      {r.pendingLeave && <Badge tone="leave">Đơn chờ duyệt</Badge>}
      {r.relatedRequestIds.length > 0 && <Badge tone="leave">Đơn #{r.relatedRequestIds.join(", #")}</Badge>}
      {!r.employee.enrolled && <Badge tone="neutral">Chưa enroll</Badge>}
    </div>
  );
}

function DayTable({ canManual, canDelete }: { canManual: boolean; canDelete: boolean }) {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [dept, setDept] = useState("");
  const [flag, setFlag] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [manual, setManual] = useState<{ employeeId: string; checkTime: string; reason: string } | null>(null);
  const [del, setDel] = useState<{ log: Log; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ rows: Row[] }>(`/api/attendance${qs({ from: date, to: date, departmentId: dept, flag })}`);
  const emps = useApi<{ employees: { id: number; code: string; name: string }[] }>(canManual ? "/api/employees" : null);

  async function saveManual() {
    if (!manual) return;
    setBusy(true);
    try {
      await api("/api/attendance/manual", { body: { employeeId: Number(manual.employeeId), checkTime: fromLocalInput(manual.checkTime), reason: manual.reason } });
      toast.success("Đã thêm log thủ công");
      setManual(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteLog() {
    if (!del) return;
    setBusy(true);
    try {
      await api(`/api/attendance/${del.log.id}`, { method: "DELETE", body: { reason: del.reason } });
      toast.success("Đã xóa log");
      setDel(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="mb-3 grid gap-2 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <input type="date" className="input sm:w-44" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Ngày công" />
        <DeptSelect value={dept} onChange={setDept} className="sm:w-56" />
        {canManual && (
          <Button icon="plus" onClick={() => setManual({ employeeId: "", checkTime: toLocalInput(new Date().toISOString()), reason: "" })}>
            Thêm log thủ công
          </Button>
        )}
      </Card>
      <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {FLAGS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFlag(f.value)}
            className={cx(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition",
              flag === f.value ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.rows.length ? (
        <Card>
          <EmptyState icon="clock" title="Không có dữ liệu">
            Không có nhân viên nào khớp bộ lọc ngày {fmtDay(date)}.
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop: bảng */}
          <div className="scroll-x hidden md:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nhân viên</th>
                  <th>Ca</th>
                  <th>Vào</th>
                  <th>Ra</th>
                  <th>Trạng thái</th>
                  <th>Ghi chú</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const k = `${r.employee.id}|${r.date}`;
                  return (
                    <RowFragment key={k} r={r} open={open === k} onToggle={() => setOpen(open === k ? null : k)} isAdmin={canDelete} onPhoto={setPhoto} onDelete={(log) => setDel({ log, reason: "" })} />
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile: thẻ */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {data.rows.map((r) => {
              const k = `${r.employee.id}|${r.date}`;
              return (
                <li key={k} className="p-3">
                  <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === k ? null : k)}>
                    <Avatar name={r.employee.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-slate-800">{r.employee.name}</p>
                        <DayStatusBadge status={r.status} />
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {r.employee.code} · {r.shift ? `${r.shift.name} ${r.shift.startTime}–${r.shift.endTime}` : "Không có ca"}
                      </p>
                      <p className="mt-1 text-sm text-slate-700 tabular-nums">
                        Vào <b>{r.inTime ?? "—"}</b>
                        {r.isLate && <span className="text-amber-700"> (+{r.lateMinutes}p)</span>} · Ra <b>{r.outTime ?? "—"}</b>
                      </p>
                      <div className="mt-1.5">
                        <Flags r={r} />
                      </div>
                    </div>
                  </button>
                  {open === k && <LogList logs={r.logs} isAdmin={canDelete} onPhoto={setPhoto} onDelete={(log) => setDel({ log, reason: "" })} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal
        open={!!manual}
        onClose={() => setManual(null)}
        title="Thêm log chấm công thủ công"
        footer={
          <>
            <Button variant="secondary" onClick={() => setManual(null)}>
              Hủy
            </Button>
            <Button loading={busy} disabled={!manual?.employeeId || (manual?.reason.trim().length ?? 0) < 5} onClick={saveManual}>
              Lưu log
            </Button>
          </>
        }
      >
        {manual && (
          <div className="space-y-3">
            <Field label="Nhân viên">
              {(id) => (
                <Select id={id} value={manual.employeeId} onChange={(e) => setManual({ ...manual, employeeId: e.target.value })}>
                  <option value="">— Chọn nhân viên —</option>
                  {emps.data?.employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} — {e.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Thời điểm (giờ Việt Nam)" hint="Hệ thống tự xác định IN/OUT và ngày công theo ca.">
              {(id) => <input id={id} type="datetime-local" className="input" value={manual.checkTime} onChange={(e) => setManual({ ...manual, checkTime: e.target.value })} />}
            </Field>
            <Field label="Lý do (bắt buộc, ghi vào nhật ký kiểm toán)">
              {(id) => <textarea id={id} className="input min-h-20" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} placeholder="VD: Quên chấm giờ ra, quản lý xác nhận" />}
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title="Xóa log chấm công"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>
              Hủy
            </Button>
            <Button variant="danger" loading={busy} disabled={(del?.reason.trim().length ?? 0) < 5} onClick={deleteLog}>
              Xóa log
            </Button>
          </>
        }
      >
        {del && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Log {del.log.type} lúc <b>{fmtDateTime(del.log.checkTime)}</b> ({del.log.source}). Ngày công sẽ được tính lại.
            </p>
            <Field label="Lý do xóa">{(id) => <textarea id={id} className="input min-h-20" value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value })} />}</Field>
          </div>
        )}
      </Modal>

      <Modal open={!!photo} onClose={() => setPhoto(null)} title="Ảnh snapshot" wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo && <img src={photo} alt="Snapshot lúc chấm công" className="w-full rounded-xl" />}
      </Modal>
    </>
  );
}

function RowFragment({ r, open, onToggle, isAdmin, onPhoto, onDelete }: { r: Row; open: boolean; onToggle: () => void; isAdmin: boolean; onPhoto: (u: string) => void; onDelete: (l: Log) => void }) {
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle}>
        <td>
          <div className="flex items-center gap-2.5">
            <Avatar name={r.employee.name} className="size-8" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-800">{r.employee.name}</p>
              <p className="truncate text-xs text-slate-500">
                {r.employee.code} · {r.employee.department}
              </p>
            </div>
          </div>
        </td>
        <td className="whitespace-nowrap text-slate-600">{r.shift ? `${r.shift.name} ${r.shift.startTime}–${r.shift.endTime}` : "—"}</td>
        <td className="font-semibold whitespace-nowrap tabular-nums">
          {r.inTime ?? "—"}
          {r.isLate && <span className="ml-1 text-xs font-medium text-amber-700">+{r.lateMinutes}p</span>}
        </td>
        <td className="font-semibold whitespace-nowrap tabular-nums">{r.outTime ?? "—"}</td>
        <td>
          <DayStatusBadge status={r.status} />
        </td>
        <td>
          <Flags r={r} />
        </td>
        <td>
          <Icon name={open ? "chevronLeft" : "chevronRight"} className={cx("size-4 text-slate-400 transition", open && "-rotate-90")} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50/60">
            <LogList logs={r.logs} isAdmin={isAdmin} onPhoto={onPhoto} onDelete={onDelete} />
          </td>
        </tr>
      )}
    </>
  );
}

function LogList({ logs, isAdmin, onPhoto, onDelete }: { logs: Log[]; isAdmin: boolean; onPhoto: (u: string) => void; onDelete: (l: Log) => void }) {
  if (!logs.length) return <p className="py-3 text-sm text-slate-500">Chưa có lần quét nào.</p>;
  return (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {logs.map((l) => (
        <li key={l.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
          {l.snapshotUrl ? (
            <button onClick={() => onPhoto(l.snapshotUrl!)} className="shrink-0" aria-label="Xem ảnh snapshot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.snapshotUrl} alt="" className="h-12 w-16 rounded-lg bg-slate-100 object-cover" loading="lazy" />
            </button>
          ) : (
            <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-400">{l.source === "MANUAL" ? "THỦ CÔNG" : "—"}</span>
          )}
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-slate-800">
              <Badge tone={l.type === "IN" ? "ontime" : "leave"}>{l.type}</Badge> <span className="tabular-nums">{fmtDateTime(l.checkTime)}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {l.matchScore != null && `khớp ${l.matchScore.toFixed(2)} · `}
              {l.livenessScore != null && `liveness ${l.livenessScore.toFixed(2)}${l.verified3D ? " ✓" : ""} · `}
              {l.note ?? l.source}
            </p>
          </div>
          {isAdmin && <IconButton icon="trash" label="Xóa log" className="text-rose-600 hover:bg-rose-50" onClick={() => onDelete(l)} />}
        </li>
      ))}
    </ul>
  );
}

type Suspicious = {
  settings: { matchThreshold: number; livenessThreshold: number };
  events: { id: number; action: string; at: string; device: string; detail: Record<string, unknown> }[];
  histogram: { matched: { from: number; count: number }[]; noMatch: { from: number; count: number }[] };
  totalKioskScans: number;
};

function SuspiciousTab() {
  const [photo, setPhoto] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Suspicious>("/api/attendance/suspicious?days=14");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  const max = Math.max(1, ...data.histogram.matched.map((b) => b.count), ...data.histogram.noMatch.map((b) => b.count));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader title="Phân bố điểm khớp (14 ngày)" />
        <div className="p-4">
          <p className="mb-3 text-xs text-slate-500">
            {data.totalKioskScans} lượt quét kiosk. Ngưỡng hiện tại <b>{data.settings.matchThreshold}</b>. Dùng biểu đồ để hiệu chỉnh trong giai đoạn pilot.
          </p>
          <div className="flex h-40 items-end gap-1" role="img" aria-label="Biểu đồ phân bố điểm khớp">
            {data.histogram.matched.map((b, i) => {
              const nm = data.histogram.noMatch[i];
              return (
                <div key={b.from} className="flex h-full flex-1 flex-col justify-end gap-px" title={`${b.from.toFixed(2)}: ${b.count} khớp, ${nm.count} không khớp`}>
                  <div className="rounded-t bg-rose-300" style={{ height: `${(nm.count / max) * 100}%` }} />
                  <div className={cx("rounded-t", b.from >= data.settings.matchThreshold ? "bg-brand-500" : "bg-slate-300")} style={{ height: `${(b.count / max) * 100}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400 tabular-nums">
            <span>0.30</span>
            <span>0.65</span>
            <span>1.00</span>
          </div>
          <div className="mt-2 flex gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded bg-brand-500" /> Đã nhận
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded bg-rose-300" /> Không nhận ra
            </span>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Lần quét đáng ngờ" />
        {!data.events.length ? (
          <EmptyState icon="shield" title="Không có lần quét đáng ngờ" />
        ) : (
          <ul className="max-h-[60dvh] divide-y divide-slate-100 overflow-y-auto">
            {data.events.map((e) => {
              const url = typeof e.detail.snapshotUrl === "string" ? e.detail.snapshotUrl : null;
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                  {url ? (
                    <button onClick={() => setPhoto(url)} aria-label="Xem ảnh">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-12 w-16 rounded-lg bg-slate-100 object-cover" loading="lazy" />
                    </button>
                  ) : (
                    <span className="flex h-12 w-16 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                      <Icon name="face" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-semibold text-slate-800">
                      {e.action === "SCAN_SPOOF_REJECTED" ? <Badge tone="absent">Nghi giả mạo</Badge> : <Badge tone="neutral">Không nhận ra</Badge>}{" "}
                      <span className="text-slate-500">{fmtDateTime(e.at)}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {e.device} ·{" "}
                      {e.action === "SCAN_SPOOF_REJECTED"
                        ? `liveness ${Number(e.detail.score ?? 0).toFixed(2)} < ${Number(e.detail.threshold ?? 0).toFixed(2)}`
                        : `top1 ${Number(e.detail.top1 ?? 0).toFixed(2)} · top2 ${Number(e.detail.top2 ?? 0).toFixed(2)}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Modal open={!!photo} onClose={() => setPhoto(null)} title="Ảnh snapshot" wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo && <img src={photo} alt="Snapshot" className="w-full rounded-xl" />}
      </Modal>
    </div>
  );
}

function AttendanceInner() {
  const can = useCan();
  const sp = useSearchParams();
  const seeSuspicious = can("suspicious.view");
  const [tab, setTab] = useState<"day" | "suspicious">(sp.get("tab") === "suspicious" && seeSuspicious ? "suspicious" : "day");
  return (
    <>
      <PageHeader
        title="Chấm công"
        subtitle="Log chấm công, ảnh snapshot và các cờ bất thường."
        actions={
          seeSuspicious && (
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "day", label: "Bảng công ngày" },
                { value: "suspicious", label: "Quét đáng ngờ" },
              ]}
            />
          )
        }
      />
      {tab === "day" ? <DayTable canManual={can("attendance.manualDirect")} canDelete={can("attendance.delete")} /> : <SuspiciousTab />}
    </>
  );
}

export default function AttendancePage() {
  return (
    <Suspense>
      <AttendanceInner />
    </Suspense>
  );
}
