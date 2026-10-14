"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/** Hai tab đầu mục Công việc: danh sách dự án / việc của tôi. */
export function TasksTabs() {
  const path = usePathname();
  const tabs = [
    { href: "/me/tasks", label: "Dự án" },
    { href: "/me/tasks/my", label: "Việc của tôi" },
  ];
  return (
    <div className="no-scrollbar mb-4 inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition", path === t.href ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
