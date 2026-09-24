"use client";
import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { AppShell, type NavItem, type ShellUser } from "@/components/shell";

type MeUser = ShellUser & { id: number };
const Ctx = createContext<MeUser | null>(null);
export const useMe = () => useContext(Ctx)!;

/** Thanh dưới điện thoại chỉ hiện 4 mục đầu có `mobile` — Chat bot đặt ở thanh bên / ngăn kéo để không đẩy mục nào ra. */
const navFor = (chatbot: boolean): NavItem[] =>
  [
    { href: "/me", label: "Hôm nay", icon: "home", exact: true, mobile: true },
    { href: "/me/requests", label: "Đơn từ", icon: "file", mobile: true },
    { href: "/me/attendance", label: "Lịch sử công", icon: "calendar", mobile: true },
    { href: "/me/zalo", label: "Zalo", icon: "zalo", mobile: true },
    ...(chatbot ? [{ href: "/me/chatbot", label: "Chat bot", icon: "chat" as const }] : []),
    { href: "/me/info", label: "Thông tin", icon: "info" },
    { href: "/me/password", label: "Đổi mật khẩu", icon: "lock" },
  ] as NavItem[];

export function MeNav({ user, adminAccess, chatbot, children }: { user: MeUser; adminAccess: boolean; chatbot: boolean; children: React.ReactNode }) {
  // Trang chat cần cả bề ngang (khung chat + bảng bên), các trang khác đọc dễ hơn khi cột hẹp.
  const wide = usePathname()?.startsWith("/me/chatbot");
  return (
    <Ctx.Provider value={user}>
      <AppShell user={user} nav={navFor(chatbot)} brandSub="Nhân viên" extraLinks={adminAccess ? [{ href: "/admin", label: "Trang quản trị", icon: "dashboard" }] : undefined}>
        <div className={wide ? "" : "mx-auto max-w-3xl"}>{children}</div>
      </AppShell>
    </Ctx.Provider>
  );
}
