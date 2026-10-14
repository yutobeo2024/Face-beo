"use client";
import dynamic from "next/dynamic";
import { Suspense, useState } from "react";
import { Button, ErrorBox, Loading, Segmented } from "@/components/ui";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { useProjectTasks } from "@/components/tasks/use-project-tasks";
import { useDebounced } from "@/lib/client/api";
import type { TaskStatus } from "@/lib/tasks/types";

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
  const { me, proj, projectId, data, error, reload, tasks, upsert, changeStatus, setOpen, drawer } = useProjectTasks();
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [creating, setCreating] = useState<TaskStatus | null>(null);

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
      {drawer}
    </div>
  );
}
