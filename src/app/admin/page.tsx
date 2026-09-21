"use client";
import Link from "next/link";
import { useState } from "react";
import { qs, useApi } from "@/lib/client/api";
import { fmtDay, fmtTime, weekdayOf, WEEKDAY_LONG } from "@/lib/client/format";
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorBox, IconButton, PageHeader, Segmented, Skeleton, StatCard } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { DayStatusBadge } from "@/components/status";
import { Icon } from "@/components/icons";
import { useAdminUser, useCan } from "./admin-nav";

type Person = { id: number; code: string; name: string; department: string; shift: string | null };
type Dashboard = {
  date: string;
  updatedAt: string;
  totalEmployees: number;
  scheduled: number;
  counts: { ON_TIME: number; LATE: number; ABSENT: number; ON_LEAVE: number; NOT_YET: number };
  late: (Person & { inTime: string | null; lateMinutes: number })[];
  absent: (Person & { pendingLeave: boolean; enrolled: boolean })[];
  manual: (Person & { status: string })[];
  unscheduled: Person[];
  rosterWarnings: { week: string; departments: string[] }[];
  pendingRequests: number;
  overdueRequests: number;
  suspicious24h: number;
  l2Error: { at: string; detail: string | null } | null;
  zalo: { simulated: boolean; refreshError: { at: string; msg: string } | null } | null;
};

export default function DashboardPage() {
  const can = useCan();
  if (!can("dashboard.view")) {
    return (
      <Card>
        <EmptyState icon="dashboard" title="Chọn chức năng ở menu">
          Tài khoản của bạn không có quyền xem dashboard tổng quan.
        </EmptyState>
      </Card>
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  const [dept, setDept] = useState("");
  const [tab, setTab] = useState<"late" | "absent" | "manual" | "unscheduled">("late");
  const { data, error, loading, reload } = useApi<Dashboard>(`/api/dashboard${qs({ departmentId: dept })}`, { refreshMs: 60_000 });

  return (
    <>
      <PageHeader
        title="Tổng quan hôm nay"
        subtitle={data ? `${WEEKDAY_LONG[weekdayOf(data.date)]}, ${fmtDay(data.date)} · cập nhật ${fmtTime(data.updatedAt)} · tự làm mới mỗi 60 giây` : "Đang tải…"}
        actions={
          <>
            <DeptSelect value={dept} onChange={setDept} className="w-full sm:w-56" />
            <IconButton icon="refresh" label="Làm mới" onClick={reload} className="border border-slate-200 bg-white" />
          </>
        }
      />

      {data?.zalo?.refreshError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Refresh token Zalo OA thất bại lúc {fmtTime(data.zalo.refreshError.at)} {fmtDay(data.zalo.refreshError.at.slice(0, 10))}</p>
            <p className="mt-0.5 text-rose-700">{data.zalo.refreshError.msg}. Tin nhắn Zalo có thể không gửi được — kiểm tra cấu hình OA.</p>
          </div>
        </div>
      )}

      {data?.l2Error && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          <Icon name="shield" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Lớp chống giả mạo L2 trên máy chủ đang lỗi (lúc {fmtTime(data.l2Error.at)})</p>
            <p className="mt-0.5 text-rose-700">Kiosk tạm chỉ dùng lớp L1. Kiểm tra mô hình MiniFASNetV2 (npm run models:liveness) rồi khởi động lại server.</p>
          </div>
        </div>
      )}

      {data?.rosterWarnings.map((w) => (
        <Link
          key={w.week}
          href={`/admin/roster?week=${w.week}`}
          className="mb-3 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 hover:bg-amber-100"
        >
          <Icon name="calendar" className="mt-0.5 size-5 shrink-0" />
          <span>
            <b>
              {w.week <= data.date ? "Tuần này" : "Tuần sau"} ({fmtDay(w.week)}) còn {w.departments.length} phòng chưa đăng ký ca:
            </b>{" "}
            {w.departments.join(", ")}. {w.week <= data.date ? "Nhân viên xoay ca đang ở trạng thái “Chưa có lịch”." : "Hạn chót trước 00:00 thứ Hai."}
          </span>
        </Link>
      ))}

      <CredentialAlerts />

      {error && <ErrorBox message={error} onRetry={reload} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading && !data
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)
          : data && (
              <>
                <StatCard label="Đúng giờ" value={data.counts.ON_TIME} tone="ontime" />
                <StatCard label="Đi trễ" value={data.counts.LATE} tone="late" active={tab === "late"} onClick={() => setTab("late")} />
                <StatCard label="Vắng mặt" value={data.counts.ABSENT} tone="absent" active={tab === "absent"} onClick={() => setTab("absent")} />
                <StatCard label="Nghỉ có phép" value={data.counts.ON_LEAVE} tone="leave" />
                <StatCard label="Chưa đến ca" value={data.counts.NOT_YET} tone="neutral" hint={`${data.scheduled}/${data.totalEmployees} có ca hôm nay`} />
              </>
            )}
      </div>

      {data && (data.pendingRequests > 0 || data.overdueRequests > 0 || data.suspicious24h > 0 || data.zalo?.simulated) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.overdueRequests > 0 && (
            <Link href="/admin/requests" className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-800 hover:bg-rose-200">
              <Icon name="clock" className="size-4" /> {data.overdueRequests} đơn quá hạn (&gt; 24 giờ)
            </Link>
          )}
          {data.pendingRequests > 0 && (
            <Link href="/admin/requests?status=PENDING" className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-200">
              <Icon name="inbox" className="size-4" /> {data.pendingRequests} đơn chờ duyệt
            </Link>
          )}
          {data.suspicious24h > 0 && (
            <Link href="/admin/attendance?tab=suspicious" className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-800 hover:bg-rose-200">
              <Icon name="shield" className="size-4" /> {data.suspicious24h} lần quét nghi giả mạo (24h)
            </Link>
          )}
          {data.zalo?.simulated && (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700">
              <Icon name="zalo" className="size-4" /> Zalo OA đang ở chế độ mô phỏng
            </span>
          )}
        </div>
      )}

      <Card className="mt-5">
        <CardHeader
          title="Cần chú ý"
          actions={
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "late", label: `Trễ${data ? ` (${data.late.length})` : ""}` },
                { value: "absent", label: `Vắng${data ? ` (${data.absent.length})` : ""}` },
                { value: "manual", label: `Chấm tay${data ? ` (${data.manual.length})` : ""}` },
                ...(data?.unscheduled.length ? [{ value: "unscheduled" as const, label: `Chưa có lịch (${data.unscheduled.length})` }] : []),
              ]}
            />
          }
        />
        {!data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (
          <PeopleList data={data} tab={tab} />
        )}
      </Card>
    </>
  );
}

