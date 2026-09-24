/** Khung xương trang cá nhân (v1.16.0) — xem chú thích ở src/app/admin/loading.tsx. */
export default function MeLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="h-6 w-40 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-40 w-full animate-pulse rounded-3xl bg-slate-200" />
      <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}
