"use client";
/**
 * Bảng theo dõi đồng phục (v1.20.0).
 *
 * Mỗi dòng là kết luận của MỘT người trong MỘT ngày, lấy từ lượt chấm vào đầu ca. Ba mức: Đạt · Không đạt · Cần xem lại.
 * Nhân sự mở dòng ra xem ảnh vùng áo (ảnh này không có khuôn mặt) rồi bấm Đạt / Không đạt cho những mục máy chưa chắc.
 * Kết luận của máy luôn được giữ lại để đối chiếu, dù người có sửa.
 */
import { useState } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { fmtDay, todayStr } from "@/lib/client/format";
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Field, Loading, PageHeader, StatCard } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useCan } from "../admin-nav";

type Row = {
  id: number;
  workDate: string;
  departmentId: number;
  employee: { id: number; code: string; name: string; department: string } | null;
  status: "PASS" | "FAIL" | "REVIEW" | "SKIPPED";
  machineStatus: string;
  mode: "ON" | "SHADOW";
  reason: string | null;
  reasonText: string | null;
  template: { id: number; name: string; colorHex: string | null } | null;
  score: number | null;
  embedScore: number | null;
  colorScore: number | null;
  cropUrl: string | null;
  checkTime: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  detail: string | null;
};

const STATUS: Record<Row["status"], { label: string; tone: "ontime" | "absent" | "late" | "neutral" }> = {
  PASS: { label: "Đạt", tone: "ontime" },
  FAIL: { label: "Không đạt", tone: "absent" },
  REVIEW: { label: "Cần xem lại", tone: "late" },
  SKIPPED: { label: "Bỏ qua", tone: "neutral" },
};

const FILTERS = [
  { value: "", label: "Tất cả" },
  { value: "FAIL", label: "Không đạt" },
  { value: "REVIEW", label: "Cần xem lại" },
  { value: "PASS", label: "Đạt" },
  { value: "SKIPPED", label: "Bỏ qua" },
] as const;

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

type Tpl = { id: number; departmentId: number; name: string; sampleCount: number };

