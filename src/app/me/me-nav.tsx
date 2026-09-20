"use client";
import { createContext, useContext } from "react";
import { AppShell, type NavItem, type ShellUser } from "@/components/shell";

type MeUser = ShellUser & { id: number };
const Ctx = createContext<MeUser | null>(null);
export const useMe = () => useContext(Ctx)!;

const NAV: NavItem[] = [
  { href: "/me", label: "Hôm nay", icon: "home", exact: true, mobile: true },
  { href: "/me/requests", label: "Đơn từ", icon: "file", mobile: true },
  { href: "/me/attendance", label: "Lịch sử công", icon: "calendar", mobile: true },
  { href: "/me/zalo", label: "Zalo", icon: "zalo", mobile: true },
  { href: "/me/info", label: "Thông tin", icon: "info" },
  { href: "/me/password", label: "Đổi mật khẩu", icon: "lock" },
];

export function MeNav({ user, adminAccess, children }: { user: MeUser; adminAccess: boolean; children: React.ReactNode }) {
  return (
    <Ctx.Provider value={user}>
      <AppShell user={user} nav={NAV} brandSub="Nhân viên" extraLinks={adminAccess ? [{ href: "/admin", label: "Trang quản trị", icon: "dashboard" }] : undefined}>
        <div className="mx-auto max-w-3xl">{children}</div>
      </AppShell>
    </Ctx.Provider>
  );
}
