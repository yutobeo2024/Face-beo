"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { fmtDateTime, relTime } from "@/lib/client/format";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useAdminUser } from "../admin-nav";

type Device = { id: number; name: string; location: string | null; active: boolean; lastSeenAt: string | null; paired: boolean; pairCode: string | null; pairExpiresAt: string | null };

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return <span className="tabular-nums">{s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "hết hạn"}</span>;
}

export default function DevicesPage() {
  const user = useAdminUser();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ devices: Device[] }>(user.role === "ADMIN" ? "/api/devices" : null, { refreshMs: 15_000 });
  const [form, setForm] = useState<{ name: string; location: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!form) return;
    setBusy(true);
    try {
      await api("/api/devices", { body: form });
      toast.success("Đã tạo thiết bị — nhập mã ghép trên tablet trong 10 phút");
      setForm(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(d: Device, what: "pair-code" | "revoke") {
    if (what === "revoke" && !confirm(`Thu hồi "${d.name}"? Tablet sẽ ngừng chấm công ngay lập tức.`)) return;
    try {
      await api(`/api/devices/${d.id}/${what}`, { body: {} });
      toast.success(what === "revoke" ? "Đã thu hồi thiết bị" : "Đã tạo mã ghép mới");
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (user.role !== "ADMIN") return <ErrorBox message="Chỉ ADMIN quản lý thiết bị." />;
  return (
    <>
      <PageHeader
        title="Thiết bị kiosk"
        subtitle="Ghép tablet để chấm công. Server chỉ lưu mã băm của token thiết bị."
        actions={
          <Button icon="plus" onClick={() => setForm({ name: "", location: "" })}>
            Thêm thiết bị
          </Button>
        }
      />
      <Card className="mb-4 flex items-start gap-3 bg-brand-50/50 p-4 text-sm text-slate-700">
        <Icon name="tablet" className="mt-0.5 size-5 shrink-0 text-brand-700" />
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Tạo thiết bị, hệ thống sinh mã ghép 6 số (hạn 10 phút).</li>
          <li>
            Trên tablet mở <b className="font-mono">/kiosk/pair</b> (bắt buộc HTTPS) và nhập mã.
          </li>
          <li>Thu hồi bất cứ lúc nào nếu tablet bị mất hoặc thay thế.</li>
        </ol>
      </Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.devices.length ? (
        <Card>
          <EmptyState icon="tablet" title="Chưa có thiết bị nào" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.devices.map((d) => {
            const online = d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 5 * 60_000;
            return (
              <Card key={d.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">{d.name}</p>
                    <p className="truncate text-sm text-slate-500">{d.location || "—"}</p>
                  </div>
                  {!d.active ? <Badge tone="absent">Đã thu hồi</Badge> : d.paired ? <Badge tone={online ? "ontime" : "neutral"} dot>{online ? "Trực tuyến" : "Ngoại tuyến"}</Badge> : <Badge tone="late">Chờ ghép</Badge>}
                </div>
                <p className="mt-2 text-xs text-slate-500">{d.lastSeenAt ? `Hoạt động ${relTime(d.lastSeenAt)} · ${fmtDateTime(d.lastSeenAt)}` : "Chưa từng kết nối"}</p>
                {d.pairCode && d.pairExpiresAt && (
                  <div className="mt-3 rounded-xl bg-slate-900 p-3 text-center text-white">
                    <p className="text-xs text-slate-400">Mã ghép</p>
                    <p className="font-mono text-3xl font-bold tracking-[0.3em]">{d.pairCode}</p>
                    <p className="text-xs text-slate-400">
                      còn <Countdown until={d.pairExpiresAt} />
                    </p>
                  </div>
                )}
                <div className="mt-auto flex gap-2 pt-3">
                  <Button size="sm" variant="secondary" icon="refresh" className="flex-1" onClick={() => act(d, "pair-code")}>
                    {d.paired ? "Ghép lại" : "Mã mới"}
                  </Button>
                  {d.active && (
                    <Button size="sm" variant="secondary" icon="x" className="text-rose-700" onClick={() => act(d, "revoke")}>
                      Thu hồi
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Thêm thiết bị kiosk"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Hủy
            </Button>
            <Button loading={busy} disabled={(form?.name.trim().length ?? 0) < 2} onClick={create}>
              Tạo và lấy mã ghép
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <Field label="Tên thiết bị">{(id) => <input id={id} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Kiosk cổng sau" autoFocus />}</Field>
            <Field label="Vị trí (tùy chọn)">{(id) => <input id={id} className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Tầng 2 — khu kho" />}</Field>
          </div>
        )}
      </Modal>
    </>
  );
}
