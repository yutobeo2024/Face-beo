"use client";
import Link from "next/link";
import { useState } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select } from "@/components/ui";
import { DeptSelect, useDepartments } from "@/components/dept-select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useAdminUser, useCan } from "../admin-nav";
import { ImportModal } from "./import-modal";

type Emp = {
  id: number;
  code: string;
  name: string;
  avatarUrl?: string | null;
  phone?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
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
  scheduleType: "FIXED" | "ROTATING";
  workPatternId: number | null;
  workPattern: { name: string } | null;
  jobTitleId: number | null;
  jobTitle: { name: string } | null;
  specialtyId: number | null;
  specialty: { name: string } | null;
};
type CatalogItem = { id: number; name: string };
type Shift = { id: number; name: string; startTime: string; endTime: string };
type Form = {
  id?: number;
  code: string;
  name: string;
  phone: string;
  nationalId: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  role: string;
  departmentId: string;
  defaultShiftId: string;
  active: boolean;
  scheduleType: "FIXED" | "ROTATING";
  workPatternId: string;
  jobTitleId: string;
  specialtyId: string;
};
type Pattern = { id: number; name: string; monShiftId: number | null };

const ROLE: Record<string, string> = { ADMIN: "Quản trị", HR: "Nhân sự", MANAGER: "Quản lý", EMPLOYEE: "Nhân viên" };
const PRIVILEGED = ["ADMIN", "HR"];

function FaceBadge({ e }: { e: Emp }) {
  if (e.faceStatus === "ENROLLED") return <Badge tone="ontime">Đã có khuôn mặt</Badge>;
  if (e.faceStatus === "REENROLL") return <Badge tone="late">Cần enroll lại</Badge>;
  return <Badge tone="neutral">Chưa có khuôn mặt</Badge>;
}