function PeopleList({ data, tab }: { data: Dashboard; tab: "late" | "absent" | "manual" | "unscheduled" }) {
  const rows =
    tab === "late" ? data.late : tab === "absent" ? data.absent : tab === "unscheduled" ? data.unscheduled.map((p) => ({ ...p, status: "NO_SCHEDULE" })) : data.manual;
  if (!rows.length) {
    return (
      <EmptyState icon="check" title={tab === "late" ? "Không ai đi trễ" : tab === "absent" ? "Không ai vắng mặt" : "Mọi người đều đã enroll khuôn mặt"}>
        {tab === "manual" ? "Danh sách nhân viên có ca hôm nay nhưng chưa có khuôn mặt, cần quản lý xác nhận chấm công thủ công." : null}
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <Avatar name={p.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-800">
              {p.name} <span className="font-normal text-slate-400">· {p.code}</span>
            </p>
            <p className="truncate text-sm text-slate-500">
              {p.department}
              {p.shift ? ` · ${p.shift}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {"lateMinutes" in p && (
              <>
                <Badge tone="late">Trễ {p.lateMinutes} phút</Badge>
                <span className="text-xs text-slate-500 tabular-nums">vào {p.inTime}</span>
              </>
            )}
            {"pendingLeave" in p && (
              <>
                <Badge tone="absent">Vắng</Badge>
                {p.pendingLeave && <span className="text-xs text-amber-700">Có đơn chờ duyệt</span>}
                {!p.enrolled && <span className="text-xs text-slate-500">Chưa enroll</span>}
              </>
            )}
            {(tab === "manual" || tab === "unscheduled") && "status" in p && <DayStatusBadge status={p.status} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Cảnh báo hồ sơ hành nghề (GPHN, CME, chứng chỉ hết hạn) — chỉ Nhân sự / Quản trị. */
function CredentialAlerts() {
  const me = useAdminUser();
  const hr = me.role === "ADMIN" || me.role === "HR";
  const { data } = useApi<{ items: { id: number; code: string; name: string; department: string; issues: { kind: string; severity: string; text: string }[] }[] }>(hr ? "/api/credentials/alerts" : null);
  const [open, setOpen] = useState(false);
  if (!data?.items.length) return null;
  const danger = data.items.filter((a) => a.issues.some((i) => i.severity === "danger")).length;
  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen((o) => !o)}>
        <Icon name="briefcase" className="mt-0.5 size-5 shrink-0" />
        <span className="flex-1">
          <b>Cảnh báo hành nghề: {data.items.length} người</b>
          {danger > 0 && <span className="text-rose-700"> ({danger} nghiêm trọng)</span>} — thiếu / hết hạn GPHN, thiếu tiết CME, chứng chỉ sắp hết hạn.
        </span>
        <Icon name={open ? "chevronLeft" : "chevronRight"} className={open ? "size-4 -rotate-90" : "size-4 rotate-90"} />
      </button>
      {open && (
        <ul className="mt-3 space-y-2 border-t border-amber-200 pt-3">
          {data.items.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/employees/${a.id}/credentials`} className="font-semibold hover:underline">
                {a.code} — {a.name}
              </Link>{" "}
              <span className="text-amber-800">· {a.department}</span>
              <ul className="ml-4 text-amber-800">
                {a.issues.map((i) => (
                  <li key={i.kind} className={i.severity === "danger" ? "text-rose-700" : ""}>
                    • {i.text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
