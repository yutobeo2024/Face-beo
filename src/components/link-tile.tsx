"use client";
import { Icon, LINK_COLORS, type IconName, type LinkColor } from "@/components/icons";

export type LinkTileItem = { id: number; title: string; url: string; description: string | null; icon: string; color: string };

/** Rút gọn URL để hiển thị dưới ô: bỏ giao thức, chỉ giữ tên miền. */
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Ô liên kết: hình chữ nhật đều nhau, bo tròn, mở tab mới. Dùng chung cho trang nhân viên và xem trước ở trang quản trị. */
export function LinkTile({ link, badge }: { link: LinkTileItem; badge?: string | null }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.description ?? link.url}
      className="card relative flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
    >
      {badge && <span className="absolute top-2 right-2 left-2 truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200 ring-inset">Chỉ: {badge}</span>}
      <span className={`rounded-2xl p-3 ${LINK_COLORS[link.color as LinkColor] ?? LINK_COLORS.brand}`}>
        <Icon name={link.icon as IconName} className="size-7" />
      </span>
      <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">{link.title}</span>
      <span className="line-clamp-1 max-w-full text-[11px] text-slate-400">{link.description || host(link.url)}</span>
    </a>
  );
}
