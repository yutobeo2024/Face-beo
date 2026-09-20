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
  { key: "matchThreshold", label: "Ngưỡng khớp khuôn mặt", hint: "Cosine InsightFace tối thiểu (mặc định 0.45; cùng người thường ≥ 0.5, khác người ≤ 0.35).", step: 0.01 },
  { key: "matchMargin", label: "Chênh lệch top-1/top-2", hint: "Top-1 phải hơn top-2 ít nhất (mặc định 0.08) — chống nhận nhầm người có nét giống.", step: 0.01 },
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
  const s = useApi<{ settings: Settings; zaloGroupId: string; system: { zaloSimulated: boolean; livenessServer: boolean; l2: { modelPath: string; modelExists: boolean; error: string | null }; faceModelVersion: string; face: { label: string; modelPath: string; modelExists: boolean; error: string | null } } }>(sys ? "/api/settings" : null);
  const shifts = useApi<{ shifts: Shift[] }>("/api/shifts");
  const holidays = useApi<{ holidays: Holiday[] }>("/api/holidays");
  const patterns = useApi<{ patterns: Pattern[] }>(org ? "/api/work-patterns" : null);
  const [patternForm, setPatternForm] = useState<Pattern | null>(null);
  const depts = useDepartments();
  const emps = useApi<{ employees: { id: number; code: string; name: string; departmentId: number }[] }>(org ? "/api/employees" : null);
  const [form, setForm] = useState<Settings | null>(null);
  const [shiftForm, setShiftForm] = useState<(Omit<Shift, "id"> & { id?: number }) | null>(null);
  const weights = useApi<{ weights: Weight[] }>(org ? "/api/shift-weights" : null);
  const [weightForm, setWeightForm] = useState<{ departmentId: string; shiftId: string; value: string } | null>(null);
  const [holiday, setHoliday] = useState<Holiday>({ date: "", name: "" });
  const [newDept, setNewDept] = useState("");
  const [deptForm, setDeptForm] = useState<{ id: number; name: string } | null>(null);
  const [holidayForm, setHolidayForm] = useState<{ orig: string; date: string; name: string } | null>(null);
  // Hộp xác nhận xóa dùng chung (không dùng window.confirm); server vẫn là chốt chặn cuối khi thứ cần xóa đang được dùng.
  const [confirmBox, setConfirmBox] = useState<{ title: string; body: string; ok: string; fn: () => Promise<unknown>; after: () => void } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (s.data) {
      setForm(s.data.settings);
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
        <Badge tone={s.data.system.face.modelExists && !s.data.system.face.error ? "ontime" : "absent"}>
          Nhận diện: {!s.data.system.face.modelExists ? "THIẾU mô hình — chạy npm run models:face" : s.data.system.face.error ? "lỗi" : s.data.system.face.label}
        </Badge>
        <Badge tone={!s.data.system.livenessServer ? "neutral" : s.data.system.l2.modelExists && !s.data.system.l2.error ? "ontime" : "absent"}>
          Liveness L2 server: {!s.data.system.livenessServer ? "tắt" : !s.data.system.l2.modelExists ? "bật nhưng thiếu mô hình" : s.data.system.l2.error ? "lỗi" : "bật (MiniFASNetV2)"}
        </Badge>
        <Badge tone="neutral">Mô hình: {s.data.system.faceModelVersion}</Badge>
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
              void run(() => api("/api/settings", { method: "PUT", body: form }), "Đã lưu cấu hình", s.reload);
            }}
          >
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(id) => <input id={id} type="number" step={f.step} className="input tabular-nums" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />}
              </Field>
            ))}
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy}>
                Lưu cấu hình
              </Button>
            </div>
          </form>
        </Card>
        )}
        {sys && <ZaloCard busy={busy} run={run} />}

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
                <IconButton
                  icon="trash"
                  label="Xóa ca"
                  className="text-rose-600 hover:bg-rose-50"
                  onClick={() =>
                    setConfirmBox({
                      title: "Xóa ca làm việc",
                      body: `Xóa ca "${sh.name}"? Chỉ xóa được ca chưa từng được dùng (không nhân viên, mẫu tuần, lịch tuần hay log chấm công nào tham chiếu). Ca đã dùng thì hệ thống sẽ từ chối — hãy đổi tên thành "… (ngừng dùng)" thay vì xóa.`,
                      ok: "Đã xóa ca",
                      fn: () => api(`/api/shifts/${sh.id}`, { method: "DELETE" }),
                      after: () => (shifts.reload(), weights.reload()),
                    })
                  }
                />
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
                <IconButton icon="edit" label="Sửa ngày lễ" onClick={() => setHolidayForm({ orig: h.date, date: h.date, name: h.name })} />
                <IconButton
                  icon="trash"
                  label="Xóa ngày lễ"
                  className="text-rose-600 hover:bg-rose-50"
                  onClick={() =>
                    setConfirmBox({
                      title: "Xóa ngày lễ",
                      body: `Bỏ ngày lễ ${fmtDay(h.date)} (${h.name})? Ngày này sẽ trở lại thành ngày làm việc bình thường trong các tháng chưa chốt công.`,
                      ok: "Đã xóa ngày lễ",
                      fn: () => api(`/api/holidays/${h.date}`, { method: "DELETE" }),
                      after: holidays.reload,
                    })
                  }
                />
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
                <div className="flex shrink-0 sm:order-last">
                  <IconButton icon="edit" label="Đổi tên phòng" onClick={() => setDeptForm({ id: d.id, name: d.name })} />
                  <IconButton
                    icon="trash"
                    label={d.employeeCount > 0 ? "Phòng còn nhân viên — không xóa được" : "Xóa phòng ban"}
                    className="text-rose-600 hover:bg-rose-50"
                    disabled={d.employeeCount > 0}
                    onClick={() =>
                      setConfirmBox({
                        title: "Xóa phòng ban",
                        body: `Xóa phòng "${d.name}"? Chỉ xóa được phòng trống hoàn toàn (không nhân viên kể cả đã nghỉ, không tuần đã đăng ký, không ngày đã chốt công). Hệ số công riêng của phòng sẽ bị xóa; liên kết "Thông tin" đang giới hạn theo phòng này sẽ được gỡ phòng (và tạm ẩn nếu không còn phòng nào).`,
                        ok: "Đã xóa phòng ban",
                        fn: () => api(`/api/departments/${d.id}`, { method: "DELETE" }),
                        after: () => (depts.reload(), weights.reload()),
                      })
                    }
                  />
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
                    <IconButton
                      icon="trash"
                      label={(pt.employeeCount ?? 0) > 0 ? "Mẫu đang có nhân viên dùng — không xóa được" : "Xóa mẫu"}
                      className="text-rose-600 hover:bg-rose-50"
                      disabled={(pt.employeeCount ?? 0) > 0}
                      onClick={() =>
                        setConfirmBox({
                          title: "Xóa mẫu tuần",
                          body: `Xóa mẫu "${pt.name}"? Không nhân viên đang làm nào dùng mẫu này. Người đã nghỉ việc từng dùng mẫu sẽ được gỡ liên kết; lịch sử công của họ không đổi.`,
                          ok: "Đã xóa mẫu tuần",
                          fn: () => api(`/api/work-patterns/${pt.id}`, { method: "DELETE" }),
                          after: patterns.reload,
                        })
                      }
                    />
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
        open={!!confirmBox}
        onClose={() => setConfirmBox(null)}
        title={confirmBox?.title ?? ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmBox(null)}>
              Hủy
            </Button>
            <Button variant="danger" loading={busy} onClick={() => confirmBox && run(confirmBox.fn, confirmBox.ok, () => (setConfirmBox(null), confirmBox.after()))}>
              Xóa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{confirmBox?.body}</p>
      </Modal>

      <Modal
        open={!!deptForm}
        onClose={() => setDeptForm(null)}
        title="Đổi tên phòng ban"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeptForm(null)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={!deptForm || deptForm.name.trim().length < 2}
              onClick={() => deptForm && run(() => api(`/api/departments/${deptForm.id}`, { method: "PATCH", body: { name: deptForm.name.trim() } }), "Đã đổi tên phòng ban", () => (setDeptForm(null), depts.reload()))}
            >
              Lưu
            </Button>
          </>
        }
      >
        {deptForm && (
          <Field label="Tên phòng ban" hint="Chỉ đổi nhãn hiển thị; nhân viên, lịch, phạm vi quản lý và số liệu đã chốt không đổi.">
            {(id) => <input id={id} className="input" value={deptForm.name} maxLength={80} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} />}
          </Field>
        )}
      </Modal>

      <Modal
        open={!!holidayForm}
        onClose={() => setHolidayForm(null)}
        title="Sửa ngày lễ"
        footer={
          <>
            <Button variant="secondary" onClick={() => setHolidayForm(null)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={!holidayForm || !holidayForm.date || holidayForm.name.trim().length < 2}
              onClick={() =>
                holidayForm &&
                run(
                  () => api(`/api/holidays/${holidayForm.orig}`, { method: "PATCH", body: { date: holidayForm.date, name: holidayForm.name.trim() } }),
                  "Đã sửa ngày lễ",
                  () => (setHolidayForm(null), holidays.reload()),
                )
              }
            >
              Lưu
            </Button>
          </>
        }
      >
        {holidayForm && (
          <div className="grid gap-3">
            <Field label="Ngày">{(id) => <input id={id} type="date" className="input" value={holidayForm.date} onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })} />}</Field>
            <Field label="Tên ngày lễ">{(id) => <input id={id} className="input" value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} />}</Field>
            {holidayForm.date !== holidayForm.orig && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Đổi ngày: {fmtDay(holidayForm.orig)} trở lại thành ngày làm việc bình thường (có thể phát sinh vắng nếu không ai chấm công), còn {holidayForm.date ? fmtDay(holidayForm.date) : "ngày mới"} thành nghỉ lễ. Chỉ ảnh hưởng tháng chưa chốt công.
              </p>
            )}
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
                <input id={id} type="number" step="0.25" min="0" max="3" className="input" value={shiftForm.workDayValue} onChange={(e) => setShiftForm({ ...shiftForm, workDayValue: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })} />
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

