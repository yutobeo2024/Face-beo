"use client";
/**
 * Logic dùng chung cho các tab của một dự án (Bảng, Gantt, Lịch, Dashboard): tải việc, cập nhật tại chỗ, đổi trạng thái
 * có xếp hàng ghi + trả lại khi lỗi, mở chi tiết việc qua `?task=<id>` (deep link từ Zalo / chuông).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/toast";
import { api, type ApiError, useApi } from "@/lib/client/api";
import { TASK_STATUS_LABEL, type TaskDto, type TaskStatus } from "@/lib/tasks/types";
import { useMe } from "@/app/me/me-nav";
import { TaskDrawer } from "./task-drawer";
import { useProject } from "./use-project";

type Resp = { tasks: TaskDto[]; unscheduled?: TaskDto[]; unscheduledTotal?: number };

/** `query` = phần sau dấu ? của API danh sách việc (vd. "gantt=1", "from=…&to=…"); null = chưa tải. */
export function useProjectTasks(query: string | null = "") {
  const me = useMe();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: proj, projectId } = useProject();
  // Dự án đã xóa: API việc trả 404 — không gọi, trang hiện lời nhắc khôi phục.
  const url = proj && !proj.project.deletedAt && query !== null ? `/api/tasks/projects/${projectId}/tasks${query ? `?${query}` : ""}` : null;
  const { data, error, reload, setData } = useApi<Resp>(url);
  const [focusSubtasks, setFocusSubtasks] = useState(false);
  const [extra, setExtra] = useState<TaskDto | null>(null); // việc mở từ link nhưng không có trong danh sách đang tải
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const unscheduled = useMemo(() => data?.unscheduled ?? [], [data]);
  const all = useMemo(() => [...tasks, ...unscheduled], [tasks, unscheduled]);

  // Gantt / Lịch chỉ tải một khoảng ngày: chi tiết việc (tên việc phụ thuộc, ô chọn "phải xong trước") cần CẢ dự án —
  // tải danh sách đầy đủ khi đang mở một việc.
  const openParam = Number(params.get("task")) || null;
  const fullUrl = proj && !proj.project.deletedAt && query && openParam ? `/api/tasks/projects/${projectId}/tasks` : null;
  const full = useApi<Resp>(fullUrl);
  const drawerTasks = useMemo(() => {
    if (!query || !full.data) return all;
    const byId = new Map(full.data.tasks.map((t) => [t.id, t]));
    for (const t of all) byId.set(t.id, t); // bản đang hiển thị (có thể vừa sửa) thắng bản tải kèm
    return [...byId.values()];
  }, [query, full.data, all]);

  const openId = openParam;
  const setOpen = useCallback(
    (id: number | null) => {
      const sp = new URLSearchParams(params.toString());
      if (id) sp.set("task", String(id));
      else sp.delete("task");
      setFocusSubtasks(false);
      router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const open = all.find((t) => t.id === openId) ?? (extra?.id === openId ? extra : null);
  useEffect(() => {
    if (!openId || !data || all.some((t) => t.id === openId) || extra?.id === openId) return;
    api<{ task: TaskDto }>(`/api/tasks/${openId}`)
      .then((r) => setExtra(r.task))
      .catch(() => {
        toast.error("Không mở được việc này (đã xóa hoặc bạn không có quyền)");
        setOpen(null);
      });
  }, [openId, data, all, extra, setOpen, toast]);

  /** Thay một việc trong danh sách (Gantt: việc vừa có / vừa mất ngày bắt đầu thì chuyển nhóm). */
  const upsert = useCallback(
    (t: TaskDto) =>
      setData((d) => {
        if (!d) return d;
        if (!d.unscheduled) return { tasks: d.tasks.some((x) => x.id === t.id) ? d.tasks.map((x) => (x.id === t.id ? t : x)) : [...d.tasks, t] };
        const rest = { tasks: d.tasks.filter((x) => x.id !== t.id), unscheduled: d.unscheduled.filter((x) => x.id !== t.id) };
        return t.startDate ? { ...rest, tasks: [...rest.tasks, t] } : { ...rest, unscheduled: [...rest.unscheduled, t] };
      }),
    [setData],
  );
  const patchLocal = useCallback(
    (id: number, fn: (t: TaskDto) => TaskDto) => setData((d) => (d ? { ...d, tasks: d.tasks.map((x) => (x.id === id ? fn(x) : x)), ...(d.unscheduled ? { unscheduled: d.unscheduled.map((x) => (x.id === id ? fn(x) : x)) } : {}) } : d)),
    [setData],
  );
  const remove = useCallback((id: number) => setData((d) => (d ? { tasks: d.tasks.filter((x) => x.id !== id), ...(d.unscheduled ? { unscheduled: d.unscheduled.filter((x) => x.id !== id) } : {}) } : d)), [setData]);

  /** Ghi tuần tự (kéo thẻ / kéo thanh liên tiếp không gửi song song). */
  const enqueue = useCallback((fn: () => Promise<void>) => {
    const run = queue.current.then(fn);
    queue.current = run;
    return run;
  }, []);

  /** Đổi trạng thái: hiện ngay (optimistic); lỗi thì trả lại như cũ. */
  const changeStatus = useCallback(
    (t: TaskDto, to: TaskStatus) => {
      const from = t.status;
      patchLocal(t.id, (x) => ({ ...x, status: to }));
      return enqueue(async () => {
        try {
          const r = await api<{ task: TaskDto }>(`/api/tasks/${t.id}/status`, { body: { status: to, fromStatus: from } });
          upsert(r.task);
        } catch (e) {
          patchLocal(t.id, (x) => ({ ...x, status: from }));
          const err = e as ApiError;
          if ((err.data as { code?: string } | undefined)?.code === "SUBTASKS_PENDING") {
            toast.error(`${err.message} — đánh dấu xong việc con trước khi chuyển sang ${TASK_STATUS_LABEL.DONE}`);
            setOpen(t.id);
            setFocusSubtasks(true);
          } else if (err.status === 409) {
            toast.error(err.message);
            void reload();
          } else toast.error(err.message);
        }
      });
    },
    [enqueue, patchLocal, reload, setOpen, toast, upsert],
  );

  /** Sửa vài trường (vd. kéo thanh Gantt): hiện ngay, gửi PATCH, lỗi thì trả lại ĐÚNG các trường đó như cũ. */
  const patchTask = useCallback(
    (t: TaskDto, body: Partial<Pick<TaskDto, "startDate" | "dueAt">>) => {
      const before = Object.fromEntries(Object.keys(body).map((k) => [k, t[k as keyof typeof body]])) as typeof body;
      patchLocal(t.id, (x) => ({ ...x, ...body }));
      return enqueue(async () => {
        try {
          const r = await api<{ task: TaskDto }>(`/api/tasks/${t.id}`, { method: "PATCH", body });
          upsert(r.task);
        } catch (e) {
          patchLocal(t.id, (x) => ({ ...x, ...before }));
          toast.error((e as Error).message);
        }
      });
    },
    [enqueue, patchLocal, toast, upsert],
  );

  const drawer =
    open && proj ? (
      <TaskDrawer
        key={open.id}
        task={open}
        members={proj.members}
        allTasks={drawerTasks}
        meId={me.id}
        canDeleteTask={proj.perms.deleteTask}
        focusSubtasks={focusSubtasks}
        onChanged={(t) => (extra?.id === t.id ? setExtra(t) : upsert(t))}
        onDeleted={(id) => {
          remove(id);
          setOpen(null);
        }}
        onStatus={(t, s) => changeStatus(t, s)}
        onClose={() => setOpen(null)}
      />
    ) : null;

  return { me, proj, projectId, data, error, reload, tasks, unscheduled, unscheduledTotal: data?.unscheduledTotal ?? unscheduled.length, all, upsert, changeStatus, patchTask, setOpen, drawer };
}
