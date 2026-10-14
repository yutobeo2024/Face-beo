"use client";
import { useState } from "react";
import { Button, cx, Field, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, useApi } from "@/lib/client/api";
import { DEFAULT_ZALO_PREFS, PROJECT_COLOR_KEYS, PROJECT_COLORS, ZALO_PREF_KEYS, ZALO_PREF_LABEL, type ProjectColor, type ProjectDto, type ZaloPrefs } from "@/lib/tasks/types";

/** Tạo / sửa dự án. Sửa: chỉ gửi trường đã đổi (Quản lý dự án không đổi tên được — ô tên khóa khi `canRename` = false). */
export function ProjectFormModal({
  open,
  onClose,
  project,
  canRename = true,
  canPickGroup = true,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project?: ProjectDto | null;
  canRename?: boolean;
  /** Đổi nhóm Zalo: cần quyền tạo dự án / quản lý mọi dự án (server kiểm lại). */
  canPickGroup?: boolean;
  onSaved: (p: ProjectDto) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState<ProjectColor>(project?.color ?? "blue");
  const [description, setDescription] = useState(project?.description ?? "");
  const [zaloGroupId, setZaloGroupId] = useState(project?.zaloGroupId ?? "");
  const [prefs, setPrefs] = useState<ZaloPrefs>(project?.zaloPrefs ?? DEFAULT_ZALO_PREFS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groups = useApi<{ groups: { groupId: string; name: string }[] }>(open && canPickGroup ? `/api/tasks/zalo-groups${project ? `?projectId=${project.id}` : ""}` : null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { color, description, zaloPrefs: prefs };
      // Chỉ gửi nhóm khi thật sự đổi (nhóm cũ đã bị gỡ khỏi Cấu hình không làm hỏng lần lưu khác).
      if (canPickGroup && (zaloGroupId || null) !== (project?.zaloGroupId ?? null)) body.zaloGroupId = zaloGroupId || null;
      if (!project || (canRename && name.trim() !== project.name)) body.name = name.trim();
      const r = project
        ? await api<{ project: ProjectDto }>(`/api/tasks/projects/${project.id}`, { method: "PATCH", body })
        : await api<{ project: ProjectDto }>("/api/tasks/projects", { body });
      toast.success(project ? "Đã lưu dự án" : "Đã tạo dự án");
      onSaved(r.project);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Sửa dự án" : "Dự án mới"}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={submit} loading={busy} disabled={name.trim().length < 2}>
            {project ? "Lưu" : "Tạo dự án"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên dự án" hint={!canRename ? "Chỉ Chủ dự án đổi được tên" : undefined}>
          {(id) => <input id={id} className="input" value={name} maxLength={100} disabled={!canRename} onChange={(e) => setName(e.target.value)} placeholder="Vd. Khám sức khỏe công ty ABC" />}
        </Field>
        <Field label="Mô tả">{(id) => <textarea id={id} className="input min-h-20" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div>
          <p className="label">Màu</p>
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLOR_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                title={PROJECT_COLORS[c].label}
                aria-label={PROJECT_COLORS[c].label}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cx("size-8 rounded-full ring-offset-2 transition", PROJECT_COLORS[c].dot, color === c && "ring-2 ring-slate-800")}
              />
            ))}
          </div>
        </div>
        <Field label="Nhóm Zalo nhận tin của dự án" hint="Danh sách nhóm do Quản trị cấu hình ở Cấu hình → Zalo OA. Tin chỉ có tiêu đề, người làm, trạng thái, hạn.">
          {(id) => (
            <Select id={id} value={zaloGroupId} disabled={!canPickGroup} onChange={(e) => setZaloGroupId(e.target.value)}>
              <option value="">Không gửi Zalo</option>
              {groups.data?.groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.name}
                </option>
              ))}
              {zaloGroupId && !groups.data?.groups.some((g) => g.groupId === zaloGroupId) && (
                <option value={zaloGroupId}>{canPickGroup ? `${zaloGroupId} (không còn trong danh sách)` : "Nhóm đã chọn (chỉ người tạo dự án / Nhân sự đổi được)"}</option>
              )}
            </Select>
          )}
        </Field>
        {zaloGroupId && (
          <fieldset className="space-y-1.5 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Gửi Zalo khi</legend>
            {ZALO_PREF_KEYS.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 size-4" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} />
                {ZALO_PREF_LABEL[k]}
              </label>
            ))}
          </fieldset>
        )}
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}
