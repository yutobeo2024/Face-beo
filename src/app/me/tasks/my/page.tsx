"use client";
import Link from "next/link";
import { useState } from "react";
import { Avatar, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented } from "@/components/ui";
import { DueText, PriorityBadge, ProjectDot, StatusBadge } from "@/components/tasks/task-badges";
import { useApi } from "@/lib/client/api";
import { taskHref, type ProjectColor, type TaskDto } from "@/lib/tasks/types";
import { TasksTabs } from "../tasks-tabs";

type Row = TaskDto & { project: { id: number; name: string; color: ProjectColor } };
type Due = "overdue" | "today" | "week" | "all";

export default function MyTasksPage() {
  const [due, setDue] = useState<Due>("week");
  const [done, setDone] = useState(false);
  const { data, error, loading, reload } = useApi<{ tasks: Row[] }>(`/api/tasks/my?due=${due}${done ? "&done=1" : ""}`);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Công việc" subtitle="Việc bạn được giao hoặc tự tạo, ở mọi dự án" />
      <TasksTabs />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          value={due}
          onChange={setDue}
          options={[
            { value: "overdue", label: "Quá hạn" },
            { value: "today", label: "Hôm nay" },
            { value: "week", label: "7 ngày tới" },
            { value: "all", label: "Tất cả" },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="size-4" checked={done} onChange={(e) => setDone(e.target.checked)} /> Hiện cả việc đã xong
        </label>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.tasks.length ? (
        <Card>
          <EmptyState icon="tasks" title={due === "overdue" ? "Không có việc quá hạn 🎉" : "Không có việc nào"} />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {data.tasks.map((t) => (
            <Link key={t.id} href={taskHref(t.project.id, t.id)} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
              <ProjectDot color={t.project.color} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{t.title}</p>
                <p className="truncate text-xs text-slate-500">{t.project.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} compact />
                  <DueText dueAt={t.dueAt} status={t.status} />
                </div>
              </div>
              <div className="flex -space-x-1.5">
                {t.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.id} name={a.name} src={a.avatarUrl} className="size-6 ring-2 ring-white" />
                ))}
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