export default function EmployeesPage() {
  const toast = useToast();
  const can = useCan();
  const me = useAdminUser();
  const manage = can("employees.manage");
  const enroll = can("faces.enroll");
  const privileged = can("roles.assignPrivileged");
  // Chỉ Quản trị sửa được tài khoản Nhân sự / Quản trị (luật chống leo thang quyền, server cũng kiểm tra lại).
  const canEdit = (e: { id: number; role: string }) => manage && (privileged || !PRIVILEGED.includes(e.role) || e.id === me.id);
  const roleOptions = Object.entries(ROLE).filter(([v]) => privileged || !PRIVILEGED.includes(v));
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [inactive, setInactive] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Emp | null>(null);
  const [importing, setImporting] = useState(false);
  const [photo, setPhoto] = useState<Emp | null>(null);
  // Thông tin cá nhân (SĐT, CCCD, ngày sinh, giới tính, địa chỉ): chỉ Nhân sự / Quản trị, hoặc chính mình.
  const showPersonal = (id?: number) => me.role === "ADMIN" || me.role === "HR" || id === me.id;
  const { data, error, loading, reload } = useApi<{ employees: Emp[] }>(`/api/employees${qs({ q, departmentId: dept, jobTitleId: jobTitle, specialtyId: specialty, includeInactive: inactive ? 1 : "" })}`);
  const depts = useDepartments();
  const shifts = useApi<{ shifts: Shift[] }>("/api/shifts");
  const patterns = useApi<{ patterns: Pattern[] }>("/api/work-patterns");
  const jobTitles = useApi<{ items: CatalogItem[] }>("/api/job-titles");
  const specialties = useApi<{ items: CatalogItem[] }>("/api/specialties");
  // Hồ sơ hành nghề (GPHN, chứng chỉ, CME): chỉ Nhân sự / Quản trị — huy hiệu ⚠ cho người có cảnh báo.
  const hr = me.role === "ADMIN" || me.role === "HR";
  const credAlerts = useApi<{ items: { id: number; issues: { text: string }[] }[] }>(hr ? "/api/credentials/alerts" : null);
  const alertOf = new Map((credAlerts.data?.items ?? []).map((a) => [a.id, a.issues]));

  function openCreate() {
    setForm({ code: "", name: "", phone: "", nationalId: "", dateOfBirth: "", gender: "", address: "", role: "EMPLOYEE", departmentId: String(depts.data?.departments[0]?.id ?? ""), defaultShiftId: String(shifts.data?.shifts[0]?.id ?? ""), active: true, scheduleType: "FIXED", workPatternId: String(patterns.data?.patterns.find((p) => p.monShiftId === shifts.data?.shifts[0]?.id)?.id ?? ""), jobTitleId: "", specialtyId: "" });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const body = {
        name: form.name,
        // Ô trống => null (xóa giá trị); server kiểm định dạng khi có. Chỉ gửi khi người sửa được xem các ô này.
        ...(showPersonal(form.id)
          ? { phone: form.phone.trim() || null, nationalId: form.nationalId.trim() || null, dateOfBirth: form.dateOfBirth || null, gender: form.gender || null, address: form.address.trim() || null }
          : {}),
        role: form.role,
        departmentId: Number(form.departmentId),
        defaultShiftId: Number(form.defaultShiftId),
        scheduleType: form.scheduleType,
        workPatternId: form.scheduleType === "FIXED" && form.workPatternId ? Number(form.workPatternId) : null,
        jobTitleId: form.jobTitleId ? Number(form.jobTitleId) : null,
        specialtyId: form.specialtyId ? Number(form.specialtyId) : null,
      };
      if (form.id) {
        await api(`/api/employees/${form.id}`, { method: "PATCH", body: { ...body, active: form.active } });
        toast.success("Đã lưu thông tin nhân viên");
      } else {
        const r = await api<{ tempPassword?: string }>("/api/employees", { body: { ...body, code: form.code } });
        if (r.tempPassword) setTempPw(r.tempPassword);
        else toast.success("Đã tạo nhân viên");
      }
      setForm(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEmployee(id: number) {
    setBusy(true);
    try {
      await api(`/api/employees/${id}`, { method: "DELETE" });
      toast.success("Đã xóa tài khoản");
      setDeleting(null);
      setForm(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message); // server nêu rõ lý do (đã có log chấm công, đơn từ…)
    } finally {
      setBusy(false);
    }
  }

  async function action(id: number, body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      const r = await api<{ tempPassword?: string }>(`/api/employees/${id}`, { method: "PATCH", body });
      if (r.tempPassword) setTempPw(r.tempPassword);
      else toast.success(msg);
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
          manage && (
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/employees/import/template"
                download
                className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Icon name="download" className="size-4" /> Tải file mẫu
              </a>
              <Button variant="secondary" icon="file" onClick={() => setImporting(true)}>
                Nhập từ Excel
              </Button>
            <Button icon="plus" onClick={openCreate}>
              Thêm nhân viên
            </Button>
            </div>
          )
        }
      />
      <Card className="mb-3 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Tìm theo tên, mã, số điện thoại…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm nhân viên" />
        </div>
        <DeptSelect value={dept} onChange={setDept} className="lg:w-48" />
        {!!jobTitles.data?.items.length && (
          <Select className="lg:w-40" aria-label="Lọc theo chức danh" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}>
            <option value="">Mọi chức danh</option>
            {jobTitles.data.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
        {!!specialties.data?.items.length && (
          <Select className="lg:w-44" aria-label="Lọc theo chuyên khoa" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="">Mọi chuyên khoa</option>
            {specialties.data.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
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
                {e.avatarUrl ? (
                  <button type="button" title="Xem ảnh lớn" onClick={() => setPhoto(e)} className="shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-brand-500">
                    <Avatar name={e.name} src={e.avatarUrl} className="size-14 ring-2 ring-emerald-200" />
                  </button>
                ) : (
                  <Avatar name={e.name} className="size-14" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{e.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {e.code} · {ROLE[e.role]} · {e.department.name}
                  </p>
                  {(e.jobTitle || e.specialty) && (
                    <p className="truncate text-xs font-medium text-brand-800">{[e.jobTitle?.name, e.specialty?.name].filter(Boolean).join(" · ")}</p>
                  )}
                  <p className="truncate text-xs text-slate-500">
                    {e.scheduleType === "ROTATING" ? `Xoay ca · mặc định ${e.defaultShift.name}` : `Cố định · ${e.workPattern?.name ?? `${e.defaultShift.name} ${e.defaultShift.startTime}–${e.defaultShift.endTime}`}`}
                    {e.phone && ` · ${e.phone}`}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <FaceBadge e={e} />
                {e.zaloLinked ? <Badge tone="brand">Zalo ✓</Badge> : <Badge tone="neutral">Chưa liên kết Zalo</Badge>}
                {!e.active && <Badge tone="absent">Đã nghỉ việc</Badge>}
                {e.lockedUntil && new Date(e.lockedUntil) > new Date() && <Badge tone="absent">Đang khóa đăng nhập</Badge>}
                {alertOf.has(e.id) && (
                  <span title={alertOf.get(e.id)!.map((i) => i.text).join(" · ")}>
                    <Badge tone="late">⚠ Hồ sơ hành nghề</Badge>
                  </span>
                )}
              </div>
              <div className="mt-auto flex gap-2 pt-3">
                {e.active && enroll && (
                  <Link href={`/admin/employees/${e.id}/enroll`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-50 text-sm font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100">
                    <Icon name="face" className="size-4" /> {e.faceStatus === "ENROLLED" ? "Enroll lại" : "Enroll khuôn mặt"}
                  </Link>
                )}
                {hr && (
                  <Link
                    href={`/admin/employees/${e.id}/credentials`}
                    title="Hồ sơ hành nghề: GPHN, văn bằng, chứng chỉ, CME"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    <Icon name="briefcase" className="size-4" /> Hành nghề
                  </Link>
                )}
                {canEdit(e) && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="edit"
                  onClick={() =>
                    setForm({
                      id: e.id,
                      code: e.code,
                      name: e.name,
                      phone: e.phone ?? "",
                      nationalId: e.nationalId ?? "",
                      dateOfBirth: e.dateOfBirth ?? "",
                      gender: e.gender ?? "",
                      address: e.address ?? "",
                      role: e.role,
                      departmentId: String(e.departmentId),
                      defaultShiftId: String(e.defaultShiftId),
                      active: e.active,
                      scheduleType: e.scheduleType,
                      workPatternId: e.workPatternId ? String(e.workPatternId) : "",
                      jobTitleId: e.jobTitleId ? String(e.jobTitleId) : "",
                      specialtyId: e.specialtyId ? String(e.specialtyId) : "",
                    })
                  }
                >
                  Sửa
                </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!photo} onClose={() => setPhoto(null)} title={photo ? `${photo.code} — ${photo.name}` : "Ảnh đại diện"}>
        {photo?.avatarUrl && (
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh qua API có kiểm quyền */}
            <img src={photo.avatarUrl} alt={photo.name} className="mx-auto size-64 rounded-2xl object-cover" />
            <p className="mt-2 text-xs text-slate-500">Ảnh nhìn thẳng lúc enroll. Chỉ Nhân sự, Quản trị, quản lý phòng và chính chủ xem được.</p>
          </div>
        )}
      </Modal>

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
            {showPersonal(form.id) && (
              <>
            <Field label="Số điện thoại" hint="Không bắt buộc — nhân viên đăng nhập bằng mã NV hoặc SĐT.">
              {(id) => <input id={id} className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
            </Field>
            <Field label="Số CCCD" hint="12 số (hoặc CMND 9 số). Chỉ Nhân sự, Quản trị và chính chủ xem được.">
              {(id) => <input id={id} className="input" inputMode="numeric" maxLength={12} value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/\D/g, "") })} />}
            </Field>
            <Field label="Ngày sinh">{(id) => <input id={id} type="date" className="input" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />}</Field>
            <Field label="Giới tính">
              {(id) => (
                <Select id={id} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="">— Chưa chọn —</option>
                  <option value="NAM">Nam</option>
                  <option value="NU">Nữ</option>
                  <option value="KHAC">Khác</option>
                </Select>
              )}
            </Field>
            <Field label="Địa chỉ" className="sm:col-span-2">
              {(id) => <input id={id} className="input" maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
            </Field>
              </>
            )}
            <Field label="Vai trò">
              {(id) => (
                <Select id={id} value={form.role} disabled={form.id === me.id} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {(roleOptions.some(([v]) => v === form.role) ? roleOptions : [...roleOptions, [form.role, ROLE[form.role] ?? form.role]]).map(([v, l]) => (
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
            <Field label="Chức danh" hint="Chỉ để mô tả, lọc và xuất Excel — không ảnh hưởng quyền.">
              {(id) => (
                <Select id={id} value={form.jobTitleId} onChange={(e) => setForm({ ...form, jobTitleId: e.target.value })}>
                  <option value="">— Chưa chọn —</option>
                  {jobTitles.data?.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Chuyên khoa / chuyên môn">
              {(id) => (
                <Select id={id} value={form.specialtyId} onChange={(e) => setForm({ ...form, specialtyId: e.target.value })}>
                  <option value="">— Chưa chọn —</option>
                  {specialties.data?.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Loại lịch làm việc" hint={form.scheduleType === "ROTATING" ? "Phải có lịch tuần đã đăng ký; chưa đăng ký => “Chưa có lịch”." : "Tự động theo mẫu tuần, không cần xếp ca hằng tuần."}>
              {(id) => (
                <Select id={id} value={form.scheduleType} onChange={(e) => setForm({ ...form, scheduleType: e.target.value as Form["scheduleType"] })}>
                  <option value="FIXED">Ca cố định (theo mẫu tuần)</option>
                  <option value="ROTATING">Xoay ca (xếp ca hằng tuần)</option>
                </Select>
              )}
            </Field>
            {form.scheduleType === "FIXED" && (
              <Field label="Mẫu tuần làm việc">
                {(id) => (
                  <Select id={id} value={form.workPatternId} onChange={(e) => setForm({ ...form, workPatternId: e.target.value })}>
                    <option value="">— Ca mặc định, nghỉ Chủ nhật —</option>
                    {patterns.data?.patterns.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {form.id && current && (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" className="size-4 accent-brand-700" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Đang làm việc (bỏ chọn = nghỉ việc, dữ liệu khuôn mặt sẽ bị xóa)
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="secondary" icon="key" disabled={busy} onClick={() => action(current.id, { resetPassword: true }, "Đã đặt lại mật khẩu")}>
                    Đặt lại mật khẩu
                  </Button>
                  {current.zaloLinked && (
                    <Button size="sm" variant="secondary" icon="zalo" disabled={busy} onClick={() => action(current.id, { unlinkZalo: true }, "Đã hủy liên kết Zalo")}>
                      Hủy liên kết Zalo
                    </Button>
                  )}
                  {current.faceCount > 0 && enroll && (
                    <Button size="sm" variant="secondary" icon="trash" className="text-rose-700" onClick={() => deleteFaces(current.id)}>
                      Xóa mẫu khuôn mặt
                    </Button>
                  )}
                  {current.id !== me.id && (
                    <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => setDeleting(current)}>
                      Xóa tài khoản
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  <b>Xóa tài khoản</b> chỉ dành cho tài khoản tạo nhầm, chưa có chấm công / đơn từ / lịch. Nhân viên nghỉ việc thì bỏ tích “Đang làm việc” để giữ lịch sử công.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Xóa hẳn tài khoản"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Hủy
            </Button>
            <Button variant="danger" loading={busy} onClick={() => deleting && deleteEmployee(deleting.id)}>
              Xóa vĩnh viễn
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Xóa hẳn <b>{deleting?.code} — {deleting?.name}</b>? Không khôi phục được; mã nhân viên và số điện thoại sẽ được giải phóng cho người khác. Hệ thống chỉ cho xóa khi tài khoản chưa có chấm công, đơn từ, lịch hay ngày đã chốt công — nếu đã có, bạn sẽ thấy lý do và nên dùng “Nghỉ việc”.
        </p>
      </Modal>
      <Modal open={!!tempPw} onClose={() => setTempPw(null)} title="Mật khẩu tạm thời" footer={<Button onClick={() => setTempPw(null)}>Đã ghi lại</Button>}>
        <p className="text-sm text-slate-600">Gửi mật khẩu này cho nhân viên. Họ bắt buộc phải đổi ở lần đăng nhập tới. Mật khẩu chỉ hiển thị một lần.</p>
        <p className="mt-3 rounded-xl bg-slate-900 py-3 text-center font-mono text-2xl font-bold tracking-widest text-white select-all">{tempPw}</p>
      </Modal>
      {manage && (
        <ImportModal
          open={importing}
          onClose={() => setImporting(false)}
          onDone={() => void reload()}
          departments={depts.data?.departments ?? []}
          shifts={shifts.data?.shifts ?? []}
          patterns={patterns.data?.patterns ?? []}
        />
      )}
    </>
  );
}
