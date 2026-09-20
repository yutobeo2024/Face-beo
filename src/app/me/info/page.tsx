"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { EmptyState, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { Icon, LINK_COLORS, type IconName, type LinkColor } from "@/components/icons";

type LinkItem = { id: number; title: string; url: string; description: string | null; icon: string; color: string };

/** Rút gọn URL để hiển thị dưới ô: bỏ giao thức, chỉ giữ tên miền. */
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Mục "Thông tin": lưới ô liên kết (web app, Google Sheet, Drive…) do Nhân sự / Quản trị cấu hình, đã lọc theo vai trò + phòng ban. */
export default function InfoPage() {
  const { data, error, loading, reload } = useApi<{ links: LinkItem[]; canManage: boolean }>("/api/me/links");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Thông tin"
        subtitle="Liên kết nhanh tới các công cụ, bảng tính và tài liệu dùng chung. Bấm vào ô để mở trong tab mới."
        actions={
          data.canManage ? (
            <Link href="/admin/links" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Icon name="edit" className="size-4" />
              Quản lý liên kết
            </Link>
          ) : undefined
        }
      />
      {data.links.length === 0 ? (
        <EmptyState icon="info" title="Chưa có liên kết nào dành cho bạn">
          Nhân sự / Quản trị sẽ thêm liên kết tại đây. Nếu bạn nghĩ thiếu liên kết, báo Nhân sự.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              title={l.description ?? l.url}
              className="card flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
            >
              <span className={`rounded-2xl p-3 ${LINK_COLORS[l.color as LinkColor] ?? LINK_COLORS.brand}`}>
                <Icon name={l.icon as IconName} className="size-7" />
              </span>
              <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">{l.title}</span>
              <span className="line-clamp-1 max-w-full text-[11px] text-slate-400">{l.description || host(l.url)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
