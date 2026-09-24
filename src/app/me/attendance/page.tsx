"use client";
import { useState } from "react";
import { useApi } from "@/lib/client/api";
import { addMonthsStr, fmtMinutes, todayStr, weekdayOf, WEEKDAY_SHORT } from "@/lib/client/format";
import { Badge, Card, cx, ErrorBox, IconButton, Loading, PageHeader, StatCard } from "@/components/ui";
import { DAY_STATUS, DayStatusBadge } from "@/components/status";

type Day = {
  date: string;
  status: string;
  shift: { name: string; startTime: string; endTime: string } | null;
  inTime: string | null;
  outTime: string | null;
  isLate: boolean;
  lateMinutes: number;
  isEarly: boolean;
  earlyMinutes: number;
  workMinutes: number;
  otMinutes: number;
  workDayUnits: number;
  leaveDayUnits: number;
  missingOut: boolean;
  holidayWork: boolean;
};
type Month = {
  month: string;
  days: Day[];
  exempt?: boolean;
  totals: { workDays: number; lateCount: number; lateMinutes: number; earlyCount: number; earlyMinutes: number; otMinutes: number; workMinutes: number; leaveDays: number; absentDays: number; missingOut: number };
};

const DOT: Record<string, string> = {
  ON_TIME: "bg-emerald-500",
  LATE: "bg-amber-500",
  ABSENT: "bg-rose-500",
  ON_LEAVE: "bg-sky-500",
  OUT_OF_SHIFT: "bg-violet-500",
  HOLIDAY: "bg-violet-300",
};

export default function MyAttendancePage() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const { data, error, loading, reload } = useApi<Month>(`/api/me/attendance?month=${month}`);
  const shift = (n: number) => setMonth(addMonthsStr(month, n));
  // Số ô trống trước ngày 1 để tháng bắt đầu đúng cột thứ Hai.
  const lead = weekdayOf(`${month}-01`) - 1;
  const today = todayStr();

  return (
    <>
      <PageHeader title="Lịch sử công" />
      <Card className="mb-4 flex items-center justify-between p-2">
        <IconButton icon="chevronLeft" label="Tháng trước" onClick={() => shift(-1)} />
        <p className="font-bold text-slate-800">Tháng {month.slice(5)}/{month.slice(0, 4)}</p>
        <IconButton icon="chevronRight" label="Tháng sau" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)} />
      </Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.exempt && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <b>Bạn không cần chấm công.</b> Tài khoản thuộc diện không chấm công giờ giấc (vd. Ban Giám đốc) — không có ca, không tính trễ / vắng.
        </div>
      )}
      {loading && !data ? (
        <Loading />
      ) : (
        data && !data.exempt && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Ngày công" value={data.totals.workDays} tone="ontime" hint={`${fmtMinutes(data.totals.workMinutes)} giờ công`} />
              <StatCard label="Đi trễ" value={data.totals.lateCount} tone="late" hint={`${data.totals.lateMinutes} phút`} />
              <StatCard label="Vắng / Nghỉ phép" value={`${data.totals.absentDays}/${data.totals.leaveDays}`} tone="absent" />
              <StatCard label="OT" value={fmtMinutes(data.totals.otMinutes)} tone="brand" hint={data.totals.missingOut ? `${data.totals.missingOut} ngày thiếu giờ ra` : undefined} />
            </div>

            <Card className="mt-4 p-3 sm:p-4">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400 uppercase">
                {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                  <span key={w}>{WEEKDAY_SHORT[w]}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`x${i}`} />
                ))}
                {data.days.map((d) => (
                  <div
                    key={d.date}
                    className={cx(
                      "flex aspect-square flex-col items-center justify-center rounded-xl text-sm",
                      d.date === today ? "ring-2 ring-brand-500" : "",
                      d.shift || d.inTime ? "bg-slate-50" : "text-slate-300",
                    )}
                    title={`${d.date}: ${DAY_STATUS[d.status]?.label ?? d.status}`}
                  >
                    <span className="font-semibold">{Number(d.date.slice(8))}</span>
                    {d.date <= today && DOT[d.status] && <span className={cx("mt-0.5 size-1.5 rounded-full", DOT[d.status])} />}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                {Object.entries(DOT).map(([k, c]) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span className={cx("size-2 rounded-full", c)} /> {DAY_STATUS[k].label}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="mt-4">
              <ul className="divide-y divide-slate-100">
                {data.days
                  .filter((d) => d.date <= today && (d.shift || d.inTime))
                  .reverse()
                  .map((d) => (
                    <li key={d.date} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-14 shrink-0 text-center">
                        <p className="text-[11px] font-semibold text-slate-400 uppercase">{WEEKDAY_SHORT[weekdayOf(d.date)]}</p>
                        <p className="text-lg leading-tight font-bold text-slate-800">{d.date.slice(8)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 tabular-nums">
                          {d.inTime ?? "--:--"} → {d.outTime ?? "--:--"}
                          {d.workMinutes > 0 && <span className="ml-2 font-normal text-slate-500">{fmtMinutes(d.workMinutes)}</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.isLate && <Badge tone="late">Trễ {d.lateMinutes}p</Badge>}
                          {d.isEarly && <Badge tone="late">Sớm {d.earlyMinutes}p</Badge>}
                          {d.otMinutes > 0 && <Badge tone="brand">OT {fmtMinutes(d.otMinutes)}</Badge>}
                          {d.workDayUnits > 0 && d.workDayUnits !== 1 && <Badge tone="ontime">{d.workDayUnits} công</Badge>}
                          {d.leaveDayUnits > 0 && d.leaveDayUnits !== 1 && <Badge tone="leave">{d.leaveDayUnits} phép</Badge>}
                          {d.missingOut && <Badge tone="absent">Thiếu giờ ra</Badge>}
                          {d.holidayWork && <Badge tone="violet">Làm ngày lễ</Badge>}
                        </div>
                      </div>
                      <DayStatusBadge status={d.status} />
                    </li>
                  ))}
              </ul>
            </Card>
          </>
        )
      )}
    </>
  );
}
