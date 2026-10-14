"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { ProjectDot } from "@/components/tasks/task-badges";
import { ProjectFormModal } from "@/components/tasks/project-form-modal";
import { useApi } from "@/lib/client/api";
import { relTime } from "@/lib/client/format";
import { PROJECT_ROLE_LABEL, type ProjectDto } from "@/lib/tasks/types";
import { TasksTabs } from "./tasks-tabs";

type Resp = { projects: ProjectDto[]; canCreate: boolean; manageAll: boolean };

export default function TasksHome() {
  const router = useRouter();
  const [trash, setTrash] = useState(false);
  const { data, error, loading, reload } = useApi<Resp>(`/api/tasks/projects${trash ? "?deleted=1" : ""}`);
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Công việc"
        subtitle="Dự án bạn tham gia, bảng Kanban, việc lặp, nhắc hạn"
        actions={
          data?.canCreate && !trash ? (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Dự án mới
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TasksTabs />
        <button className="mb-4 text-sm font-medium text-slate-500 hover:text-slate-800" onClick={() => setTrash((t) => !t)}>
          {trash ? "← Dự án đang chạy" : "Thùng rác"}
        </button>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.projects.length ? (
        <Card>
          <EmptyState icon="tasks" title={trash ? "Thùng rác trống" : "Chưa có dự án nào"}>
            {trash ? "Dự án bị xóa nằm ở đây — chủ dự án khôi phục được." : data?.canCreate ? "Bấm “Dự án mới” để bắt đầu." : "Khi được thêm vào dự án, bạn sẽ thấy ở đây."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/me/tasks/${p.id}${trash ? "/settings" : ""}`} className="card block p-4 transition hover:border-slate-300">
              <div className="flex items-center gap-2">
                <ProjectDot color={p.color} />
                <p className="min-w-0 flex-1 truncate font-semibold text-slate-800">{p.name}</p>
                {p.myRole && <Badge tone={p.myRole === "OWNER" ? "brand" : "neutral"}>{PROJECT_ROLE_LABEL[p.myRole]}</Badge>}
              </div>
              {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description}</p>}
              {p.counts && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${p.counts.total ? Math.round((p.counts.done / p.counts.total) * 100) : 0}%` }} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>
                      {p.counts.done}/{p.counts.total} việc xong
                    </span>
                    {p.counts.overdue > 0 && <span className="font-semibold text-rose-600">{p.counts.overdue} quá hạn</span>}
                    <span>{p.counts.members} người</span>
                    <span>cập nhật {relTime(p.updatedAt)}</span>
                  </p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <ProjectFormModal
          open
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            router.push(`/me/tasks/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
