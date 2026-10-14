"use client";
import { ErrorBox, Loading } from "@/components/ui";
import { ProjectDashboard } from "@/components/tasks/project-dashboard";
import { useProject } from "@/components/tasks/use-project";

export default function ProjectDashboardPage() {
  const { data, projectId } = useProject();
  if (!data) return <Loading />;
  if (data.project.deletedAt) return <ErrorBox message="Dự án đã bị xóa — vào tab Cài đặt để khôi phục (Chủ dự án / Nhân sự)." />;
  return <ProjectDashboard projectId={projectId} seeAll={data.perms.seeAllTasks} />;
}
