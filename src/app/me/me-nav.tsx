"use client";
import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { AppShell, type NavItem, type ShellUser } from "@/components/shell";
import { NotificationBell } from "@/components/tasks/notification-bell";

type MeUser = ShellUser & { id: number };
const Ctx = createContext<MeUser | null>(null);
export const useMe = () => useContext(Ctx)!;

/**
 * Thanh dưới điện thoại chỉ hiện 4 mục đầu có `mobile` — Chat bot đặt ở thanh bên / ngăn kéo để không đẩy mục nào ra.
 * v1.23.0: "Công việc" vào thanh dưới, "Zalo" (liên kết một lần) rời xuống ngăn kéo.
 */
const navFor = (chatbot: boolean, tasks: boolean): NavItem[] =>
  [
    { href: "/me", label: "Hôm nay", icon: "home", exact: true, mobile: true },
    { href: "/me/requests", label: "Đơn từ", icon: "file", mobile: true },
    ...(tasks ? [{ href: "/me/tasks", label: "Công việc", icon: "tasks", mobile: true }] : []),
    { href: "/me/attendance", label: "Lịch sử công", icon: "calendar", mobile: true },
    { href: "/me/zalo", label: "Zalo", icon: "zalo", mobile: !tasks },
    ...(chatbot ? [{ href: "/me/chatbot", label: "Chat bot", icon: "chat" as const }] : []),
    { href: "/me/info", label: "Thông tin", icon: "info" },
    { href: "/me/password", label: "Đổi mật khẩu", icon: "lock" },
  ] as NavItem[];

export function MeNav({
  user,
  adminAccess,
  chatbot,
  tasks,
  children,
}: {
  user: MeUser;
  adminAccess: boolean;
  chatbot: boolean;
  tasks: boolean;
  children: React.ReactNode;
}) {
  // Trang chat / bảng công việc cần cả bề ngang, các trang khác đọc dễ hơn khi cột hẹp.
  const path = usePathname();
  const wide = path?.startsWith("/me/chatbot") || path?.startsWith("/me/tasks");
  return (
    <Ctx.Provider value={user}>
      <AppShell
        user={user}
        nav={navFor(chatbot, tasks)}
        brandSub="Nhân viên"
        extraLinks={adminAccess ? [{ href: "/admin", label: "Trang quản trị", icon: "dashboard" }] : undefined}
        headerExtra={tasks ? (onDark) => <NotificationBell onDark={onDark} /> : undefined}
      >
        <div className={wide ? "" : "mx-auto max-w-3xl"}>{children}</div>
      </AppShell>
    </Ctx.Provider>
  );
}
