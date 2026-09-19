"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { fmtDay, weekdayOf, WEEKDAY_LONG } from "@/lib/client/format";
import { Badge, Button, Card, CardHeader, ErrorBox, Field, IconButton, Loading, Modal, PageHeader, Select } from "@/components/ui";
import { useDepartments } from "@/components/dept-select";
import { useToast } from "@/components/toast";
import { useCan } from "../admin-nav";

type Settings = { matchThreshold: number; matchMargin: number; livenessThreshold: number; livenessServerThreshold: number; absentAfterMinutes: number; snapshotRetentionDays: number; otRoundMinutes: number };
type Shift = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
  breakStart: string | null;
  workDayValue: number;
};
type Weight = { departmentId: number; shiftId: number; workDayValue: number };
type Holiday = { date: string; name: string };
const DAY_KEYS = ["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"] as const;
const DAY_LABEL = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
type Pattern = { id?: number; name: string; employeeCount?: number } & Record<(typeof DAY_KEYS)[number], number | null>;

const FIELDS: { key: keyof Settings; label: string; hint: string; step: number }[] = [
  { key: "matchThreshold", label: "Ngưỡng khớp khuôn mặt", hint: "Cosine top-1 tối thiểu (mặc định 0.55). Hiệu chỉnh trong pilot.", step: 0.01 },
  { key: "matchMargin", label: "Chênh lệch top-1/top-2", hint: "Top-1 phải hơn top-2 ít nhất (mặc định 0.05).", step: 0.01 },
  { key: "livenessThreshold", label: "Ngưỡng liveness", hint: "Trung bình điểm antispoof + liveness của 5 khung.", step: 0.01 },
  { key: "livenessServerThreshold", label: "Ngưỡng liveness L2 (server)", hint: "Xác suất “mặt thật” tối thiểu của MiniFASNetV2. Chỉ dùng khi LIVENESS_SERVER=true.", step: 0.01 },
  { key: "absentAfterMinutes", label: "Tính vắng sau (phút)", hint: "Quá số phút này sau giờ vào ca mà chưa chấm => vắng.", step: 1 },
  { key: "otRoundMinutes", label: "Làm tròn OT (phút)", hint: "Phút OT làm tròn xuống theo bội số này.", step: 1 },
  { key: "snapshotRetentionDays", label: "Lưu snapshot (ngày)", hint: "Job 02:00 tự xóa ảnh quá hạn.", step: 1 },
];

