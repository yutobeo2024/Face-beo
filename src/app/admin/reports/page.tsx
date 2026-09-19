"use client";
import { useState } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { addDaysStr, fmtDateTime, fmtDay, fmtMinutes, todayStr } from "@/lib/client/format";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, StatCard } from "@/components/ui";
import { useToast } from "@/components/toast";
import { DeptSelect } from "@/components/dept-select";
import { Icon } from "@/components/icons";

type Summary = {
  employeeId: number;
  code: string;
  name: string;
  department: string;
  workDays: number;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  otMinutes: number;
  leaveDays: number;
  absentDays: number;
  missingOutDays: number;
};

const monthStart = () => todayStr().slice(0, 8) + "01";

export default function ReportsPage() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const [dept, setDept] = useState("");
  const valid = from <= to;
  const params = qs({ from, to, departmentId: dept });
  const { data, error, loading, reload } = useApi<{ summary: Summary[] }>(valid ? `/api/reports/summary${params}` : null);
  const rows = data?.summary ?? [];
  const sum = (k: keyof Summary) => Math.round(rows.reduce((s, r) => s + (r[k] as number), 0) * 100) / 100;

  const presets = [
    { label: "Tháng này", from: monthStart(), to: todayStr() },
    { label: "7 ngày", from: addDaysStr(todayStr(), -6), to: todayStr() },
    {
      label: "Tháng trước",
      from: (() => {
        const d = new Date(`${monthStart()}T00:00:00`);
        d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      })(),
      to: addDaysStr(monthStart(), -1),
    },
  ];

  return (
    <>
      <PageHeader
        title="Bảng công tổng hợp"
        subtitle={`Từ ${fmtDay(from)} đến ${fmtDay(to)}`}
        actions={
          <a
            href={valid ? `/api/reports/attendance.xlsx${params}` : undefined}
            aria-disabled={!valid}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-[15px] font-semibold text-white shadow-sm hover:bg-brand-800 aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <Icon name="download" /> Xuất Excel
          </a>
        }
      />
      <Card className="mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_auto] lg:items-center">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="w-8 shrink-0">Từ</span>
          <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="w-8 shrink-0">Đến</span>
          <input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto sm:col-span-2 lg:col-span-1">
          {presets.map((p) => (
            <button key={p.label} onClick={() => (setFrom(p.from), setTo(p.to))} className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">
              {p.label}
            </button>
          ))}
        </div>
        <DeptSelect value={dept} onChange={setDept} className="sm:col-span-2 lg:col-span-1 lg:w-56" />
      </Card>

      <PayrollLockCard onChanged={reload} />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon="chart" title="Không có dữ liệu" />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Lần đi trễ" value={sum("lateCount")} tone="late" hint={`${fmtMinutes(sum("lateMinutes"))} tổng`} />
            <StatCard label="Lần về sớm" value={sum("earlyCount")} tone="late" hint={`${fmtMinutes(sum("earlyMinutes"))} tổng`} />
            <StatCard label="Ngày vắng không phép" value={sum("absentDays")} tone="absent" />
            <StatCard label="Giờ OT" value={(sum("otMinutes") / 60).toFixed(1)} tone="brand" hint={`${sum("leaveDays")} ngày nghỉ phép`} />
          </div>
          <Card className="overflow-hidden">
            <div className="scroll-x hidden md:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nhân viên</th>
                    <th className="text-right">Ngày công</th>
                    <th className="text-right">Trễ</th>
                    <th className="text-right">Phút trễ</th>
                    <th className="text-right">Về sớm</th>
                    <th className="text-right">Phút sớm</th>
                    <th className="text-right">OT (giờ)</th>
                    <th className="text-right">Nghỉ phép</th>
                    <th className="text-right">Vắng</th>
                    <th className="text-right">Thiếu giờ ra</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employeeId}>
                      <td>
                        <p className="font-semibold text-slate-800">{r.name}</p>
                        <p className="text-xs text-slate-500">
                          {r.code} · {r.department}
                        </p>
                      </td>
                      <td className="text-right font-semibold tabular-nums">{r.workDays}</td>
                      <td className="text-right tabular-nums">{r.lateCount || "–"}</td>
                      <td className="text-right tabular-nums">{r.lateMinutes || "–"}</td>
                      <td className="text-right tabular-nums">{r.earlyCount || "–"}</td>
                      <td className="text-right tabular-nums">{r.earlyMinutes || "–"}</td>
                      <td className="text-right tabular-nums">{r.otMinutes ? (r.otMinutes / 60).toFixed(2) : "–"}</td>
                      <td className="text-right tabular-nums">{r.leaveDays || "–"}</td>
                      <td className={`text-right tabular-nums ${r.absentDays ? "font-semibold text-rose-600" : ""}`}>{r.absentDays || "–"}</td>
                      <td className="text-right tabular-nums">{r.missingOutDays || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <li key={r.employeeId} className="p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-800">{r.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.code} · {r.department}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-slate-800 tabular-nums">{r.workDays}</p>
                      <p className="text-[11px] text-slate-500">ngày công</p>
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                    {[
                      ["Trễ", `${r.lateCount}/${r.lateMinutes}p`],
                      ["Sớm", `${r.earlyCount}/${r.earlyMinutes}p`],
                      ["OT", `${(r.otMinutes / 60).toFixed(1)}g`],
                      ["Vắng", String(r.absentDays)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-slate-50 py-1.5">
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="font-semibold text-slate-800 tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

type LockMonth = {
  month: string;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  totals: { employees: number; workDays: number; leaveDays: number; otMinutes: number; absentDays: number } | null;
  canLockFrom: string;
  lockable: boolean;
  pendingRequests: number;
};
const fmtMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Chốt công tháng: HR/Quản trị chốt tháng đã kết thúc; chỉ Quản trị mở khóa (kèm lý do). */
function PayrollLockCard({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ months: LockMonth[]; canLock: boolean; canUnlock: boolean }>("/api/payroll-locks");
  const [confirm, setConfirm] = useState<LockMonth | null>(null);
  const [unlock, setUnlock] = useState<LockMonth | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setConfirm(null);
      setUnlock(null);
      setReason("");
      void reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader title="Chốt công tháng" />
      <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">
        Tháng đã chốt: bảng công được giữ nguyên (không đổi khi sửa ca, ngày lễ, hệ số), không sửa được ca, chấm tay, đơn từ trong tháng đó. Chỉ Quản trị mở khóa.
      </p>
      <ul className="divide-y divide-slate-100">
        {data.months.map((m) => (
          <li key={m.month} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800">
                Tháng {fmtMonth(m.month)}{" "}
                {m.locked ? (
                  <Badge tone="ontime" className="ml-1">
                    <Icon name="lock" className="h-3.5 w-3.5" /> Đã chốt
                  </Badge>
                ) : (
                  <Badge tone="neutral" className="ml-1">
                    Chưa chốt
                  </Badge>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {m.locked
                  ? `${m.lockedBy ?? "—"} chốt lúc ${m.lockedAt ? fmtDateTime(m.lockedAt) : ""}${m.totals ? ` · ${m.totals.employees} NV · ${m.totals.workDays} công · ${m.totals.leaveDays} phép · ${(m.totals.otMinutes / 60).toFixed(1)} giờ OT` : ""}`
                  : m.lockable
                    ? "Có thể chốt"
                    : `Chốt được từ ${fmtDay(m.canLockFrom)}`}
              </p>
            </div>
            {!m.locked && data.canLock && (
              <Button size="sm" icon="lock" disabled={!m.lockable} onClick={() => setConfirm(m)}>
                Chốt công
              </Button>
            )}
            {m.locked && data.canUnlock && (
              <Button size="sm" variant="secondary" onClick={() => setUnlock(m)}>
                Mở khóa
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Chốt công tháng ${confirm ? fmtMonth(confirm.month) : ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Hủy
            </Button>
            <Button loading={busy} icon="lock" onClick={() => confirm && run(() => api("/api/payroll-locks", { body: { month: confirm.month } }), `Đã chốt công tháng ${fmtMonth(confirm.month)}`)}>
              Xác nhận chốt
            </Button>
          </>
        }
      >
        {!!confirm?.pendingRequests && (
          <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Tháng này còn <b>{confirm.pendingRequests}</b> đơn chưa xử lý xong (chờ duyệt hoặc chờ chấm tay). Sau khi chốt, các đơn này không thể duyệt / chấm tay nữa (chỉ từ
            chối được) — nên xử lý trước khi chốt.
          </p>
        )}
        <p className="text-sm text-slate-700">
          Sau khi chốt, bảng công tháng này được giữ nguyên để tính lương. Mọi thao tác làm thay đổi công trong tháng (xếp ca, chấm tay, xóa log, tạo/duyệt đơn) sẽ bị chặn. Thao
          tác được gửi vào nhóm Zalo.
        </p>
      </Modal>

      <Modal
        open={!!unlock}
        onClose={() => (setUnlock(null), setReason(""))}
        title={`Mở khóa công tháng ${unlock ? fmtMonth(unlock.month) : ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => (setUnlock(null), setReason(""))}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={reason.trim().length < 5}
              onClick={() =>
                unlock && run(() => api(`/api/payroll-locks/${unlock.month}`, { method: "DELETE", body: { reason: reason.trim() } }), `Đã mở khóa tháng ${fmtMonth(unlock.month)}`)
              }
            >
              Mở khóa
            </Button>
          </>
        }
      >
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Mở khóa sẽ xóa bản chụp; bảng công tháng này được tính lại theo dữ liệu hiện tại. Thao tác được ghi nhật ký và gửi nhóm Zalo.</p>
        <Field label="Lý do (bắt buộc)">
          {(id) => <textarea id={id} className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Bổ sung đơn nghỉ phép bị sót của NV012" />}
        </Field>
      </Modal>
    </Card>
  );
}
