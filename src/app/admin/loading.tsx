/**
 * Khung xương khi đang mở trang (v1.16.0). Có file này thì Next mới prefetch được các trang động, và người dùng
 * thấy bố cục ngay thay vì màn hình đứng im chờ máy chủ.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="h-28 w-full animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-28 w-full animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-28 w-full animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}
