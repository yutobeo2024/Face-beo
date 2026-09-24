"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { Avatar, cx, IconButton } from "./ui";
import { api } from "@/lib/client/api";
import { InstallBanner, InstallMenuItem } from "./pwa-install";

export type NavItem = { href: string; label: string; icon: IconName; exact?: boolean; mobile?: boolean };
export type ShellUser = { name: string; code: string; role: string };

const ROLE_LABEL: Record<string, string> = { ADMIN: "Quản trị", MANAGER: "Quản lý", EMPLOYEE: "Nhân viên" };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

async function logout(router: ReturnType<typeof useRouter>) {
  await api("/api/auth/logout", { body: {} }).catch(() => {});
  router.replace("/login");
  router.refresh();
}

function UserBlock({ user, compact }: { user: ShellUser; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={user.name} />
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
          <p className="truncate text-xs text-slate-500">
            {user.code} · {ROLE_LABEL[user.role] ?? user.role}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Khung ứng dụng responsive:
 * - ≥1024px: sidebar cố định bên trái.
 * - <1024px: top bar + bottom nav (các mục `mobile`) + drawer cho toàn bộ menu.
 */
export function AppShell({ user, nav, extraLinks, children, brandSub }: { user: ShellUser; nav: NavItem[]; extraLinks?: NavItem[]; children: React.ReactNode; brandSub: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const mobileNav = nav.filter((n) => n.mobile).slice(0, 4);
  const current = [...nav, ...(extraLinks ?? [])].find((n) => isActive(pathname, n));

  const links = (onDark = false) => (
    <nav className="flex flex-col gap-0.5">
      {nav.map((n) => {
        const active = isActive(pathname, n);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition",
              active ? (onDark ? "bg-white/15 text-white" : "bg-brand-50 text-brand-800") : onDark ? "text-brand-100/80 hover:bg-white/10 hover:text-white" : "text-slate-600 hover:bg-slate-100",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={n.icon} className="size-5 shrink-0" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-gradient-to-b from-brand-900 to-brand-950 px-3 py-4 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-9 rounded-xl" />
          <div>
            <p className="text-base leading-tight font-bold text-white">Face Beo</p>
            <p className="text-xs text-brand-200/70">{brandSub}</p>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto">{links(true)}</div>
        {extraLinks && (
          <div className="mt-2 border-t border-white/10 pt-2">
            {extraLinks.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-brand-100/80 hover:bg-white/10 hover:text-white">
                <Icon name={n.icon} className="size-5" /> {n.label}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-2 border-t border-white/10 pt-2">
          <InstallMenuItem variant="sidebar" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-white/5 p-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={user.name} className="size-8" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user.name}</p>
              <p className="truncate text-xs text-brand-200/70">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          <IconButton icon="logout" label="Đăng xuất" onClick={() => logout(router)} className="text-brand-100 hover:bg-white/10" />
        </div>
      </aside>

      {/* Top bar mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200/80 bg-white px-2 lg:hidden">
        <IconButton icon="menu" label="Mở menu" onClick={() => setOpen(true)} />
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800">{current?.label ?? "Face Beo"}</p>
        <Link href="/" aria-label="Trang chủ" className="mr-1">
          <Avatar name={user.name} className="size-8" />
        </Link>
      </header>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/45" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-xs animate-slide-up flex-col bg-white p-3 shadow-[var(--shadow-pop)]">
            <div className="mb-3 flex items-center justify-between px-1">
              <UserBlock user={user} />
              <IconButton icon="x" label="Đóng menu" onClick={() => setOpen(false)} />
            </div>
            <div className="flex-1 overflow-y-auto">{links()}</div>
            {extraLinks?.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-slate-600 hover:bg-slate-100">
                <Icon name={n.icon} /> {n.label}
              </Link>
            ))}
            <InstallMenuItem variant="drawer" />
            <button onClick={() => logout(router)} className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-rose-600 hover:bg-rose-50">
              <Icon name="logout" /> Đăng xuất
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl px-4 pt-4 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
        <InstallBanner />
        {children}
      </main>

      {/* Bottom nav mobile */}
      {mobileNav.length > 0 && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white lg:hidden" aria-label="Điều hướng chính">
          <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${mobileNav.length + (nav.length > mobileNav.length ? 1 : 0)}, minmax(0, 1fr))` }}>
            {mobileNav.map((n) => {
              const active = isActive(pathname, n);
              return (
                <Link key={n.href} href={n.href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", active ? "text-brand-700" : "text-slate-500")} aria-current={active ? "page" : undefined}>
                  <span className={cx("rounded-full px-4 py-1 transition", active && "bg-brand-50")}>
                    <Icon name={n.icon} className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                  </span>
                  <span className="truncate">{n.label}</span>
                </Link>
              );
            })}
            {nav.length > mobileNav.length && (
              <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-slate-500">
                <span className="rounded-full px-4 py-1">
                  <Icon name="menu" className="size-[22px]" />
                </span>
                Thêm
              </button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
