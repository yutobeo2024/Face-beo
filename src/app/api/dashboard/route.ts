import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { optId } from "@/lib/validators";
import { summarizeRange } from "@/lib/attendance-service";
import { todayVN, vnTime } from "@/lib/attendance";
import { getZaloRefreshError, isZaloSimulated } from "@/lib/zalo-token";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { can, requirePerm } from "@/lib/permissions";

/** Dashboard hôm nay (PRD mục 5): 5 thẻ + danh sách trễ/vắng; MANAGER chỉ thấy phòng mình. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "dashboard.view");
  const q = parseQuery(req, z.object({ departmentId: optId }));
  const [seeSuspicious, seeSystem] = await Promise.all([can(u, "suspicious.view"), can(u, "settings.system")]);
  const today = todayVN();
  const emps = await prisma.employee.findMany({
    where: { ...employeeScopeWhere(u, q.departmentId), active: true },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      departmentId: true,
      department: { select: { name: true } },
      faceTemplates: { where: { modelVersion: FACE_MODEL_VERSION }, select: { id: true }, take: 1 },
    },
  });
  const now = new Date();
  const { summaries } = await summarizeRange(emps.map((e) => e.id), today, today, now);
  const counts = { ON_TIME: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, NOT_YET: 0 };
  const late = [];
  const absent = [];
  const manual = [];
  let scheduled = 0;
  for (const e of emps) {
    const s = summaries.get(`${e.id}|${today}`)!;
    if (s.shift) scheduled++;
    if (s.status in counts) counts[s.status as keyof typeof counts]++;
    const base = { id: e.id, code: e.code, name: e.name, department: e.department.name, shift: s.shift ? `${s.shift.name} ${s.shift.startTime}` : null };
    if (s.status === "LATE") late.push({ ...base, inTime: s.inTime ? vnTime(s.inTime) : null, lateMinutes: s.lateMinutes });
    if (s.status === "ABSENT") absent.push({ ...base, pendingLeave: s.pendingLeave, enrolled: e.faceTemplates.length > 0 });
    if (s.shift && e.faceTemplates.length === 0) manual.push({ ...base, status: s.status });
  }
  const [pendingRequests, suspicious, l2Down] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: "PENDING", employee: employeeScopeWhere(u, q.departmentId), employeeId: { not: u.id } } }),
    seeSuspicious
      ? prisma.auditLog.count({ where: { action: "SCAN_SPOOF_REJECTED", createdAt: { gte: new Date(now.getTime() - 86_400_000) } } })
      : Promise.resolve(0),
    seeSystem
      ? prisma.auditLog.findFirst({ where: { action: "LIVENESS_L2_UNAVAILABLE", createdAt: { gte: new Date(now.getTime() - 3600_000) } }, orderBy: { createdAt: "desc" } })
      : Promise.resolve(null),
  ]);
  return json({
    date: today,
    updatedAt: now.toISOString(),
    totalEmployees: emps.length,
    scheduled,
    counts,
    late,
    absent,
    manual,
    pendingRequests,
    suspicious24h: suspicious,
    l2Error: l2Down ? { at: l2Down.createdAt, detail: l2Down.detail } : null,
    zalo: seeSystem ? { simulated: isZaloSimulated(), refreshError: await getZaloRefreshError() } : null,
  });
});
