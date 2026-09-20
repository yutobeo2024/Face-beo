"use client";
import { useState } from "react";
import Link from "next/link";
import { api, useApi } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, IconButton, Loading, Modal, PageHeader, cx } from "@/components/ui";
import { Icon, LINK_COLORS, LINK_COLOR_NAMES, LINK_ICONS, type IconName, type LinkColor } from "@/components/icons";
import { useDepartments } from "@/components/dept-select";
import { useToast } from "@/components/toast";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { useAdminUser, useCan } from "../admin-nav";

type LinkRow = {
  id: number;
  title: string;
  url: string;
  description: string | null;
  icon: string;
  color: string;
  order: number;
  active: boolean;
  visibleRoles: string[];
  visibleDeptIds: number[];
};
type Form = Omit<LinkRow, "id" | "description"> & { id?: number; description: string };

const EMPTY: Form = { title: "", url: "", description: "", icon: "link", color: "brand", order: 0, active: true, visibleRoles: [], visibleDeptIds: [] };

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Quản trị mục "Thông tin": thêm / sửa / ẩn / xóa liên kết, chọn icon, giới hạn vai trò + phòng ban được xem. */
export default function LinksAdminPage() {
  const can = useCan();
  const me = useAdminUser();
  const toast = useToast();
  const list = useApi<{ links: LinkRow[] }>(can("links.manage") ? "/api/links" : null);
  const depts = useDepartments();
  const [form, setForm] = useState<Form | null>(null);
  const [del, setDel] = useState<LinkRow | null>(null);
  const [busy, setBusy] = useState(false);
  const isManager = me.role === "MANAGER";

  if (!can("links.manage")) return <ErrorBox message="Bạn không có quyền quản lý liên kết." />;
  if (list.error) return <ErrorBox message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;

  const deptName = (id: number) => depts.data?.departments.find((d) => d.id === id)?.name ?? `#${id}`;

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

  function save() {
    if (!form) return;
    const { id, ...rest } = form;
    const body = { ...rest, description: rest.description.trim() || null };
    void run(() => api(id ? `/api/links/${id}` : "/api/links", { method: id ? "PATCH" : "POST", body }), id ? "Đã cập nhật liên kết" : "Đã thêm liên kết", () => {
      setForm(null);
      list.reload();
    });
  }

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <>
      <PageHeader
        title="Liên kết — mục Thông tin"
        subtitle="Ô liên kết nhân viên thấy trong Trang cá nhân → Thông tin. Để trống vai trò / phòng ban nghĩa là mọi người đều thấy; tích cả hai thì người xem phải khớp cả vai trò lẫn phòng."
        actions={
          <div className="flex gap-2">
            <Link href="/me/info" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Icon name="eye" className="size-4" />
              Xem như nhân viên
            </Link>
            <Button size="sm" icon="plus" onClick={() => setForm({ ...EMPTY, order: (list.data?.links.length ?? 0) + 1 })}>
              Thêm liên kết
            </Button>
          </div>
        }
      />
      {isManager && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Bạn là Quản lý: chỉ tạo và sửa được liên kết gắn với phòng mình phụ trách (bắt buộc chọn ít nhất một phòng). Liên kết toàn công ty do Nhân sự / Quản trị quản lý.
        </p>
      )}
      <Card>
        <CardHeader title={`${list.data.links.length} liên kết`} actions={<IconButton icon="refresh" label="Tải lại" onClick={list.reload} />} />
        {list.data.links.length === 0 ? (
          <EmptyState icon="link" title="Chưa có liên kết">
            Bấm “Thêm liên kết” để đưa web app, Google Sheet, thư mục Drive… vào mục Thông tin.
          </EmptyState>
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {list.data.links.map((l) => (
              <div key={l.id} className={cx("card flex flex-col overflow-hidden rounded-2xl", !l.active && "opacity-60")}>
                {/* Nửa trên: ô đúng như nhân viên thấy */}
                <div className={cx("flex flex-col items-center gap-2 px-4 py-5 text-center", LINK_COLORS[l.color as LinkColor] ?? LINK_COLORS.brand)}>
                  <span className="rounded-2xl bg-white/80 p-3">
                    <Icon name={l.icon as IconName} className="size-7" />
                  </span>
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">{l.title}</span>
                </div>
                {/* Nửa dưới: thông tin quản trị */}
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-brand-700 hover:underline">
                    {host(l.url)}
                  </a>
                  {l.description && <p className="line-clamp-2 text-xs text-slate-500">{l.description}</p>}
                  <p className="flex flex-wrap gap-1">
                    {l.visibleRoles.length === 0 && l.visibleDeptIds.length === 0 && <Badge tone="ontime">Mọi người</Badge>}
                    {l.visibleRoles.map((r) => (
                      <Badge key={r} tone="violet">
                        {ROLE_LABEL[r as Role] ?? r}
                      </Badge>
                    ))}
                    {l.visibleDeptIds.map((d) => (
                      <Badge key={d} tone="brand">
                        {deptName(d)}
                      </Badge>
                    ))}
                    {!l.active && <Badge tone="neutral">Đang ẩn</Badge>}
                  </p>
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className="text-xs text-slate-400">Thứ tự #{l.order}</span>
                    <div className="flex">
                      <IconButton icon="edit" label="Sửa" onClick={() => setForm({ ...l, description: l.description ?? "" })} />
                      <IconButton icon="trash" label="Xóa" className="text-rose-600 hover:bg-rose-50" onClick={() => setDel(l)} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Sửa liên kết" : "Thêm liên kết"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={save} disabled={!form || form.title.trim().length < 2 || !/^https?:\/\//i.test(form.url.trim())}>
              Lưu
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tiêu đề" className="sm:col-span-2">
              {(id) => <input id={id} className="input" value={form.title} maxLength={80} placeholder="VD: Bảng KPI tháng" onChange={(e) => setForm({ ...form, title: e.target.value })} />}
            </Field>
            <Field label="Đường dẫn (URL)" hint="Bắt đầu bằng https:// — dán link chia sẻ của Google Sheet / Drive / Docs hoặc địa chỉ web app." className="sm:col-span-2">
              {(id) => <input id={id} className="input" type="url" value={form.url} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setForm({ ...form, url: e.target.value })} />}
            </Field>
            <Field label="Mô tả ngắn" hint="Hiện dưới tiêu đề trong ô (không bắt buộc)." className="sm:col-span-2">
              {(id) => <input id={id} className="input" value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
            </Field>
            <Field label="Icon" className="sm:col-span-2">
              {() => (
                <div className="flex flex-wrap gap-2">
                  {LINK_ICONS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      aria-pressed={form.icon === name}
                      onClick={() => setForm({ ...form, icon: name })}
                      className={cx(
                        "flex size-11 items-center justify-center rounded-xl border transition",
                        form.icon === name ? `border-brand-500 ring-4 ring-brand-500/15 ${LINK_COLORS[form.color as LinkColor]}` : "border-slate-200 text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <Icon name={name} />
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Màu ô">
              {() => (
                <div className="flex flex-wrap gap-2">
                  {LINK_COLOR_NAMES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-pressed={form.color === c}
                      onClick={() => setForm({ ...form, color: c })}
                      className={cx("size-9 rounded-full border-2 transition", LINK_COLORS[c], form.color === c ? "border-slate-800 scale-110" : "border-transparent")}
                    />
                  ))}
                </div>
              )}
            </Field>
            <Field label="Thứ tự" hint="Số nhỏ hiện trước.">
              {(id) => <input id={id} className="input" type="number" min={0} max={9999} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} />}
            </Field>
            <Field label="Vai trò được xem" hint={form.visibleRoles.length && !form.visibleRoles.includes(me.role as Role) ? `Bạn (${ROLE_LABEL[me.role as Role] ?? me.role}) không thuộc diện này — vẫn thấy ô ở trang Thông tin nhờ quyền quản lý, kèm nhãn "Chỉ: …".` : "Không chọn = mọi vai trò. Chỉ tích 'Nhân viên' thì Quản lý/Nhân sự cùng phòng KHÔNG thấy."}>
              {() => (
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <label key={r} className={cx("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm", form.visibleRoles.includes(r) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-700")}>
                      <input type="checkbox" className="accent-brand-700" checked={form.visibleRoles.includes(r)} onChange={() => setForm({ ...form, visibleRoles: toggle(form.visibleRoles, r) })} />
                      {ROLE_LABEL[r]}
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Phòng ban được xem" hint={isManager ? "Bắt buộc chọn ít nhất một phòng bạn phụ trách." : "Không chọn = mọi phòng ban."}>
              {() => (
                <div className="flex flex-wrap gap-2">
                  {(depts.data?.departments ?? []).map((d) => (
                    <label key={d.id} className={cx("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm", form.visibleDeptIds.includes(d.id) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-700")}>
                      <input type="checkbox" className="accent-brand-700" checked={form.visibleDeptIds.includes(d.id)} onChange={() => setForm({ ...form, visibleDeptIds: toggle(form.visibleDeptIds, d.id) })} />
                      {d.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
              <input type="checkbox" className="accent-brand-700" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Đang hiển thị (bỏ tích để tạm ẩn mà không xóa)
            </label>
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Xem trước</p>
              <div className="card flex w-40 aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center">
                <span className={cx("rounded-2xl p-3", LINK_COLORS[form.color as LinkColor])}>
                  <Icon name={form.icon as IconName} className="size-7" />
                </span>
                <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">{form.title || "Tiêu đề"}</span>
                <span className="line-clamp-1 max-w-full text-[11px] text-slate-400">{form.description || host(form.url) || "mô tả"}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title="Xóa liên kết"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>
              Hủy
            </Button>
            <Button variant="danger" loading={busy} onClick={() => del && run(() => api(`/api/links/${del.id}`, { method: "DELETE" }), "Đã xóa liên kết", () => (setDel(null), list.reload()))}>
              Xóa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Xóa liên kết <b>{del?.title}</b>? Nhân viên sẽ không thấy ô này nữa. Muốn tạm ẩn thay vì xóa, hãy sửa và bỏ tích “Đang hiển thị”.
        </p>
      </Modal>
    </>
  );
}
