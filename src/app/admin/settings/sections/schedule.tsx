"use client";
/** Cấu hình → tab "Ca & lịch": ca làm việc, mẫu tuần, ngày lễ, hệ số công riêng của phòng. */
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { fmtDay, weekdayOf, WEEKDAY_LONG } from "@/lib/client/format";
import { Badge, Button, Card, CardHeader, Field, IconButton, Modal, Select } from "@/components/ui";
import { useDepartments } from "@/components/dept-select";
import { DAY_KEYS, DAY_LABEL, type Holiday, type Pattern, type SectionProps, type Shift, type Weight } from "./shared";

export function ScheduleSection({ busy, run, confirm }: SectionProps) {
  const shifts = useApi<{ shifts: Shift[] }>("/api/shifts");
  const patterns = useApi<{ patterns: Pattern[] }>("/api/work-patterns");
  const holidays = useApi<{ holidays: Holiday[] }>("/api/holidays");
  const weights = useApi<{ weights: Weight[] }>("/api/shift-weights");
  const depts = useDepartments();
  const [shiftForm, setShiftForm] = useState<(Omit<Shift, "id"> & { id?: number }) | null>(null);
  const [patternForm, setPatternForm] = useState<Pattern | null>(null);
  const [holiday, setHoliday] = useState<Holiday>({ date: "", name: "" });
  const [holidayForm, setHolidayForm] = useState<{ orig: string; date: string; name: string } | null>(null);
  const [weightForm, setWeightForm] = useState<{ departmentId: string; shiftId: string; value: string } | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Ca làm việc"
          actions={
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={() => setShiftForm({ name: "", startTime: "08:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5, graceEarlyMinutes: 0, breakStart: "12:00", workDayValue: 1 })}
            >
              Thêm ca
            </Button>
          }
        />
        <ul className="divide-y divide-slate-100">
          {shifts.data?.shifts.map((sh) => (
            <li key={sh.id} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
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
                  confirm({
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
        <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">
          Mỗi nhân viên ca cố định theo đúng một mẫu ở đây (chọn trong hồ sơ nhân viên) — mẫu quyết định ca từng ngày. Nhân viên xoay ca không dùng mẫu, xếp ca hằng tuần.
        </p>
        <ul className="divide-y divide-slate-100">
          {patterns.data?.patterns.map((pt) => (
            <li key={pt.id} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
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
                  confirm({
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

      <Card>
        <CardHeader title="Ngày lễ" />
        <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">Ngày lễ là ngày nghỉ hưởng công cho người có lịch làm việc; chỉ ảnh hưởng tháng chưa chốt công.</p>
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {holidays.data?.holidays.map((h) => (
            <li key={h.date} className="flex items-center gap-2 px-4 py-2 sm:px-5">
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
                  confirm({
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
          {holidays.data && !holidays.data.holidays.length && <li className="px-4 py-3 text-sm text-slate-500 sm:px-5">Chưa có ngày lễ nào trong danh sách.</li>}
        </ul>
        <form
          className="flex flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row sm:px-5"
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
        <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">Ghi đè hệ số công của ca cho riêng một phòng (vd. Hành chính: Sáng thứ Bảy = 0.5). Phòng không đặt riêng thì dùng hệ số của ca. Thay đổi áp dụng cho các tháng chưa chốt công.</p>
        {weights.data?.weights.length ? (
          <ul className="divide-y divide-slate-100">
            {weights.data.weights.map((w) => {
              const sh = shifts.data?.shifts.find((x) => x.id === w.shiftId);
              const d = depts.data?.departments.find((x) => x.id === w.departmentId);
              return (
                <li key={`${w.departmentId}-${w.shiftId}`} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">{d?.name ?? `Phòng #${w.departmentId}`}</p>
                    <p className="text-xs text-slate-500">
                      {sh?.name ?? `Ca #${w.shiftId}`} · chung {sh?.workDayValue ?? 1} → <span className="font-semibold text-slate-700">{w.workDayValue} công</span>
                    </p>
                  </div>
                  <IconButton icon="edit" label="Sửa hệ số" onClick={() => setWeightForm({ departmentId: String(w.departmentId), shiftId: String(w.shiftId), value: String(w.workDayValue) })} />
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
                <input
                  id={id}
                  type="number"
                  step="0.25"
                  min="0"
                  max="3"
                  className="input"
                  value={shiftForm.workDayValue}
                  onChange={(e) => setShiftForm({ ...shiftForm, workDayValue: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })}
                />
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
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Mẫu đang áp dụng cho {patternForm.employeeCount} nhân viên — thay đổi ảnh hưởng cách tính công từ nay và được gửi vào nhóm Zalo.
              </p>
            )}
            <Field label="Tên mẫu">
              {(id) => <input id={id} className="input" value={patternForm.name} onChange={(e) => setPatternForm({ ...patternForm, name: e.target.value })} placeholder="VD: HC T2–T6 + T7 sáng" />}
            </Field>
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
                Đổi ngày: {fmtDay(holidayForm.orig)} trở lại thành ngày làm việc bình thường (có thể phát sinh vắng nếu không ai chấm công), còn{" "}
                {holidayForm.date ? fmtDay(holidayForm.date) : "ngày mới"} thành nghỉ lễ. Chỉ ảnh hưởng tháng chưa chốt công.
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
    </div>
  );
}
