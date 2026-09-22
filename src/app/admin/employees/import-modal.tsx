"use client";
import { useState } from "react";
import { Badge, Button, Field, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";

type Item = { row: number; code: string; name: string; action: "CREATE" | "UPDATE" | "NOCHANGE" | "ERROR"; errors: string[]; warnings: string[]; changes: string[] };
type Preview = {
  summary: { total: number; create: number; update: number; unchanged: number; errors: number };
  items: Item[];
  defaults: { department: string; shift: string; pattern: string | null };
};
type Opt = { id: number; name: string };

const ACTION: Record<Item["action"], { label: string; tone: "ontime" | "leave" | "neutral" | "absent" }> = {
  CREATE: { label: "Tạo mới", tone: "ontime" },
  UPDATE: { label: "Cập nhật", tone: "leave" },
  NOCHANGE: { label: "Không đổi", tone: "neutral" },
  ERROR: { label: "Lỗi", tone: "absent" },
};

function download(name: string, bytes: BlobPart) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Nhập nhân viên từ Excel: chọn mặc định cho ô trống → chọn file → xem trước từng dòng → nhập (tất cả hoặc không) → tải file mật khẩu tạm. */
export function ImportModal({
  open,
  onClose,
  onDone,
  departments,
  shifts,
  patterns,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  departments: Opt[];
  shifts: (Opt & { startTime: string; endTime: string })[];
  patterns: Opt[];
}) {
  const toast = useToast();
  const defShift = shifts.find((s) => s.name === "Hành chính") ?? shifts[0];
  const defPattern = patterns.find((p) => p.name === "HC T2–T6 + T7 sáng");
  const [dept, setDept] = useState("unassigned");
  const [shift, setShift] = useState(defShift ? String(defShift.id) : "");
  const [pattern, setPattern] = useState(defPattern ? String(defPattern.id) : "none");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null);

  const reset = () => (setFile(null), setPreview(null), setDone(null), setOnlyErrors(false));
  const close = () => (reset(), onClose());

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ mode, defaultDepartmentId: dept, defaultPatternId: pattern, ...(shift ? { defaultShiftId: shift } : {}) });
      const res = await fetch(`/api/employees/import?${qs}`, { method: "POST", body: await file.arrayBuffer(), headers: { "Content-Type": "application/octet-stream" }, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.items) setPreview((p) => (p ? { ...p, items: data.items, summary: data.summary } : p));
        throw new Error(data.error ?? `Lỗi ${res.status}`);
      }
      if (mode === "preview") {
        setPreview(data);
        setOnlyErrors(data.summary.errors > 0);
      } else {
        const bin = Uint8Array.from(atob(data.resultFile), (c) => c.charCodeAt(0));
        download(`KetQuaNhap_${new Date().toISOString().slice(0, 10)}.xlsx`, bin);
        setDone({ created: data.created, updated: data.updated });
        toast.success(`Đã nhập: tạo mới ${data.created}, cập nhật ${data.updated}`);
        onDone();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = preview ? preview.items.filter((i) => !onlyErrors || i.action === "ERROR") : [];
  const s = preview?.summary;
  return (
    <Modal
      open={open}
      onClose={close}
      title="Nhập nhân viên từ Excel"
      wide
      footer={
        done ? (
          <Button onClick={close}>Đóng</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Hủy
            </Button>
            {!preview ? (
              <Button loading={busy} disabled={!file} onClick={() => send("preview")}>
                Kiểm tra file
              </Button>
            ) : (
              <Button loading={busy} disabled={!!s?.errors || !(s?.create || s?.update)} onClick={() => send("commit")}>
                Nhập {(s?.create ?? 0) + (s?.update ?? 0)} dòng
              </Button>
            )}
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-2 text-sm">
          <p>
            Đã tạo mới <b>{done.created}</b>, cập nhật <b>{done.updated}</b> nhân viên.
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
            File <b>KetQuaNhap_….xlsx</b> vừa tải về có <b>mật khẩu tạm</b> của người mới — chỉ có trong file này. Phát riêng cho từng người; lần đăng nhập đầu phải đổi mật khẩu.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Dùng{" "}
            <a className="font-semibold text-brand-700 underline" href="/api/employees/import/template" download>
              file mẫu
            </a> (có sẵn danh sách thả xuống). Chỉ <b>Mã NV</b> và <b>Họ tên</b> bắt buộc. Mã đã có → cập nhật các ô có điền (ô trống giữ nguyên).
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Phòng mặc định (người mới)">
              {(id) => (
                <Select id={id} value={dept} onChange={(e) => (setDept(e.target.value), setPreview(null))}>
                  <option value="unassigned">Chưa phân phòng</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Ca mặc định">
              {(id) => (
                <Select id={id} value={shift} onChange={(e) => (setShift(e.target.value), setPreview(null))}>
                  {shifts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} {x.startTime}–{x.endTime}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Mẫu tuần mặc định">
              {(id) => (
                <Select id={id} value={pattern} onChange={(e) => (setPattern(e.target.value), setPreview(null))}>
                  <option value="none">— Tự dùng mẫu “&lt;ca mặc định&gt; T2–T7” (CN nghỉ; tạo nếu chưa có) —</option>
                  {patterns.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <p className="text-xs text-slate-500">Mặc định chỉ dùng cho ô bỏ trống của người mới. Nên chỉnh ca / mẫu tuần theo giờ thật của phòng khám trước khi nhập (Cấu hình → Ca làm việc).</p>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm"
            onChange={(e) => (setFile(e.target.files?.[0] ?? null), setPreview(null))}
          />
          {preview && s && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="ontime">Tạo mới {s.create}</Badge>
                <Badge tone="leave">Cập nhật {s.update}</Badge>
                {s.unchanged > 0 && <Badge tone="neutral">Không đổi {s.unchanged}</Badge>}
                <Badge tone={s.errors ? "absent" : "neutral"}>Lỗi {s.errors}</Badge>
                <label className="ml-auto flex items-center gap-1 text-xs text-slate-600">
                  <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Chỉ dòng lỗi
                </label>
              </div>
              {s.errors > 0 && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Còn dòng lỗi — sửa trong file Excel rồi chọn lại file. Chưa nhập dòng nào.</p>}
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">Dòng</th>
                      <th className="px-2 py-1.5">Mã NV</th>
                      <th className="px-2 py-1.5">Họ tên</th>
                      <th className="px-2 py-1.5">Kết quả</th>
                      <th className="px-2 py-1.5">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((i) => (
                      <tr key={i.row} className={i.action === "ERROR" ? "bg-rose-50/50" : ""}>
                        <td className="px-2 py-1.5 tabular-nums">{i.row}</td>
                        <td className="px-2 py-1.5 font-mono">{i.code}</td>
                        <td className="px-2 py-1.5">{i.name}</td>
                        <td className="px-2 py-1.5">
                          <Badge tone={ACTION[i.action].tone}>{ACTION[i.action].label}</Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          {i.errors.map((e) => (
                            <p key={e} className="text-rose-700">
                              • {e}
                            </p>
                          ))}
                          {i.changes.length > 0 && <p className="text-slate-700">Đổi: {i.changes.join(", ")}</p>}
                          {i.warnings.map((w) => (
                            <p key={w} className="text-amber-700">
                              ⚠ {w}
                            </p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Người mới bỏ trống sẽ dùng: phòng <b>{preview.defaults.department}</b>, ca <b>{preview.defaults.shift}</b>, mẫu tuần <b>{preview.defaults.pattern ?? "không"}</b>.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