export default function SettingsPage() {
  const can = useCan();
  const sys = can("settings.system");
  const org = can("org.manage");
  const toast = useToast();
  const s = useApi<{ settings: Settings; zaloGroupId: string; system: { zaloSimulated: boolean; livenessServer: boolean; l2: { modelPath: string; modelExists: boolean; error: string | null }; faceModelVersion: string } }>(sys ? "/api/settings" : null);
  const shifts = useApi<{ shifts: Shift[] }>("/api/shifts");
  const holidays = useApi<{ holidays: Holiday[] }>("/api/holidays");
  const patterns = useApi<{ patterns: Pattern[] }>(org ? "/api/work-patterns" : null);
  const [patternForm, setPatternForm] = useState<Pattern | null>(null);
  const depts = useDepartments();
  const emps = useApi<{ employees: { id: number; code: string; name: string; departmentId: number }[] }>(org ? "/api/employees" : null);
  const [form, setForm] = useState<Settings | null>(null);
  const [groupId, setGroupId] = useState("");
  const [shiftForm, setShiftForm] = useState<(Omit<Shift, "id"> & { id?: number }) | null>(null);
  const weights = useApi<{ weights: Weight[] }>(org ? "/api/shift-weights" : null);
  const [weightForm, setWeightForm] = useState<{ departmentId: string; shiftId: string; value: string } | null>(null);
  const [holiday, setHoliday] = useState<Holiday>({ date: "", name: "" });
  const [newDept, setNewDept] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (s.data) {
      setForm(s.data.settings);
      setGroupId(s.data.zaloGroupId ?? "");
    }
  }, [s.data]);

  async function run(fn: () => Promise<unknown>, msg: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      after?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sys && !org) return <ErrorBox message="Bạn không có quyền vào trang cấu hình." />;
  if (sys && s.error) return <ErrorBox message={s.error} onRetry={s.reload} />;
  if (sys && (!form || !s.data)) return <Loading />;

  return (
    <>
      <PageHeader title="Cấu hình" subtitle="Ca làm việc, ngày lễ, phòng ban, ngưỡng nhận diện và thời hạn lưu ảnh." />
      {sys && s.data && (
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={s.data.system.zaloSimulated ? "late" : "ontime"}>Zalo OA: {s.data.system.zaloSimulated ? "mô phỏng" : "đang gửi thật"}</Badge>
        <Badge tone={!s.data.system.livenessServer ? "neutral" : s.data.system.l2.modelExists && !s.data.system.l2.error ? "ontime" : "absent"}>
          Liveness L2 server: {!s.data.system.livenessServer ? "tắt" : !s.data.system.l2.modelExists ? "bật nhưng thiếu mô hình" : s.data.system.l2.error ? "lỗi" : "bật (MiniFASNetV2)"}
        </Badge>
        <Badge tone="neutral">Mô hình: {s.data.system.faceModelVersion}</Badge>
        <Badge tone={s.data.zaloGroupId ? "ontime" : "late"}>Nhóm Zalo minh bạch: {s.data.zaloGroupId ? "đã cấu hình" : "chưa cấu hình"}</Badge>
      </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {sys && form && (
        <Card>
          <CardHeader title="Ngưỡng & thời hạn" />
          <form
            className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api("/api/settings", { method: "PUT", body: { ...form, zaloGroupId: groupId } }), "Đã lưu cấu hình", s.reload);
            }}
          >
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(id) => <input id={id} type="number" step={f.step} className="input tabular-nums" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />}
              </Field>
            ))}
            <Field
              className="sm:col-span-2"
              label="ID nhóm Zalo OA (GMF) nhận tin minh bạch"
              hint="Mọi thao tác duyệt/sửa của Nhân sự và Quản trị được gửi vào nhóm này. Nhóm phải do OA Doanh nghiệp tạo và quản lý."
            >
              {(id) => <input id={id} className="input font-mono" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="VD: 1234567890123456789" />}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy}>
                Lưu cấu hình
              </Button>
            </div>
          </form>
        </Card>
        )}

        {org && (
          <>
        <Card>
          <CardHeader
            title="Ca làm việc"
            actions={
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setShiftForm({ name: "", startTime: "08:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5, graceEarlyMinutes: 0, breakStart: "12:00", workDayValue: 1 })}>
                Thêm ca
              </Button>
            }
          />
          <ul className="divide-y divide-slate-100">
            {shifts.data?.shifts.map((sh) => (
              <li key={sh.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">
                    {sh.name} <span className="font-normal text-slate-500 tabular-nums">{sh.startTime}–{sh.endTime}</span>
                    {sh.endTime <= sh.startTime && <Badge tone="violet" className="ml-2">qua đêm</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    Nghỉ {sh.breakMinutes}p{sh.breakStart ? ` từ ${sh.breakStart}` : ""} · ân hạn trễ {sh.graceLateMinutes}p · ân hạn sớm {sh.graceEarlyMinutes}p ·{" "}
                    <span className="font-semibold text-slate-700">{sh.workDayValue} công</span>
                  </p>
                </div>
                <IconButton icon="edit" label="Sửa ca" onClick={() => setShiftForm(sh)} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Hệ số công theo phòng"
            actions={
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setWeightForm({ departmentId: "", shiftId: "", value: "1" })}>
                Thêm
              </Button>
            }
          />
          <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">
            Ghi đè hệ số công chung của ca cho từng phòng (vd. Hành chính: Sáng thứ Bảy = 0.5). Phòng không đặt riêng dùng hệ số của ca. Thay đổi áp dụng cho các tháng
            chưa chốt công.
          </p>
          {weights.data?.weights.length ? (
            <ul className="divide-y divide-slate-100">
              {weights.data.weights.map((w) => {
                const sh = shifts.data?.shifts.find((x) => x.id === w.shiftId);
                const d = depts.data?.departments.find((x) => x.id === w.departmentId);
                return (
                  <li key={`${w.departmentId}-${w.shiftId}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">{d?.name ?? `Phòng #${w.departmentId}`}</p>
                      <p className="text-xs text-slate-500">
                        {sh?.name ?? `Ca #${w.shiftId}`} · chung {sh?.workDayValue ?? 1} → <span className="font-semibold text-slate-700">{w.workDayValue} công</span>
                      </p>
                    </div>
                    <IconButton
                      icon="edit"
                      label="Sửa hệ số"
                      onClick={() => setWeightForm({ departmentId: String(w.departmentId), shiftId: String(w.shiftId), value: String(w.workDayValue) })}
                    />
                    <IconButton
                      icon="trash"
                      label="Xóa hệ số riêng"
                      onClick={() =>
                        run(
                          () => api("/api/shift-weights", { method: "PUT", body: { weights: [{ departmentId: w.departmentId, shiftId: w.shiftId, workDayValue: null }] } }),
                          "Đã xóa hệ số riêng — dùng hệ số của ca",
                          weights.reload,
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate-500 sm:px-5">Chưa có hệ số riêng — mọi phòng dùng hệ số chung của ca.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Ngày lễ" />
          <form
            className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:px-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api("/api/holidays", { body: holiday }), "Đã thêm ngày lễ", () => (setHoliday({ date: "", name: "" }), holidays.reload()));
            }}
          >
            <input type="date" className="input sm:w-44" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} required aria-label="Ngày lễ" />
            <input className="input" placeholder="Tên ngày lễ" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} required minLength={2} />
            <Button type="submit" icon="plus" loading={busy}>
              Thêm
            </Button>
          </form>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {holidays.data?.holidays.map((h) => (
              <li key={h.date} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="w-24 shrink-0 font-semibold text-slate-800 tabular-nums">{fmtDay(h.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                  {h.name} · {WEEKDAY_LONG[weekdayOf(h.date)]}
                </span>
                <IconButton icon="trash" label="Xóa ngày lễ" className="text-rose-600" onClick={() => run(() => api(`/api/holidays/${h.date}`, { method: "DELETE" }), "Đã xóa", holidays.reload)} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Phòng ban & quản lý" />
          <ul className="divide-y divide-slate-100">
            {depts.data?.departments.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.employeeCount} nhân viên</p>
                </div>
                <Select
                  className="sm:w-64"
                  aria-label={`Quản lý phòng ${d.name}`}
                  value={d.managerId ?? ""}
                  onChange={(e) => run(() => api(`/api/departments/${d.id}`, { method: "PATCH", body: { managerId: e.target.value ? Number(e.target.value) : null } }), "Đã cập nhật quản lý", depts.reload)}
                >
                  <option value="">— Chưa có quản lý (đơn chuyển ADMIN) —</option>
                  {emps.data?.employees
                    .filter((e) => e.departmentId === d.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} — {e.name}
                      </option>
                    ))}
                </Select>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2 border-t border-slate-100 p-4 sm:px-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api("/api/departments", { body: { name: newDept } }), "Đã thêm phòng ban", () => (setNewDept(""), depts.reload()));
            }}
          >
            <input className="input" placeholder="Tên phòng ban mới" value={newDept} onChange={(e) => setNewDept(e.target.value)} minLength={2} required />
            <Button type="submit" icon="plus" loading={busy}>
              Thêm
            </Button>
          </form>
        </Card>
            <Card>
              <CardHeader
                title="Mẫu tuần làm việc (nhóm ca cố định)"
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="plus"
                    onClick={() => setPatternForm({ name: "", monShiftId: null, tueShiftId: null, wedShiftId: null, thuShiftId: null, friShiftId: null, satShiftId: null, sunShiftId: null })}
                  >
                    Thêm mẫu
                  </Button>
                }
              />
              <ul className="divide-y divide-slate-100">
                {patterns.data?.patterns.map((pt) => (
                  <li key={pt.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">
                        {pt.name} <span className="text-xs font-normal text-slate-500">· {pt.employeeCount ?? 0} nhân viên</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-1 text-xs">
                        {DAY_KEYS.map((k, i) => {
                          const sh = shifts.data?.shifts.find((x) => x.id === pt[k]);
                          return (
                            <span key={k} className={sh ? "rounded bg-brand-50 px-1.5 py-0.5 text-brand-800" : "rounded bg-slate-100 px-1.5 py-0.5 text-slate-400"}>
                              {DAY_LABEL[i]} {sh ? `${sh.startTime}–${sh.endTime}` : "nghỉ"}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                    <IconButton icon="edit" label="Sửa mẫu" onClick={() => setPatternForm(pt)} />
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>

      <Modal
        open={!!patternForm}
        onClose={() => setPatternForm(null)}
        title={patternForm?.id ? "Sửa mẫu tuần" : "Thêm mẫu tuần"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPatternForm(null)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                if (!patternForm) return;
                const { id, employeeCount: _n, ...body } = patternForm;
                void _n;
                void run(() => api(id ? `/api/work-patterns/${id}` : "/api/work-patterns", { method: id ? "PATCH" : "POST", body }), "Đã lưu mẫu tuần", () => (setPatternForm(null), patterns.reload()));
              }}
            >
              Lưu mẫu
            </Button>
          </>
        }
      >
        {patternForm && (
          <div className="space-y-3">
            {patternForm.id && (patternForm.employeeCount ?? 0) > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Mẫu đang áp dụng cho {patternForm.employeeCount} nhân viên — thay đổi ảnh hưởng cách tính công từ nay và được gửi vào nhóm Zalo.</p>
            )}
            <Field label="Tên mẫu">{(id) => <input id={id} className="input" value={patternForm.name} onChange={(e) => setPatternForm({ ...patternForm, name: e.target.value })} placeholder="VD: HC T2–T6 + T7 sáng" />}</Field>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DAY_KEYS.map((k, i) => (
                <Field key={k} label={DAY_LABEL[i]}>
                  {(id) => (
                    <Select id={id} value={patternForm[k] ?? ""} onChange={(e) => setPatternForm({ ...patternForm, [k]: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Nghỉ</option>
                      {shifts.data?.shifts.map((sh) => (
                        <option key={sh.id} value={sh.id}>
                          {sh.name} {sh.startTime}–{sh.endTime}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!weightForm}
        onClose={() => setWeightForm(null)}
        title="Hệ số công theo phòng"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWeightForm(null)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={!weightForm?.departmentId || !weightForm?.shiftId || weightForm.value === ""}
              onClick={() => {
                if (!weightForm) return;
                const body = { weights: [{ departmentId: Number(weightForm.departmentId), shiftId: Number(weightForm.shiftId), workDayValue: Number(weightForm.value) }] };
                void run(() => api("/api/shift-weights", { method: "PUT", body }), "Đã lưu hệ số công", () => (setWeightForm(null), weights.reload()));
              }}
            >
              Lưu
            </Button>
          </>
        }
      >
        {weightForm && (
          <div className="grid gap-3">
            <Field label="Phòng ban">
              {(id) => (
                <Select id={id} value={weightForm.departmentId} onChange={(e) => setWeightForm({ ...weightForm, departmentId: e.target.value })}>
                  <option value="">— Chọn phòng —</option>
                  {depts.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Ca">
              {(id) => (
                <Select id={id} value={weightForm.shiftId} onChange={(e) => setWeightForm({ ...weightForm, shiftId: e.target.value })}>
                  <option value="">— Chọn ca —</option>
                  {shifts.data?.shifts.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name} {sh.startTime}–{sh.endTime} (chung {sh.workDayValue})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Hệ số công của phòng" hint="Bội số 0.25, từ 0 đến 3">
              {(id) => <input id={id} type="number" step="0.25" min="0" max="3" className="input" value={weightForm.value} onChange={(e) => setWeightForm({ ...weightForm, value: e.target.value })} />}
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!shiftForm}
        onClose={() => setShiftForm(null)}
        title={shiftForm?.id ? "Sửa ca" : "Thêm ca"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShiftForm(null)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                if (!shiftForm) return;
                const { id, ...body } = shiftForm;
                void run(() => api(id ? `/api/shifts/${id}` : "/api/shifts", { method: id ? "PATCH" : "POST", body }), "Đã lưu ca", () => (setShiftForm(null), shifts.reload()));
              }}
            >
              Lưu ca
            </Button>
          </>
        }
      >
        {shiftForm && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tên ca" className="col-span-2">
              {(id) => <input id={id} className="input" value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} />}
            </Field>
            <Field label="Bắt đầu">{(id) => <input id={id} type="time" className="input" value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} />}</Field>
            <Field label="Kết thúc" hint={shiftForm.endTime <= shiftForm.startTime ? "Ca qua đêm" : undefined}>
              {(id) => <input id={id} type="time" className="input" value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} />}
            </Field>
            <Field label="Nghỉ giữa ca (phút)">
              {(id) => <input id={id} type="number" className="input" value={shiftForm.breakMinutes} onChange={(e) => setShiftForm({ ...shiftForm, breakMinutes: Number(e.target.value) })} />}
            </Field>
            <Field label="Giờ bắt đầu nghỉ" hint="Để trống: luôn trừ đủ giờ nghỉ">
              {(id) => <input id={id} type="time" className="input" value={shiftForm.breakStart ?? ""} onChange={(e) => setShiftForm({ ...shiftForm, breakStart: e.target.value || null })} />}
            </Field>
            <Field label="Hệ số công" hint="1 = một công; 0.5 = nửa công">
              {(id) => (
                <input id={id} type="number" step="0.25" min="0" max="3" className="input" value={shiftForm.workDayValue} onChange={(e) => setShiftForm({ ...shiftForm, workDayValue: Number(e.target.value) })} />
              )}
            </Field>
            <Field label="Ân hạn trễ (phút)">
              {(id) => <input id={id} type="number" className="input" value={shiftForm.graceLateMinutes} onChange={(e) => setShiftForm({ ...shiftForm, graceLateMinutes: Number(e.target.value) })} />}
            </Field>
            <Field label="Ân hạn về sớm (phút)">
              {(id) => <input id={id} type="number" className="input" value={shiftForm.graceEarlyMinutes} onChange={(e) => setShiftForm({ ...shiftForm, graceEarlyMinutes: Number(e.target.value) })} />}
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
