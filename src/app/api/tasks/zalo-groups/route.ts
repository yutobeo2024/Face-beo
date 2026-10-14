import { z } from "zod";
import { prisma } from "@/lib/db";
import { forbidden, handle, json, parseQuery } from "@/lib/api";
import { can } from "@/lib/permissions";
import { idNum } from "@/lib/validators";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { canPickZaloGroup, loadProjectCtx } from "@/lib/tasks/projects";

/**
 * Nhóm Zalo chọn được cho dự án — chỉ id + tên (không danh mục, không phòng).
 * Người tạo dự án / quản lý tất cả (xem tên nhóm của dự án `?projectId=` cũng cần quyền đổi nhóm của dự án đó).
 */
export const GET = handle(async (req) => {
  const u = await requireTasks(req);
  const { projectId } = parseQuery(req, z.object({ projectId: idNum.optional() }));
  const allowed = projectId ? await canPickZaloGroup(await loadProjectCtx(u, projectId)) : (await can(u, "tasks.createProject")) || (await can(u, "tasks.manageAll"));
  if (!allowed) throw forbidden();
  const rows = await prisma.zaloGroup.findMany({ select: { groupId: true, name: true }, orderBy: { discoveredAt: "asc" } });
  return json({ groups: rows.map((g) => ({ groupId: g.groupId, name: g.name ?? g.groupId })) });
});
