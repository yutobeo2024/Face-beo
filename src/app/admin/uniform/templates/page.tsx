"use client";
/**
 * Mẫu áo đồng phục (v1.20.0): mỗi phòng khai 2–3 mẫu, nhân viên mặc mẫu nào cũng được.
 *
 * Ảnh mẫu nên chụp NGAY TẠI KIOSK khi nhân viên mặc áo: ảnh chấm công tối hơn ảnh thường rất nhiều, mẫu chụp ngoài
 * sáng sẽ lệch điều kiện. Mẫu dưới 3 ảnh vẫn dùng được nhưng máy luôn để "cần xem lại" thay vì kết luận.
 */
import { useRef, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useCan } from "../../admin-nav";

type Sample = { id: number; kind: string; createdAt: string };
type Template = {
  id: number;
  departmentId: number;
  name: string;
  active: boolean;
  colorHex: string | null;
  sampleCount: number;
  ready: boolean;
  warning: string | null;
  samples: Sample[];
};
type Dept = { id: number; name: string; uniformMode?: string };

const MODES = [
  { value: "OFF", label: "Tắt — không kiểm" },
  { value: "SHADOW", label: "Chạy thử — ghi nhận, không báo ai" },
  { value: "ON", label: "Bật — kiểm thật" },
] as const;

const MODE_HINT: Record<string, string> = {
  OFF: "Phòng này không bị kiểm đồng phục.",
  SHADOW: "Máy vẫn chấm điểm và lưu lại để Nhân sự đối chiếu, nhưng KHÔNG gửi Zalo và không dùng để xử lý nhân sự. Nên chạy thử 2 tuần trước khi bật thật.",
  ON: "Kiểm thật: kết quả vào bảng theo dõi, file báo cáo và tin tổng hợp cuối ngày cho quản lý phòng.",
};