type ZaloStatus = {
  simulated: boolean;
  env: { appId: boolean; secret: boolean; refreshTokenEnv: boolean; webhookSecret: boolean; appBaseUrl: string };
  token: { exists: boolean; expiresAt: string | null; updatedAt: string | null };
  refreshError: { at: string; msg: string } | null;
  oa: { oaId: string; name: string } | null;
  oaError: string | null;
  groupId: string;
  group: { name: string; status: string; totalMember: number; link: string } | null;
  groupError: string | null;
  recent: { id: number; at: string; status: string; error: string | null; type: string; text: string }[];
};

/** Cấu hình → Zalo OA: trạng thái kết nối thật, nhóm minh bạch, gửi tin thử, 10 tin nhóm gần nhất. */
function ZaloCard({ busy, run }: { busy: boolean; run: (fn: () => Promise<unknown>, ok: string, after?: () => void) => Promise<void> }) {
  // Ô dán ID nhóm là trạng thái riêng của thẻ — chỉ lưu khi bấm "Kết nối" (server xác minh nhóm trước).
  const [groupId, setGroupId] = useState("");
  const z = useApi<ZaloStatus>("/api/settings/zalo");
  const groups = useApi<{ connected: string; groups: { groupId: string; name: string | null; status: string | null; totalMember: number | null; source: string }[] }>("/api/settings/zalo/groups");
  const [testResult, setTestResult] = useState<{ status: string; error: string | null } | null>(null);
  const connect = (id: string) =>
    run(() => api("/api/settings/zalo/groups", { body: { groupId: id } }), "Đã kết nối nhóm — kiểm tra tin xác nhận trong nhóm Zalo", () => (setGroupId(""), z.reload(), groups.reload()));
  const d = z.data;
  const tone = (ok: boolean) => (ok ? "ontime" : "late");
  return (
    <Card>
      <CardHeader title="Zalo OA — nhóm minh bạch" actions={<IconButton icon="refresh" label="Tải lại" onClick={() => (z.reload(), groups.reload())} />} />
      {!d ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={d.simulated ? "late" : "ontime"}>{d.simulated ? "MÔ PHỎNG — tin chỉ in ra console" : "Đang gửi thật"}</Badge>
            <Badge tone={tone(d.env.appId && d.env.secret)}>App ID / Secret: {d.env.appId && d.env.secret ? "có" : "thiếu"}</Badge>
            <Badge tone={tone(d.token.exists)}>Token: {d.token.exists ? `có, hết hạn ${d.token.expiresAt ? fmtDateTimeSafe(d.token.expiresAt) : "?"}` : "chưa có"}</Badge>
            <Badge tone={d.env.webhookSecret ? "ontime" : "neutral"}>Webhook secret: {d.env.webhookSecret ? "có" : "chưa (chỉ cần khi liên kết nhân viên)"}</Badge>
          </div>
          {d.refreshError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">Refresh token lỗi lúc {fmtDateTimeSafe(d.refreshError.at)}: {d.refreshError.msg}</p>}
          {!d.simulated && (
            <p className="text-sm text-slate-700">
              OA: {d.oa ? <b>{d.oa.name}</b> : <span className="text-rose-700">không gọi được API ({d.oaError})</span>}
            </p>
          )}
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-700">Nhóm nhận tin minh bạch</p>
            <p className="mb-2 text-xs text-slate-500">
              Nhóm GMF tạo trong OA Manager sẽ tự xuất hiện ở đây (qua webhook <code>create_group</code>). Chưa có webhook thì dán ID nhóm rồi bấm Kết nối.
            </p>
            {groups.data?.groups.length ? (
              <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
                {groups.data.groups.map((g) => (
                  <li key={g.groupId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">
                        {g.name || "(chưa có tên)"}{" "}
                        {g.groupId === groups.data!.connected && <Badge tone="ontime">đang kết nối</Badge>}
                        {g.status && g.status !== "enabled" && <Badge tone="absent">{g.status}</Badge>}
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {g.groupId}
                        {g.totalMember != null ? ` · ${g.totalMember} thành viên` : ""} · {g.source === "WEBHOOK" ? "dò qua webhook" : "nhập tay"}
                      </p>
                    </div>
                    {g.groupId !== groups.data!.connected && (
                      <Button size="sm" loading={busy} onClick={() => connect(g.groupId)}>
                        Kết nối
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-xs text-slate-500">Chưa dò được nhóm nào.</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input flex-1 font-mono" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="Dán ID nhóm (VD: f414c8f76fa586fbdfb4)" />
              <Button variant="secondary" loading={busy} disabled={groupId.trim().length < 4} onClick={() => connect(groupId.trim())}>
                Kết nối nhóm này
              </Button>
            </div>
          </div>
          {!d.simulated && d.groupId && (
            <p className="text-sm text-slate-700">
              Nhóm:{" "}
              {d.group ? (
                <>
                  <b>{d.group.name}</b> · {d.group.totalMember} thành viên ·{" "}
                  <Badge tone={d.group.status === "enabled" ? "ontime" : "absent"}>{d.group.status === "enabled" ? "OA gửi tin được" : `trạng thái ${d.group.status}`}</Badge>
                </>
              ) : (
                <span className="text-rose-700">không lấy được thông tin nhóm ({d.groupError})</span>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() =>
                run(
                  async () => {
                    const r = await api<{ status: string; error: string | null }>("/api/settings/zalo/test", { method: "POST" });
                    setTestResult(r);
                  },
                  "Đã gửi tin thử — xem kết quả bên dưới",
                  () => z.reload(),
                )
              }
            >
              Gửi tin thử vào nhóm
            </Button>
            {testResult && (
              <Badge tone={testResult.status === "SENT" ? "ontime" : testResult.status === "SIMULATED" ? "neutral" : "absent"}>
                {testResult.status}
                {testResult.error ? ` — ${testResult.error}` : ""}
              </Badge>
            )}
          </div>
          {d.recent.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">10 tin nhóm gần nhất</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-xs">
                {d.recent.map((r) => (
                  <li key={r.id} className="flex gap-2 px-2 py-1.5">
                    <span className="shrink-0 tabular-nums text-slate-400">{fmtDateTimeSafe(r.at)}</span>
                    <Badge tone={r.status === "SENT" ? "ontime" : r.status === "SIMULATED" ? "neutral" : "absent"}>{r.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-slate-700">{r.error ? `${r.error} · ` : ""}{r.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function fmtDateTimeSafe(iso: string) {
  try {
    return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return iso;
  }
}
