"use client";
import Link from "next/link";
import { useState } from "react";
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented, StatCard } from "@/components/ui";
import { ProjectDot } from "@/components/tasks/task-badges";
import { useApi } from "@/lib/client/api";
import { relTime } from "@/lib/client/format";
import type { ProjectDto } from "@/lib/tasks/types";
import { useCan } from "../admin-nav";

type Row = ProjectDto & { owner: { id: number; code: string; name: string; active: boolean } | null };
type Resp = { projects: Row[]; kpi: { projects: number; tasks: number; done: number; overdue: number } };

/** Tổng quan mọi dự án (tasks.manageAll). Mở dự án ở trang Công việc của nhân viên (/me/tasks). */
export default function AdminTasksPage() {
  const can = useCan();
  const [deleted, setDeleted] = useState<"0" | "1">("0");
  const { data, error, reload } = useApi<Resp>(can("tasks.manageAll") ? `/api/tasks/overview${deleted === "1" ? "?deleted=1" : ""}` : null);
  if (!can("tasks.manageAll")) return <ErrorBox message="Bạn không có quyền xem tổng quan Công việc." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div>
      <PageHeader title="Công việc" subtitle="Mọi dự án trong phòng khám — chủ dự án, tiến độ, việc quá hạn" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Dự án" value={data.kpi.projects} tone="brand" />
        <StatCard label="Công việc" value={data.kpi.tasks} />
        <StatCard label="Đã xong" value={data.kpi.done} tone="ontime" />
        <StatCard label="Quá hạn" value={data.kpi.overdue} tone="absent" />
      </div>
      <Segmented
        className="mb-3"
        value={deleted}
        onChange={setDeleted}
        options={[
          { value: "0", label: "Đang chạy" },
          { value: "1", label: "Đã xóa" },
        ]}
      />
      {!data.projects.length ? (
        <Card>
          <EmptyState icon="tasks" title="Chưa có dự án" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dự án</th>
                  <th>Chủ dự án</th>
                  <th className="text-right">Việc</th>
                  <th className="text-right">Xong</th>
                  <th className="text-right">Quá hạn</th>
                  <th className="text-right">Người</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/me/tasks/${p.id}${p.deletedAt ? "/settings" : ""}`} className="flex items-center gap-2 font-medium text-brand-800 hover:underline">
                        <ProjectDot color={p.color} /> {p.name}
                      </Link>
                    </td>
                    <td>
                      {p.owner ? `${p.owner.name} (${p.owner.code})` : "—"}
                      {p.owner && !p.owner.active && <span className="ml-1 text-xs text-rose-600">đã nghỉ — chuyển chủ</span>}
                    </td>
                    <td className="text-right tabular-nums">{p.counts?.total ?? 0}</td>
                    <td className="text-right tabular-nums">{p.counts?.done ?? 0}</td>
                    <td className={`text-right tabular-nums ${p.counts?.overdue ? "font-semibold text-rose-600" : ""}`}>{p.counts?.overdue ?? 0}</td>
                    <td className="text-right tabular-nums">{p.counts?.members ?? 0}</td>
                    <td className="text-slate-500">{relTime(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
