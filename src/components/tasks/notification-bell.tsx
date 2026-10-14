"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { relTime } from "@/lib/client/format";
import { taskHref, type InAppNotificationDto } from "@/lib/tasks/types";

type Resp = { notifications: InAppNotificationDto[]; unread: number };

/** Chuông thông báo Công việc (v1.23.0): làm mới mỗi phút khi màn hình đang hiện; bấm một dòng ⇒ mở đúng việc. */
export function NotificationBell({ onDark }: { onDark?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, reload, setData } = useApi<Resp>("/api/tasks/notifications?take=30", { refreshMs: 60_000 });
  const box = useRef<HTMLDivElement>(null);
  const unread = data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const markRead = async (body: { ids?: number[]; all?: boolean }) => {
    const now = new Date().toISOString();
    setData((d) =>
      d ? { unread: body.all ? 0 : Math.max(0, d.unread - (body.ids?.length ?? 0)), notifications: d.notifications.map((n) => (body.all || body.ids?.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)) } : d,
    );
    await api("/api/tasks/notifications/read", { body }).catch(() => void reload());
  };

  const go = (n: InAppNotificationDto) => {
    setOpen(false);
    if (!n.readAt) void markRead({ ids: [n.id] });
    router.push(n.projectId ? taskHref(n.projectId, n.taskId) : "/me/tasks/my");
  };

  return (
    <div className="relative" ref={box}>
      <button
        aria-label={unread ? `Thông báo (${unread} chưa đọc)` : "Thông báo"}
        title="Thông báo công việc"
        onClick={() => setOpen((o) => !o)}
        className={cx("relative inline-flex size-10 items-center justify-center rounded-xl transition", onDark ? "text-brand-100 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100")}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] leading-4 font-bold text-white">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div
          className={cx(
            "fixed inset-x-2 top-14 z-[85] max-h-[70dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:top-11 sm:w-96",
            onDark ? "sm:left-0" : "sm:right-0",
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="font-semibold text-slate-800">Thông báo</p>
            {unread > 0 && (
              <button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => void markRead({ all: true })}>
                Đọc tất cả
              </button>
            )}
          </div>
          <div className="max-h-[calc(70dvh-48px)] overflow-y-auto">
            {!data?.notifications.length ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Chưa có thông báo.</p>
            ) : (
              data.notifications.map((n) => (
                <button key={n.id} onClick={() => go(n)} className={cx("flex w-full gap-3 border-b border-slate-50 px-4 py-2.5 text-left hover:bg-slate-50", !n.readAt && "bg-brand-50/50")}>
                  <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-sm text-slate-800">{n.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {n.body ? `${n.body} · ` : ""}
                      {relTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
