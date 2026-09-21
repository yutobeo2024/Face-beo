"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { addDaysStr, fmtDateTime, fmtDay, fmtDayShort, fmtMinutes, mondayOf, todayStr, weekdayOf, WEEKDAY_LONG, WEEKDAY_SHORT } from "@/lib/client/format";
import { Badge, Button, Card, CardHeader, cx, ErrorBox, IconButton, Modal, Skeleton } from "@/components/ui";
import { DayStatusBadge } from "@/components/status";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useMe } from "./me-nav";

type Day = {
  date: string;
  status: string;
  shift: { name: string; startTime: string; endTime: string } | null;
  isHoliday: boolean;
  holidayName?: string | null;
  inTime: string | null;
  outTime: string | null;
  isLate: boolean;
  lateMinutes: number;
  isEarly: boolean;
  earlyMinutes: number;
  workMinutes: number;
  otMinutes: number;
  missingOut: boolean;
  pendingLeave: boolean;
};
type Overview = {
  me: {
    code: string;
    name: string;
    role: string;
    faceEnrolled: boolean;
    zaloLinkedAt: string | null;
    department: { name: string };
    defaultShift: { name: string; startTime: string; endTime: string };
    phone: string | null;
    nationalId: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    address: string | null;
    jobTitle: { name: string } | null;
    specialty: { name: string } | null;
  };
  today: Day;
  week: string;
  days: Day[];
  pendingRequests: number;
};
type Notif = { id: number; messageType: string; status: string; createdAt: string; text: string };

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{now ? now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "--:--"}</span>;
}

