"use client";
import { createContext, useContext } from "react";
import { useApi } from "@/lib/client/api";
import type { MemberDto, ProjectDto, ProjectPerms } from "@/lib/tasks/types";

export type ProjectResp = { project: ProjectDto; members: MemberDto[]; perms: ProjectPerms };
type Ctx = ReturnType<typeof useApi<ProjectResp>> & { projectId: number };

const ProjectCtx = createContext<Ctx | null>(null);

export function ProjectProvider({ projectId, children }: { projectId: number; children: React.ReactNode }) {
  const q = useApi<ProjectResp>(Number.isInteger(projectId) && projectId > 0 ? `/api/tasks/projects/${projectId}` : null);
  return <ProjectCtx.Provider value={{ ...q, projectId }}>{children}</ProjectCtx.Provider>;
}

/** Dự án đang mở (layout /me/tasks/[projectId] nạp một lần cho mọi tab). */
export const useProject = () => useContext(ProjectCtx)!;
