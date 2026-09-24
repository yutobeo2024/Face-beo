"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";
import { Button, Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";

type Status = { linked: boolean; linkedAt: string | null; code: string | null; expiresAt: string | null; simulated: boolean; oaName: string };

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return 0;
  return Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
}

export default function ZaloPage() {
  const toast = useToast();
  // Chờ nhân viên nhắn mã: hỏi lại mỗi 15 giây; liên kết xong thì thôi hỏi (trước đây hỏi mãi 5 giây/lần).
  const [linked, setLinked] = useState(false);
  const { data, error, loading, reload, setData } = useApi<Status>("/api/me/zalo", { refreshMs: linked ? 0 : 15000 });
  useEffect(() => setLinked(!!data?.linked), [data?.linked]);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(data?.code ? data.expiresAt : null);

  async function gen() {
    setBusy(true);
    try {
      const r = await api<{ code: string; expiresAt: string }>("/api/me/zalo", { body: {} });
      if (data) setData({ ...data, ...r });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unlink() {
    if (!confirm("Hủy liên kết Zalo? Bạn sẽ không nhận thông báo qua Zalo nữa.")) return;
    await api("/api/me/zalo", { method: "DELETE" }).catch((e) => toast.error(e.message));
    void reload();
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  return (
    <>
      <PageHeader title="Liên kết Zalo" subtitle="Nhận thông báo đi trễ, vắng mặt và kết quả duyệt đơn qua Zalo OA." />
      {data.linked ? (
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="check" className="size-8" strokeWidth={2.5} />
          </div>
          <h2 className="text-lg font-bold">Đã liên kết Zalo</h2>
          <p className="mt-1 text-sm text-slate-500">Từ {data.linkedAt ? fmtDateTime(data.linkedAt) : ""}</p>
          <Button variant="secondary" className="mt-5" onClick={unlink}>
            Hủy liên kết
          </Button>
        </Card>
      ) : (
        <Card className="p-5">
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">1</span>
              <div>
                <p className="font-semibold text-slate-800">Quan tâm Zalo OA “{data.oaName}”</p>
                <p className="text-sm text-slate-500">Mở Zalo, tìm Official Account của công ty và bấm Quan tâm.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">2</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">Lấy mã liên kết</p>
                {data.code && left > 0 ? (
                  <div className="mt-2 rounded-2xl bg-slate-900 p-4 text-center text-white">
                    <p className="font-mono text-4xl font-bold tracking-[0.35em] select-all">{data.code}</p>
                    <p className="mt-1 text-xs text-slate-400 tabular-nums">
                      Hết hạn sau {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="copy"
                      className="mt-2 text-slate-200 hover:bg-white/10"
                      onClick={() => navigator.clipboard?.writeText(data.code!).then(() => toast.success("Đã sao chép mã"))}
                    >
                      Sao chép
                    </Button>
                  </div>
                ) : (
                  <Button className="mt-2" onClick={gen} loading={busy}>
                    Tạo mã (hạn 15 phút)
                  </Button>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">3</span>
              <div>
                <p className="font-semibold text-slate-800">Nhắn mã cho OA</p>
                <p className="text-sm text-slate-500">Gửi đúng 6 ký tự trên vào khung chat của OA. Trang này tự cập nhật khi liên kết thành công.</p>
              </div>
            </li>
          </ol>
          {data.simulated && <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Hệ thống đang ở chế độ mô phỏng Zalo — quản trị chưa cấu hình OA thật.</p>}
        </Card>
      )}
    </>
  );
}