export default function UniformTemplatesPage() {
  const can = useCan();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ departmentId: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTo, setUploadTo] = useState<{ id: number; kind: "SHIRT" | "WORN" } | null>(null);

  const depts = useApi<{ departments: Dept[] }>("/api/departments");
  const tpl = useApi<{ templates: Template[] }>("/api/uniform/templates");
  const manage = can("uniform.manage");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      void tpl.reload();
      void depts.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  async function pickFile(id: number, kind: "SHIRT" | "WORN") {
    setUploadTo({ id, kind });
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !uploadTo) return;
    if (f.size > 2 * 1024 * 1024) return toast.error("Ảnh quá lớn (tối đa 2 MB)");
    await run(
      () =>
        fetch(`/api/uniform/templates/${uploadTo.id}/samples?kind=${uploadTo.kind}`, { method: "PUT", body: f }).then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Tải ảnh không thành công");
        }),
      "Đã thêm ảnh mẫu",
    );
  }

  const byDept = new Map<number, Template[]>();
  for (const t of tpl.data?.templates ?? []) byDept.set(t.departmentId, [...(byDept.get(t.departmentId) ?? []), t]);
  const list = (depts.data?.departments ?? []).filter((d) => manage || byDept.has(d.id));

  return (
    <>
      <PageHeader
        title="Mẫu áo đồng phục"
        subtitle="Mỗi phòng khai những mẫu áo được chấp nhận. Nhân viên mặc mẫu nào trong số đó đều tính là đạt."
        actions={
          <a href="/admin/uniform" className="btn btn-secondary">
            <Icon name="clock" className="size-4" /> Bảng theo dõi
          </a>
        }
      />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />

      <Card className="mb-3 p-3 text-sm text-slate-600">
        <p className="mb-1 font-semibold text-slate-700">Cách khai cho đúng</p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Mỗi mẫu áo nên có <b>ít nhất 3 ảnh</b>; dưới mức đó máy vẫn chấm điểm nhưng luôn để “cần xem lại”.</li>
          <li>
            Cách lấy ảnh mẫu <b>tốt nhất</b>: cho vài nhân viên mặc đúng áo <b>chấm công bình thường</b>, rồi sang{" "}
            <a href="/admin/uniform" className="font-semibold text-brand-700 underline">bảng theo dõi</a>, mở dòng của họ và bấm{" "}
            <b>“Dùng ảnh này làm ảnh mẫu”</b>. Ảnh sinh ra đúng camera, đúng đèn, đúng khoảng cách — không cần chụp tay.
          </li>
          <li>Ảnh chụp bằng điện thoại vẫn tải lên được, nhưng sáng hơn ảnh chấm công nhiều nên chỉ dùng tạm khi chưa có ảnh từ kiosk.</li>
          <li>Ảnh cần thấy rõ <b>logo trước ngực</b>: đó là dấu hiệu tách áo đồng phục khỏi áo thường cùng màu.</li>
          <li>Áo khoác đồng phục mặc ngoài cũng nên khai thành một mẫu riêng.</li>
        </ul>
      </Card>

      {(depts.error || tpl.error) && <ErrorBox message={depts.error ?? tpl.error ?? ""} onRetry={() => void tpl.reload()} />}
      {tpl.loading && !tpl.data ? (
        <Loading />
      ) : !list.length ? (
        <Card>
          <EmptyState icon="shirt" title="Chưa có phòng nào">
            Chưa có phòng ban nào để khai mẫu áo.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((d) => {
            const items = byDept.get(d.id) ?? [];
            const mode = d.uniformMode ?? "OFF";
            return (
              <Card key={d.id}>
                <CardHeader
                  title={
                    <span>
                      {d.name}
                      <span className="block text-xs font-normal text-slate-500">{MODE_HINT[mode]}</span>
                    </span>
                  }
                  actions={
                    manage ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={mode}
                          onChange={(e) => void run(() => api(`/api/uniform/departments/${d.id}`, { method: "PATCH", body: { uniformMode: e.target.value } }), "Đã đổi chế độ kiểm")}
                          disabled={busy}
                          className="w-64"
                        >
                          {MODES.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" icon="plus" disabled={busy} onClick={() => setAdding({ departmentId: String(d.id), name: "" })}>
                          Thêm mẫu áo
                        </Button>
                      </div>
                    ) : (
                      <Badge tone={mode === "ON" ? "ontime" : mode === "SHADOW" ? "late" : "neutral"}>{MODES.find((m) => m.value === mode)?.label}</Badge>
                    )
                  }
                />
                {!items.length ? (
                  <p className="px-4 pb-4 text-sm text-slate-500">Chưa khai mẫu áo nào — phòng này chưa kiểm được.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {items.map((t) => (
                      <li key={t.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {t.colorHex && <span className="size-5 shrink-0 rounded ring-1 ring-slate-300" style={{ background: t.colorHex }} title={t.colorHex} />}
                          <span className="font-medium text-slate-800">{t.name}</span>
                          <Badge tone={t.active ? "ontime" : "neutral"}>{t.active ? "đang dùng" : "đang tắt"}</Badge>
                          <span className="text-xs text-slate-500">{t.sampleCount} ảnh mẫu</span>
                          {manage && (
                            <span className="ml-auto flex flex-wrap gap-1.5">
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pickFile(t.id, "WORN")}>
                                + Ảnh người mặc
                              </Button>
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pickFile(t.id, "SHIRT")}>
                                + Ảnh áo
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy || (!t.ready && !t.active)}
                                onClick={() => void run(() => api(`/api/uniform/templates/${t.id}`, { method: "PATCH", body: { active: !t.active } }), t.active ? "Đã tắt mẫu áo" : "Đã bật mẫu áo")}
                              >
                                {t.active ? "Tắt" : "Bật"}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`/api/uniform/templates/${t.id}`, { method: "DELETE" }), "Đã xóa mẫu áo")}>
                                Xóa
                              </Button>
                            </span>
                          )}
                        </div>
                        {t.warning && <p className="mt-1 text-xs text-amber-700">{t.warning}</p>}
                        {!!t.samples.length && (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {t.samples.map((s) => (
                              <li key={s.id} className="group relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/uniform/templates/${t.id}/samples/${s.id}`} alt={t.name} className="size-20 rounded-lg object-cover ring-1 ring-slate-200" />
                                <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-slate-900/55 text-center text-[10px] text-white">{s.kind === "WORN" ? "người mặc" : "áo"}</span>
                                {manage && (
                                  <button
                                    type="button"
                                    className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full bg-rose-600 text-white group-hover:grid"
                                    aria-label="Xóa ảnh mẫu"
                                    disabled={busy}
                                    onClick={() => void run(() => api(`/api/uniform/templates/${t.id}/samples/${s.id}`, { method: "DELETE" }), "Đã xóa ảnh mẫu")}
                                  >
                                    ✕
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {adding && (
        <Modal
          open
          title="Thêm mẫu áo"
          onClose={() => setAdding(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(null)}>
                Hủy
              </Button>
              <Button
                loading={busy}
                disabled={!adding.name.trim()}
                onClick={async () => {
                  await run(() => api("/api/uniform/templates", { body: { departmentId: Number(adding.departmentId), name: adding.name.trim() } }), "Đã thêm mẫu áo — giờ tải ảnh mẫu lên");
                  setAdding(null);
                }}
              >
                Thêm
              </Button>
            </>
          }
        >
          <Field label="Tên mẫu áo" hint="Ví dụ: Áo polo navy, Áo blouse trắng, Áo khoác đồng phục">
            {(id) => <input id={id} className="input" value={adding.name} maxLength={60} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Áo polo navy" />}
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            Thêm xong hãy lấy ít nhất 3 ảnh mẫu — tốt nhất là bấm “Dùng ảnh này làm ảnh mẫu” ở bảng theo dõi — rồi bật mẫu áo lên.
          </p>
        </Modal>
      )}
    </>
  );
}
