"use client";
import Link from "next/link";
import { useState } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select } from "@/components/ui";
import { DeptSelect, useDepartments } from "@/components/dept-select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";

type Emp = {
  id: number;
  code: string;
  name: string;
  phone?: string;
  role: string;
  active: boolean;
  departmentId: number;
  department: { name: string };
  defaultShiftId: number;
  defaultShift: { name: string; startTime: string; endTime: string };
  zaloLinked: boolean;
  zaloLinkedAt: string | null;
  biometricConsentAt: string | null;
  lockedUntil: string | null;
  faceCount: number;
  faceStatus: "ENROLLED" | "REENROLL" | "NONE";
  hasSchedules: boolean;
};
type Shift = { id: number; name: string; startTime: string; endTime: string };
type Form = { id?: number; code: string; name: string; phone: string; role: string; departmentId: string; defaultShiftId: string; active: boolean };

const ROLE: Record<string, string> = { ADMIN: "Quản trị", MANAGER: "Quản lý", EMPLOYEE: "Nhân viên" };

function FaceBadge({ e }: { e: Emp }) {
  if (e.faceStatus === "ENROLLED") return <Badge tone="ontime">Đã có khuôn mặt</Badge>;
  if (e.faceStatus === "REENROLL") return <Badge tone="late">Cần enroll lại</Badge>;
  return <Badge tone="neutral">Chưa có khuôn mặt</Badge>;
}

export default function EmployeesPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [inactive, setInactive] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi<{ employees: Emp[] }>(`/api/employees${qs({ q, departmentId: dept, includeInactive: inactive ? 1 : "" })}`);
  const depts = useDepartments();
  const shifts = useApi<{ shifts: Shift[] }>("/api/shifts");

  function openCreate() {
    setForm({ code: "", name: "", phone: "", role: "EMPLOYEE", departmentId: String(depts.data?.departments[0]?.id ?? ""), defaultShiftId: String(shifts.data?.shifts[0]?.id ?? ""), active: true });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const body = { name: form.name, phone: form.phone, role: form.role, departmentId: Number(form.departmentId), defaultShiftId: Number(form.defaultShiftId) };
      if (form.id) {
        await api(`/api/employees/${form.id}`, { method: "PATCH", body: { ...body, active: form.active } });
        toast.success("Đã lưu thông tin nhân viên");
      } else {
        await api("/api/employees", { body: { ...body, code: form.code } });
        toast.success("Đã tạo nhân viên — mật khẩu mặc định 123456");
      }
      setForm(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(id: number, body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      await api(`/api/employees/${id}`, { method: "PATCH", body });
      toast.success(msg);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteFaces(id: number) {
    if (!confirm("Xóa toàn bộ mẫu khuôn mặt của nhân viên này? Nhân viên sẽ chuyển sang chấm công thủ công.")) return;
    try {
      await api(`/api/employees/${id}/faces`, { method: "DELETE" });
      toast.success("Đã xóa mẫu khuôn mặt");
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const list = data?.employees ?? [];
  const current = form?.id ? list.find((e) => e.id === form.id) : null;

  return (
    <>
      <PageHeader
        title="Nhân viên"
        subtitle={data ? `${list.length} nhân viên · ${list.filter((e) => e.faceStatus === "ENROLLED").length} đã enroll · ${list.filter((e) => e.zaloLinked).length} đã liên kết Zalo` : undefined}
        actions={
          <Button icon="plus" onClick={openCreate}>
            Thêm nhân viên
          </Button>
        }
      />
      <Card className="mb-3 grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Tìm theo tên, mã, số điện thoại…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm nhân viên" />
        </div>
        <DeptSelect value={dept} onChange={setDept} className="sm:w-52" />
        <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">
          <input type="checkbox" className="size-4 accent-brand-700" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Hiện đã nghỉ việc
        </label>
      </Card>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !list.length ? (
        <Card>
          <EmptyState icon="users" title="Không tìm thấy nhân viên" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <Card key={e.id} className={`flex flex-col p-4 ${e.active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <Avatar name={e.name} className="size-11" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{e.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {e.code} · {ROLE[e.role]} · {e.department.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {e.defaultShift.name} {e.defaultShift.startTime}–{e.defaultShift.endTime}
                    {e.hasSchedules && " · xoay ca"}
                    {e.phone && ` · ${e.phone}`}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <FaceBadge e={e} />
                {e.zaloLinked ? <Badge tone="brand">Zalo ✓</Badge> : <Badge tone="neutral">Chưa liên kết Zalo</Badge>}
                {!e.active && <Badge tone="absent">Đã nghỉ việc</Badge>}
                {e.lockedUntil && new Date(e.lockedUntil) > new Date() && <Badge tone="absent">Đang khóa đăng nhập</Badge>}
              </div>
              <div className="mt-auto flex gap-2 pt-3">
                {e.active && (
                  <Link href={`/admin/employees/${e.id}/enroll`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-50 text-sm font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100">
                    <Icon name="face" className="size-4" /> {e.faceStatus === "ENROLLED" ? "Enroll lại" : "Enroll khuôn mặt"}
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  icon="edit"
                  onClick={() =>
                    setForm({ id: e.id, code: e.code, name: e.name, phone: e.phone ?? "", role: e.role, departmentId: String(e.departmentId), defaultShiftId: String(e.defaultShiftId), active: e.active })
                  }
                >
                  Sửa
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? `Sửa ${form.code}` : "Thêm nhân viên"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={save}>
              Lưu
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            {!form.id && (
              <Field label="Mã nhân viên">
                {(id) => <input id={id} className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="NV016" />}
              </Field>
            )}
            <Field label="Họ tên" className={form.id ? "sm:col-span-2" : ""}>
              {(id) => <input id={id} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <Field label="Số điện thoại">{(id) => <input id={id} className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
            <Field label="Vai trò">
              {(id) => (
                <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {Object.entries(ROLE).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Phòng ban">
              {(id) => (
                <Select id={id} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  {depts.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Ca mặc định">
              {(id) => (
                <Select id={id} value={form.defaultShiftId} onChange={(e) => setForm({ ...form, defaultShiftId: e.target.value })}>
                  {shifts.data?.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.startTime}–{s.endTime}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {form.id && current && (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" className="size-4 accent-brand-700" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Đang làm việc (bỏ chọn = nghỉ việc, dữ liệu khuôn mặt sẽ bị xóa)
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="secondary" icon="key" disabled={busy} onClick={() => action(current.id, { resetPassword: true }, "Đã đặt lại mật khẩu về 123456")}>
                    Đặt lại mật khẩu
                  </Button>
                  {current.zaloLinked && (
                    <Button size="sm" variant="secondary" icon="zalo" disabled={busy} onClick={() => action(current.id, { unlinkZalo: true }, "Đã hủy liên kết Zalo")}>
                      Hủy liên kết Zalo
                    </Button>
                  )}
                  {current.faceCount > 0 && (
                    <Button size="sm" variant="secondary" icon="trash" className="text-rose-700" onClick={() => deleteFaces(current.id)}>
                      Xóa mẫu khuôn mặt
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
