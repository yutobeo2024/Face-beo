"use client";
import { createContext, useContext } from "react";
import { AppShell, type NavItem, type ShellUser } from "@/components/shell";
import type { Capability } from "@/lib/permissions";

type AdminUser = ShellUser & { id: number; caps: string[] };
const UserCtx = createContext<AdminUser | null>(null);
export const useAdminUser = () => useContext(UserCtx)!;

/** Người dùng hiện tại có quyền `cap` không (ADMIN luôn có — danh sách caps đã được server tính sẵn). */
export function useCan() {
  const u = useAdminUser();
  return (cap: Capability) => u.caps.includes(cap);
}

export function AdminNav({ user, caps, children }: { user: ShellUser & { id: number }; caps: string[]; children: React.ReactNode }) {
  const has = (c: Capability) => caps.includes(c);
  const nav: NavItem[] = [
    has("dashboard.view") && { href: "/admin", label: "Tổng quan", icon: "dashboard", exact: true, mobile: true },
    has("roster.view") && { href: "/admin/roster", label: "Xếp ca", icon: "calendar", mobile: true },
    (has("requests.decide") || has("attendance.executeCorrection")) && { href: "/admin/requests", label: "Đơn từ", icon: "inbox", mobile: true },
    has("attendance.view") && { href: "/admin/attendance", label: "Chấm công", icon: "clock", mobile: true },
    has("reports.view") && { href: "/admin/reports", label: "Báo cáo", icon: "chart" },
    (has("employees.view") || has("employees.manage")) && { href: "/admin/employees", label: "Nhân viên", icon: "users" },
    has("devices.manage") && { href: "/admin/devices", label: "Thiết bị kiosk", icon: "tablet" },
    (has("org.manage") || has("settings.system")) && { href: "/admin/settings", label: "Cấu hình", icon: "settings", exact: true },
    has("permissions.manage") && { href: "/admin/settings/permissions", label: "Phân quyền", icon: "shield" },
  ].filter(Boolean) as NavItem[];
  return (
    <UserCtx.Provider value={{ ...user, caps }}>
      <AppShell user={user} nav={nav} brandSub="Quản trị" extraLinks={[{ href: "/me", label: "Trang cá nhân", icon: "home" }]}>
        {children}
      </AppShell>
    </UserCtx.Provider>
  );
}
