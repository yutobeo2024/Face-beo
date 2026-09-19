import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { deptScope } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { dateStr } from "@/lib/validators";
import { startOfWeek } from "@/lib/attendance";

/** Lịch sử đăng ký / sửa ca của một tuần (trong phạm vi phòng ban của người xem). */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "roster.view");
  const { week } = parseQuery(req, z.object({ week: dateStr }));
  const monday = startOfWeek(week);
  const scope = deptScope(u);
  const rows = await prisma.auditLog.findMany({
    where: { action: { in: ["ROSTER_REGISTER", "ROSTER_CHANGE"] }, entity: "RosterWeek", entityId: { endsWith: `|${monday}` } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const actors = new Map(
    (await prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.actorId ?? 0) } }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e]),
  );
  const depts = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  return json({
    week: monday,
    items: rows
      .map((r) => {
        const deptId = Number((r.entityId ?? "").split("|")[0]);
        return { id: r.id, action: r.action, at: r.createdAt, deptId, department: depts.get(deptId) ?? "", actor: actors.get(r.actorId ?? 0) ?? null, detail: r.detail ? JSON.parse(r.detail) : null };
      })
      .filter((x) => scope === null || scope.includes(x.deptId)),
  });
});
