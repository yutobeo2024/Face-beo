"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { EmptyState, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { LinkTile, type LinkTileItem } from "@/components/link-tile";

type LinkItem = LinkTileItem & { visibleToMe?: boolean; audience?: string | null };

/** Mục "Thông tin": lưới ô liên kết (web app, Google Sheet, Drive…) do Nhân sự / Quản trị cấu hình, đã lọc theo vai trò + phòng ban. */
export default function InfoPage() {
  const { data, error, loading, reload } = useApi<{ links: LinkItem[]; canManage: boolean }>("/api/me/links");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  const restricted = data.links.filter((l) => l.visibleToMe === false).length;
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
      {data.canManage && restricted > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Bạn có quyền quản lý liên kết nên thấy mọi ô. Ô có nhãn <b>Chỉ: …</b> đang giới hạn cho vai trò / phòng ban ghi trên nhãn — người ngoài diện đó (kể cả bạn khi không có quyền này) sẽ không thấy.
        </p>
      )}
      {data.links.length === 0 ? (
        <EmptyState icon="info" title="Chưa có liên kết nào dành cho bạn">
          Nhân sự / Quản trị sẽ thêm liên kết tại đây. Nếu bạn nghĩ thiếu liên kết, báo Nhân sự.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.links.map((l) => (
            <LinkTile key={l.id} link={l} badge={l.audience} />
          ))}
        </div>
      )}
    </div>
  );
}