export default function UniformPage() {
  const can = useCan();
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<string>("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useApi<{ rows: Row[] }>(`/api/uniform/checks${qs({ from, to, departmentId: dept, status })}`);
  const manage = can("uniform.manage");
  // Mẫu áo của các phòng, để Nhân sự lấy CHÍNH ảnh chấm công này làm ảnh mẫu (cùng camera, cùng đèn).
  const tpl = useApi<{ templates: Tpl[] }>(manage ? "/api/uniform/templates" : null);
  const rows = data?.rows ?? [];
  const count = (s: Row["status"]) => rows.filter((r) => r.status === s).length;
  const checked = rows.filter((r) => r.status !== "SKIPPED").length;

  async function takeAsSample(row: Row, templateId: number, templateName: string) {
    setBusy(true);
    try {
      await api(`/api/uniform/templates/${templateId}/samples/from-check`, { body: { checkId: row.id } });
      toast.success(`Đã thêm ảnh này vào mẫu áo “${templateName}”`);
      void tpl.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(row: Row, next: "PASS" | "FAIL") {
    setBusy(true);
    try {
      await api(`/api/uniform/checks/${row.id}`, { method: "PATCH", body: { status: next } });
      toast.success(`Đã ghi nhận: ${STATUS[next].label}`);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Đồng phục"
        subtitle="Kết quả kiểm áo đồng phục ở lượt chấm vào đầu ca. Mục “cần xem lại” là máy chưa chắc — Nhân sự xem ảnh rồi quyết."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/reports/uniform.xlsx${qs({ from, to, departmentId: dept })}`} className="btn btn-secondary" title="File Excel riêng, không trộn vào bảng công">
              <Icon name="download" className="size-4" /> Xuất Excel
            </a>
            {can("uniform.manage") && (
              <a href="/admin/uniform/templates" className="btn btn-secondary">
                <Icon name="settings" className="size-4" /> Mẫu áo
              </a>
            )}
          </div>
        }
      />

      <Card className="mb-3 grid gap-2 p-3 sm:grid-cols-[auto_auto_1fr] sm:items-center">
        <Field label="Từ ngày">{(id) => <input id={id} type="date" className="input sm:w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />}</Field>
        <Field label="Đến ngày">{(id) => <input id={id} type="date" className="input sm:w-40" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} />}</Field>
        <Field label="Phòng ban">{() => <DeptSelect value={dept} onChange={setDept} />}</Field>
      </Card>

      <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={cx(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition",
              status === f.value ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Đã kiểm" value={checked} />
        <StatCard label="Đạt" value={count("PASS")} tone="ontime" />
        <StatCard label="Không đạt" value={count("FAIL")} tone="absent" />
        <StatCard label="Cần xem lại" value={count("REVIEW")} tone="late" />
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon="shirt" title="Chưa có dữ liệu">
            Không có bản ghi nào từ {fmtDay(from)} đến {fmtDay(to)}. Kiểm đồng phục chỉ chạy ở những phòng đã bật và đã khai mẫu áo.
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="hidden w-24 shrink-0 text-xs text-slate-500 sm:block">{fmtDay(r.workDate)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {r.employee ? `${r.employee.code} — ${r.employee.name}` : "(không rõ nhân viên)"}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.employee?.department}
                      {r.template ? ` · khớp mẫu “${r.template.name}”` : ""}
                      {r.reasonText ? ` · ${r.reasonText}` : ""}
                    </span>
                  </span>
                  {r.mode === "SHADOW" && <Badge tone="neutral">chạy thử</Badge>}
                  {r.decidedBy && <Badge tone="neutral">người xác nhận</Badge>}
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  <Icon name={open === r.id ? "chevronUp" : "chevronDown"} className="size-4 shrink-0 text-slate-400" />
                </button>

                {open === r.id && (
                  <div className="grid gap-3 bg-slate-50/60 px-3 py-3 sm:grid-cols-[10rem_1fr]">
                    {r.cropUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.cropUrl} alt="Vùng áo" className="size-40 rounded-xl object-cover ring-1 ring-slate-200" />
                    ) : (
                      <div className="grid size-40 place-items-center rounded-xl bg-slate-100 text-xs text-slate-500">Không có ảnh</div>
                    )}
                    <div className="space-y-2 text-sm">
                      <p className="text-slate-600">
                        Máy kết luận: <b>{STATUS[(r.machineStatus as Row["status"]) ?? "REVIEW"]?.label ?? r.machineStatus}</b>
                        {r.reasonText ? ` — ${r.reasonText}` : ""}
                      </p>
                      <p className="text-slate-600">
                        Điểm: <b>{pct(r.score)}</b> <span className="text-slate-400">(màu {pct(r.colorScore)} · hình dáng {pct(r.embedScore)})</span>
                      </p>
                      {r.template?.colorHex && (
                        <p className="flex items-center gap-2 text-slate-600">
                          Màu mẫu áo: <span className="inline-block size-4 rounded ring-1 ring-slate-300" style={{ background: r.template.colorHex }} /> {r.template.name}
                        </p>
                      )}
                      {r.decidedBy && (
                        <p className="text-slate-600">
                          {r.decidedBy} đã xác nhận{r.note ? ` — ${r.note}` : ""}
                        </p>
                      )}
                      {manage && r.cropUrl && !!(tpl.data?.templates ?? []).filter((t) => t.departmentId === r.departmentId).length && (
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2 text-xs text-slate-600">
                          <span>Dùng ảnh này làm ảnh mẫu (đúng camera, đúng đèn):</span>
                          {(tpl.data?.templates ?? [])
                            .filter((t) => t.departmentId === r.departmentId)
                            .map((t) => (
                              <Button key={t.id} size="sm" variant="ghost" disabled={busy} onClick={() => takeAsSample(r, t.id, t.name)}>
                                + {t.name} ({t.sampleCount})
                              </Button>
                            ))}
                        </div>
                      )}
                      {can("uniform.decide") && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(r, "PASS")}>
                            Đạt
                          </Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => decide(r, "FAIL")}>
                            Không đạt
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
