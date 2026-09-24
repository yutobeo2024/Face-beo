"use client";
/** Cấu hình → tab "Tổ chức": phòng ban & quản lý, chức danh & chuyên khoa. */
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Button, Card, CardHeader, Field, IconButton, Modal, Select } from "@/components/ui";
import { useDepartments } from "@/components/dept-select";
import { useAdminUser } from "../../admin-nav";
import { APPROVAL_MODES, APPROVAL_MODE_LABEL } from "@/lib/roles";
import type { ConfirmFn, RunFn, SectionProps } from "./shared";

export function OrgSection({ busy, run, confirm }: SectionProps) {
  const me = useAdminUser();
  const depts = useDepartments();
  const emps = useApi<{ employees: { id: number; code: string; name: string; departmentId: number }[] }>("/api/employees");
  const [newDept, setNewDept] = useState("");
  const [deptForm, setDeptForm] = useState<{ id: number; name: string } | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Phòng ban & quản lý" />
        <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">Quản lý phòng thấy và duyệt đơn cho phòng mình. Phòng chưa có quản lý thì đơn chuyển thẳng cho Nhân sự.</p>
        <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
          {depts.data?.departments.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {d.employeeCount} nhân viên
                  {d.totalEmployeeCount > d.employeeCount && <span> · {d.totalEmployeeCount - d.employeeCount} đã nghỉ việc</span>}
                </p>
              </div>
              <div className="flex shrink-0 sm:order-last">
                <IconButton icon="edit" label="Đổi tên phòng" onClick={() => setDeptForm({ id: d.id, name: d.name })} />
                <IconButton
                  icon="trash"
                  label={d.totalEmployeeCount > 0 ? "Phòng còn nhân viên (kể cả đã nghỉ) — không xóa được" : "Xóa phòng ban"}
                  className="text-rose-600 hover:bg-rose-50"
                  disabled={d.totalEmployeeCount > 0}
                  onClick={() =>
                    confirm({
                      title: "Xóa phòng ban",
                      body: `Xóa phòng "${d.name}"? Chỉ xóa được phòng trống hoàn toàn (không nhân viên kể cả đã nghỉ, không tuần đã đăng ký, không ngày đã chốt công). Hệ số công riêng của phòng sẽ bị xóa; liên kết "Thông tin" đang giới hạn theo phòng này sẽ được gỡ phòng (và tạm ẩn nếu không còn phòng nào).`,
                      ok: "Đã xóa phòng ban",
                      fn: () => api(`/api/departments/${d.id}`, { method: "DELETE" }),
                      after: depts.reload, // hệ số công riêng của phòng bị xóa theo ở máy chủ; danh sách đó nằm ở tab Ca & lịch, mở lại là tải mới
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:w-72">
                <Select
                  aria-label={`Quản lý phòng ${d.name}`}
                  value={d.managerId ?? ""}
                  onChange={(e) => run(() => api(`/api/departments/${d.id}`, { method: "PATCH", body: { managerId: e.target.value ? Number(e.target.value) : null } }), "Đã cập nhật quản lý", depts.reload)}
                >
                  <option value="">— Chưa có quản lý (đơn chuyển Nhân sự) —</option>
                  {emps.data?.employees
                    .filter((e) => e.departmentId === d.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} — {e.name}
                      </option>
                    ))}
                </Select>
                {/* Cách duyệt đơn của Nhân viên trong phòng (chỉ có ý nghĩa khi phòng có quản lý). */}
                <Select
                  aria-label={`Cách duyệt đơn phòng ${d.name}`}
                  title="Cách duyệt đơn của nhân viên trong phòng (áp dụng khi phòng có quản lý)"
                  disabled={!d.managerId}
                  value={d.approvalMode ?? "MANAGER_OR_HR"}
                  onChange={(e) => run(() => api(`/api/departments/${d.id}`, { method: "PATCH", body: { approvalMode: e.target.value } }), "Đã đổi cách duyệt đơn", depts.reload)}
                >
                  {APPROVAL_MODES.map((m) => (
                    <option key={m} value={m}>
                      Duyệt đơn: {APPROVAL_MODE_LABEL[m]}
                    </option>
                  ))}
                </Select>
                {me.role === "ADMIN" && (
                  <label className="flex items-center gap-2 text-xs text-slate-600" title="Không cảnh báo / Zalo trễ, vắng, quên chấm; ẩn khỏi chấm công, báo cáo, xếp ca">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-700"
                      checked={!!d.attendanceExempt}
                      disabled={busy}
                      onChange={(e) =>
                        run(
                          () => api(`/api/departments/${d.id}`, { method: "PATCH", body: { attendanceExempt: e.target.checked } }),
                          e.target.checked ? "Cả phòng không chấm công" : "Đã bật lại chấm công",
                          depts.reload,
                        )
                      }
                    />
                    Không chấm công (cả phòng — vd. Ban Giám đốc)
                  </label>
                )}
              </div>
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
        <CardHeader title="Chức danh & chuyên khoa" />
        <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">
          Chỉ để mô tả nhân viên (vd. Bác sĩ · Tai Mũi Họng), lọc danh sách và thêm cột trong Excel — không ảnh hưởng phân quyền hay duyệt đơn. Tích <b>GPHN</b> cho chức danh bắt buộc Giấy phép hành nghề.
        </p>
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:px-5">
          <CatalogList title="Chức danh" url="/api/job-titles" placeholder="VD: Kỹ thuật viên" busy={busy} run={run} confirm={confirm} licenseFlag />
          <CatalogList title="Chuyên khoa / chuyên môn" url="/api/specialties" placeholder="VD: Tai Mũi Họng" busy={busy} run={run} confirm={confirm} />
        </div>
      </Card>

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
              onClick={() =>
                deptForm && run(() => api(`/api/departments/${deptForm.id}`, { method: "PATCH", body: { name: deptForm.name.trim() } }), "Đã đổi tên phòng ban", () => (setDeptForm(null), depts.reload()))
              }
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
    </div>
  );
}

function CatalogList({
  title,
  url,
  placeholder,
  busy,
  run,
  confirm,
  licenseFlag,
}: {
  title: string;
  url: string;
  placeholder: string;
  licenseFlag?: boolean;
  busy: boolean;
  run: RunFn;
  confirm: ConfirmFn;
}) {
  const list = useApi<{ items: { id: number; name: string; employeeCount: number; requiresLicense?: boolean }[] }>(url);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-slate-700">{title}</p>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 text-sm">
        {list.data?.items.map((it) => (
          <li key={it.id} className="flex items-center gap-1 px-2 py-1.5">
            {editing?.id === it.id ? (
              <form
                className="flex flex-1 gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api(`${url}/${it.id}`, { method: "PATCH", body: { name: editing.name } }), "Đã đổi tên", () => (setEditing(null), list.reload()));
                }}
              >
                <input className="input h-9 flex-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} minLength={2} required autoFocus />
                <Button size="sm" type="submit" loading={busy}>
                  Lưu
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-slate-800">{it.name}</span>
                {licenseFlag && (
                  <label className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-600" title="Chức danh bắt buộc Giấy phép hành nghề — thiếu GPHN sẽ bị cảnh báo">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-brand-700"
                      checked={!!it.requiresLicense}
                      disabled={busy}
                      onChange={(e) => void run(() => api(`${url}/${it.id}`, { method: "PATCH", body: { requiresLicense: e.target.checked } }), "Đã lưu", list.reload)}
                    />
                    GPHN
                  </label>
                )}
                <span className="shrink-0 text-xs text-slate-400">{it.employeeCount} NV</span>
                <IconButton icon="edit" label={`Đổi tên ${it.name}`} onClick={() => setEditing({ id: it.id, name: it.name })} />
                <IconButton
                  icon="trash"
                  label={`Xóa ${it.name}`}
                  className="text-rose-600 hover:bg-rose-50"
                  onClick={() =>
                    confirm({
                      title: `Xóa "${it.name}"`,
                      body: it.employeeCount ? `${it.employeeCount} nhân viên đang có "${it.name}" sẽ được để trống mục này. Tiếp tục?` : `Xóa "${it.name}"?`,
                      ok: "Đã xóa",
                      fn: () => api(`${url}/${it.id}`, { method: "DELETE" }),
                      after: list.reload,
                    })
                  }
                />
              </>
            )}
          </li>
        ))}
        {list.data && !list.data.items.length && <li className="px-2 py-2 text-xs text-slate-500">Chưa có mục nào.</li>}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(url, { body: { name } }), "Đã thêm", () => (setName(""), list.reload()));
        }}
      >
        <input className="input" placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
        <Button type="submit" icon="plus" loading={busy}>
          Thêm
        </Button>
      </form>
    </div>
  );
}
