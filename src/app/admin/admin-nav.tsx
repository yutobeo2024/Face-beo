"use client";
import { createContext, useContext } from "react";
import { AppShell, type NavItem, type ShellUser } from "@/components/shell";

const UserCtx = createContext<ShellUser | null>(null);
export const useAdminUser = () => useContext(UserCtx)!;

export function AdminNav({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const nav: NavItem[] = [
    { href: "/admin", label: "Tổng quan", icon: "dashboard", exact: true, mobile: true },
    { href: "/admin/roster", label: "Xếp ca", icon: "calendar", mobile: true },
    { href: "/admin/requests", label: "Đơn từ", icon: "inbox", mobile: true },
    { href: "/admin/attendance", label: "Chấm công", icon: "clock", mobile: true },
    { href: "/admin/reports", label: "Báo cáo", icon: "chart" },
    ...(user.role === "ADMIN"
      ? ([
          { href: "/admin/employees", label: "Nhân viên", icon: "users" },
          { href: "/admin/devices", label: "Thiết bị kiosk", icon: "tablet" },
          { href: "/admin/settings", label: "Cấu hình", icon: "settings" },
        ] as NavItem[])
      : []),
  ];
  return (
    <UserCtx.Provider value={user}>
      <AppShell user={user} nav={nav} brandSub="Quản trị" extraLinks={[{ href: "/me", label: "Trang cá nhân", icon: "home" }]}>
        {children}
      </AppShell>
    </UserCtx.Provider>
  );
}