export default function MeHome() {
  const me = useMe();
  const toast = useToast();
  const [week, setWeek] = useState(mondayOf(todayStr()));
  const { data, error, reload } = useApi<Overview>(`/api/me/overview${qs({ week })}`, { refreshMs: 60_000 });
  const notifs = useApi<{ notifications: Notif[] }>("/api/me/notifications");
  const [withdraw, setWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = data?.today;

  async function doWithdraw() {
    setBusy(true);
    try {
      await api(`/api/employees/${me.id}/consent`, { method: "DELETE" });
      toast.success("Đã xóa dữ liệu khuôn mặt. Bạn chuyển sang chấm công thủ công.");
      setWithdraw(false);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-4">
        <p className="text-sm text-slate-500">Xin chào,</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{me.name}</h1>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}

      {/* Thẻ hôm nay */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-[var(--shadow-pop)]">
        <div aria-hidden className="absolute -top-10 -right-10 size-40 rounded-full bg-white/10" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-brand-100">{t ? `${WEEKDAY_LONG[weekdayOf(t.date)]}, ${fmtDay(t.date)}` : "Hôm nay"}</p>
            <p className="mt-0.5 text-4xl font-bold">
              <Clock />
            </p>
          </div>
          {t && (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              {t.shift ? `${t.shift.name} ${t.shift.startTime}–${t.shift.endTime}` : t.status === "NO_SCHEDULE" ? "Chưa có lịch" : t.isHoliday ? "Ngày lễ" : "Nghỉ"}
            </span>
          )}
        </div>
        {!t ? (
          <Skeleton className="mt-4 h-16 bg-white/20" />
        ) : (
          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-xs text-brand-100">Giờ vào</p>
              <p className="text-2xl font-bold tabular-nums">{t.inTime ?? "--:--"}</p>
              {t.isLate && <p className="text-xs font-semibold text-amber-300">Trễ {t.lateMinutes} phút</p>}
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-xs text-brand-100">Giờ ra</p>
              <p className="text-2xl font-bold tabular-nums">{t.outTime ?? "--:--"}</p>
              {t.isEarly && <p className="text-xs font-semibold text-amber-300">Sớm {t.earlyMinutes} phút</p>}
              {t.missingOut && <p className="text-xs font-semibold text-rose-300">Thiếu giờ ra</p>}
            </div>
          </div>
        )}
        {t && (
          <div className="relative mt-3 flex flex-wrap items-center gap-2">
            <DayStatusBadge status={t.status} />
            {t.workMinutes > 0 && <span className="text-xs text-brand-100">Giờ công {fmtMinutes(t.workMinutes)}</span>}
            {t.otMinutes > 0 && <span className="text-xs text-brand-100">· OT {fmtMinutes(t.otMinutes)}</span>}
          </div>
        )}
      </div>

      {data && !data.me.faceEnrolled && (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <Icon name="face" className="mt-0.5 size-5 shrink-0" />
          <p>Bạn chưa có dữ liệu khuôn mặt nên chưa chấm công tại kiosk được. Liên hệ quản trị để enroll, hoặc quản lý sẽ xác nhận công thủ công.</p>
        </div>
      )}
      {data && !data.me.zaloLinkedAt && (
        <Link href="/me/zalo" className="mt-3 flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-900 hover:bg-sky-100">
          <Icon name="zalo" className="size-5 shrink-0" />
          <span className="flex-1">Liên kết Zalo để nhận thông báo đi trễ, duyệt đơn…</span>
          <Icon name="chevronRight" className="size-4" />
        </Link>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link href="/me/requests?new=1" className="card flex items-center gap-3 p-4 hover:border-brand-300">
          <span className="rounded-xl bg-brand-50 p-2 text-brand-700">
            <Icon name="plus" />
          </span>
          <span className="text-sm font-semibold text-slate-800">Tạo đơn</span>
        </Link>
        <Link href="/me/requests" className="card flex items-center gap-3 p-4 hover:border-brand-300">
          <span className="rounded-xl bg-amber-50 p-2 text-amber-700">
            <Icon name="inbox" />
          </span>
          <span className="text-sm font-semibold text-slate-800">
            Đơn chờ duyệt
            <span className="block text-lg font-bold">{data?.pendingRequests ?? "–"}</span>
          </span>
        </Link>
      </div>

      {/* Lịch tuần */}
      <Card className="mt-4">
        <CardHeader
          title="Lịch làm việc tuần"
          actions={
            <div className="flex items-center">
              <IconButton icon="chevronLeft" label="Tuần trước" onClick={() => setWeek(addDaysStr(week, -7))} />
              <button className="px-1 text-sm font-semibold text-slate-600" onClick={() => setWeek(mondayOf(todayStr()))}>
                {fmtDayShort(week)}–{fmtDayShort(addDaysStr(week, 6))}
              </button>
              <IconButton icon="chevronRight" label="Tuần sau" onClick={() => setWeek(addDaysStr(week, 7))} />
            </div>
          }
        />
        <ul className="divide-y divide-slate-100">
          {(data?.days ?? []).map((d) => {
            const isToday = d.date === todayStr();
            return (
              <li key={d.date} className={cx("flex items-center gap-3 px-4 py-3", isToday && "bg-brand-50/50")}>
                <div className={cx("flex w-12 shrink-0 flex-col items-center rounded-xl py-1", isToday ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700")}>
                  <span className="text-[11px] font-semibold uppercase">{WEEKDAY_SHORT[weekdayOf(d.date)]}</span>
                  <span className="text-lg leading-none font-bold">{d.date.slice(8)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">
                    {d.shift ? d.shift.name : d.status === "NO_SCHEDULE" ? "Chưa có lịch (chờ quản lý đăng ký ca)" : d.holidayName ? `🎉 ${d.holidayName}` : "Nghỉ"}
                    {d.shift && <span className="ml-1.5 text-sm font-normal whitespace-nowrap text-slate-500 tabular-nums">{d.shift.startTime}–{d.shift.endTime}</span>}
                  </p>
                  {(d.inTime || d.outTime) && (
                    <p className="text-xs text-slate-500 tabular-nums">
                      Vào {d.inTime ?? "—"} · Ra {d.outTime ?? "—"}
                    </p>
                  )}
                </div>
                {d.date <= todayStr() && d.shift ? <DayStatusBadge status={d.status} /> : d.pendingLeave ? <Badge tone="leave">Đơn chờ duyệt</Badge> : null}
              </li>
            );
          })}
          {!data && Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="m-3 h-12" />)}
        </ul>
      </Card>

      {/* Thông báo */}
      <Card className="mt-4">
        <CardHeader title="Thông báo gần đây" />
        {!notifs.data?.notifications.length ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Chưa có thông báo.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifs.data.notifications.slice(0, 8).map((n) => (
              <li key={n.id} className="px-4 py-3">
                <p className="text-xs text-slate-400">
                  {fmtDateTime(n.createdAt)} {n.status === "SKIPPED_NO_ZALO" && "· chưa gửi Zalo (chưa liên kết)"}
                </p>
                <p className="mt-0.5 text-sm whitespace-pre-line text-slate-700">{n.text.replace(/https?:\/\/\S+/g, "").trim()}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && <PersonalInfo me={data.me} />}

      {data?.me.faceEnrolled && (
        <div className="mt-4 text-center">
          <button className="text-xs text-slate-400 underline hover:text-slate-600" onClick={() => setWithdraw(true)}>
            Rút lại đồng ý & xóa dữ liệu khuôn mặt
          </button>
        </div>
      )}
      <Modal
        open={withdraw}
        onClose={() => setWithdraw(false)}
        title="Xóa dữ liệu khuôn mặt?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdraw(false)}>
              Giữ lại
            </Button>
            <Button variant="danger" loading={busy} onClick={doWithdraw}>
              Rút đồng ý và xóa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Toàn bộ mẫu khuôn mặt của bạn sẽ bị xóa ngay. Bạn sẽ không chấm công tại kiosk được nữa và chuyển sang chấm công thủ công do quản lý xác nhận.</p>
      </Modal>
    </>
  );
}

/** Thông tin cá nhân của chính mình (chỉ đọc). Nhân sự cập nhật trong hồ sơ nhân viên. */
function PersonalInfo({ me }: { me: Overview["me"] }) {
  const GENDER: Record<string, string> = { NAM: "Nam", NU: "Nữ", KHAC: "Khác" };
  const rows: [string, string | null | undefined][] = [
    ["Mã nhân viên", me.code],
    ["Phòng ban", me.department.name],
    ["Chức danh", [me.jobTitle?.name, me.specialty?.name].filter(Boolean).join(" · ") || null],
    ["Số điện thoại", me.phone],
    ["CCCD", me.nationalId],
    ["Ngày sinh", me.dateOfBirth ? me.dateOfBirth.split("-").reverse().join("/") : null],
    ["Giới tính", me.gender ? (GENDER[me.gender] ?? me.gender) : null],
    ["Địa chỉ", me.address],
  ];
  return (
    <Card className="mt-4">
      <CardHeader title="Thông tin cá nhân" />
      <dl className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="mb-1 text-slate-800 sm:mb-0">{v || <span className="text-slate-400">—</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="px-4 pb-3 text-xs text-slate-500">Thông tin chưa đúng? Báo Nhân sự để cập nhật. Chỉ bạn, Nhân sự và Quản trị xem được mục này.</p>
    </Card>
  );
}
