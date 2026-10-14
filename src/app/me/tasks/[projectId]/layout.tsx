"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Badge, cx, ErrorBox, Loading } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ProjectDot } from "@/components/tasks/task-badges";
import { ProjectProvider, useProject } from "@/components/tasks/use-project";
import { PROJECT_ROLE_LABEL } from "@/lib/tasks/types";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectProvider projectId={Number(projectId)}>
      <Frame>{children}</Frame>
    </ProjectProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { data, error, reload, projectId } = useProject();
  const path = usePathname();
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { project, perms } = data;
  const base = `/me/tasks/${projectId}`;
  const tabs = [
    { href: base, label: "Bảng công việc", icon: "grid" as const },
    { href: `${base}/settings`, label: perms.manage ? "Cài đặt & thành viên" : "Thành viên", icon: "users" as const },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/me/tasks" className="text-sm text-slate-500 hover:text-slate-800">
          ← Dự án
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ProjectDot color={project.color} className="size-3" />
        <h1 className="min-w-0 truncate text-xl font-bold text-slate-900 sm:text-2xl">{project.name}</h1>
        {perms.role && <Badge tone={perms.role === "OWNER" ? "brand" : "neutral"}>{PROJECT_ROLE_LABEL[perms.role]}</Badge>}
        {project.deletedAt && <Badge tone="absent">Đã xóa</Badge>}
      </div>
      <nav className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap",
              path === t.href ? "border-brand-600 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            <Icon name={t.icon} className="size-4" /> {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
