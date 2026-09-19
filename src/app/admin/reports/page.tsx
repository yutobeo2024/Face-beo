"use client";
import { useState } from "react";
import { qs, useApi } from "@/lib/client/api";
import { addDaysStr, fmtDay, fmtMinutes, todayStr } from "@/lib/client/format";
import { Avatar, Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from "@/components/ui";
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
