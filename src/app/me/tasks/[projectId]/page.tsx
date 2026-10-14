"use client";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, ErrorBox, Loading, Segmented } from "@/components/ui";
import { useToast } from "@/components/toast";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { useProject } from "@/components/tasks/use-project";
import { api, ApiError, useApi, useDebounced } from "@/lib/client/api";
import { TASK_STATUS_LABEL, type TaskDto, type TaskStatus } from "@/lib/tasks/types";
import { useMe } from "../../me-nav";

// dnd-kit chỉ nạp ở trang này.
const KanbanBoard = dynamic(() => import("@/components/tasks/kanban-board"), { ssr: false, loading: () => <Loading label="Đang mở bảng…" /> });

export default function ProjectBoardPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const me = useMe();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: proj, projectId } = useProject();
  // Dự án đã xóa: API việc trả 404 — không gọi, hiện lời nhắc khôi phục.
  const { data, error, reload, setData } = useApi<{ tasks: TaskDto[] }>(proj && !proj.project.deletedAt ? `/api/tasks/projects/${projectId}/tasks` : null);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [focusSubtasks, setFocusSubtasks] = useState(false);
  const [extra, setExtra] = useState<TaskDto | null>(null); // việc mở từ link nhưng không có trong danh sách
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const openId = Number(params.get("task")) || null;
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

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const open = tasks.find((t) => t.id === openId) ?? (extra?.id === openId ? extra : null);
  useEffect(() => {
    if (!openId || !data || tasks.some((t) => t.id === openId) || extra?.id === openId) return;
    api<{ task: TaskDto }>(`/api/tasks/${openId}`)
      .then((r) => setExtra(r.task))
      .catch(() => {
        toast.error("Không mở được việc này (đã xóa hoặc bạn không có quyền)");
        setOpen(null);
      });
  }, [openId, data, tasks, extra, setOpen, toast]);

  const upsert = useCallback((t: TaskDto) => setData((d) => (d ? { tasks: d.tasks.some((x) => x.id === t.id) ? d.tasks.map((x) => (x.id === t.id ? t : x)) : [...d.tasks, t] } : d)), [setData]);

  /** Đổi trạng thái: hiện ngay (optimistic), xếp hàng ghi để không gửi song song; lỗi thì trả lại như cũ. */
  const changeStatus = useCallback(
    (t: TaskDto, to: TaskStatus) => {
      const from = t.status;
      setData((d) => (d ? { tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status: to } : x)) } : d));
      const run = queue.current.then(async () => {
        try {
          const r = await api<{ task: TaskDto }>(`/api/tasks/${t.id}/status`, { body: { status: to, fromStatus: from } });
          upsert(r.task);
        } catch (e) {
          setData((d) => (d ? { tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status: from } : x)) } : d));
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
      queue.current = run;
      return run;
    },
    [reload, setData, setOpen, toast, upsert],
  );

  if (proj?.project.deletedAt) return <ErrorBox message="Dự án đã bị xóa — vào tab Cài đặt để khôi phục (Chủ dự án / Nhân sự)." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !proj) return <Loading />;
  const shown = tasks.filter((t) => (filter === "all" || t.assignees.some((a) => a.id === me.id) || t.createdById === me.id) && (!dq || t.title.toLowerCase().includes(dq)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: proj.perms.seeAllTasks ? "Tất cả" : "Việc của tôi trong dự án" },
            { value: "mine", label: "Tôi làm / tôi tạo" },
          ]}
        />
        <input className="input h-9 w-full sm:w-56" placeholder="Tìm theo tiêu đề…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" />
        {proj.perms.createTask && (
          <Button icon="plus" size="sm" onClick={() => setCreating("TODO")}>
            Việc mới
          </Button>
        )}
      </div>
      <KanbanBoard tasks={shown} canCreate={proj.perms.createTask} onStatus={(t, s) => void changeStatus(t, s)} onOpen={(t) => setOpen(t.id)} onCreate={(s) => setCreating(s)} />
      {creating && (
        <CreateTaskModal
          projectId={projectId}
          members={proj.members}
          meId={me.id}
          canAssignOthers={proj.perms.manage || proj.perms.seeAllTasks}
          defaultStatus={creating}
          onClose={() => setCreating(null)}
          onCreated={(t) => {
            setCreating(null);
            upsert(t);
          }}
        />
      )}
      {open && (
        <TaskDrawer
          key={open.id}
          task={open}
          members={proj.members}
          allTasks={tasks}
          meId={me.id}
          canDeleteTask={proj.perms.deleteTask}
          focusSubtasks={focusSubtasks}
          onChanged={(t) => (extra?.id === t.id ? setExtra(t) : upsert(t))}
          onDeleted={(id) => {
            setData((d) => (d ? { tasks: d.tasks.filter((x) => x.id !== id) } : d));
            setOpen(null);
          }}
          onStatus={(t, s) => changeStatus(t, s) as Promise<void>}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
