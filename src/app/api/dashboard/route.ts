import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { optId } from "@/lib/validators";
import { summarizeRange } from "@/lib/attendance-service";
import { addDays, startOfWeek, todayVN, vnTime } from "@/lib/attendance";
import { getZaloRefreshError, isZaloSimulated } from "@/lib/zalo-token";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { can, requirePerm } from "@/lib/permissions";
import { canDecideRequest, canExecuteCorrection } from "@/lib/notify";
import { correctionStillExecutable, OVERDUE_LOOKBACK_DAYS, OVERDUE_REMIND_HOURS } from "@/lib/jobs";
import { lockedMonths } from "@/lib/payroll-lock-state";

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
      faceTemplates: {
        where: { modelVersion: FACE_MODEL_VERSION },
        select: { id: true },
        take: 1,
      },
    },
  });
  const now = new Date();
  const { summaries } = await summarizeRange(
    emps.map((e) => e.id),
    today,
    today,
    now,
  );
  const counts = { ON_TIME: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, NOT_YET: 0 };
  const unscheduled: { id: number; code: string; name: string; department: string; shift: string | null }[] = [];
  const late = [];
  const absent = [];
  const manual = [];
  let scheduled = 0;
  for (const e of emps) {
    const s = summaries.get(`${e.id}|${today}`)!;
    if (s.shift) scheduled++;
    if (s.status in counts) counts[s.status as keyof typeof counts]++;
    const base = {
      id: e.id,
      code: e.code,
      name: e.name,
      department: e.department.name,
      shift: s.shift ? `${s.shift.name} ${s.shift.startTime}` : null,
    };
    if (s.status === "LATE")
      late.push({
        ...base,
        inTime: s.inTime ? vnTime(s.inTime) : null,
        lateMinutes: s.lateMinutes,
      });
    if (s.status === "ABSENT")
      absent.push({
        ...base,
        pendingLeave: s.pendingLeave,
        enrolled: e.faceTemplates.length > 0,
      });
    if (s.shift && e.faceTemplates.length === 0) manual.push({ ...base, status: s.status });
    if (s.status === "NO_SCHEDULE") unscheduled.push(base);
  }
  const overdueBefore = new Date(Date.now() - OVERDUE_REMIND_HOURS * 3_600_000);
  const overdueSince = new Date(Date.now() - OVERDUE_LOOKBACK_DAYS * 86_400_000);
  const locked = await lockedMonths();
  const [[pendingRequests, overduePending], overdueExec, suspicious, l2Down] = await Promise.all([
    prisma.leaveRequest
      .findMany({
        where: {
          status: "PENDING",
          employee: employeeScopeWhere(u, q.departmentId),
        },
        select: { employeeId: true, createdAt: true },
      })
      .then(async (rows) => {
        const memo = new Map<number, boolean>();
        let n = 0;
        let overdue = 0;
        for (const r of rows) {
          if (!memo.has(r.employeeId)) memo.set(r.employeeId, await canDecideRequest(u, r));
          if (!memo.get(r.employeeId)) continue;
          n++;
          if (r.createdAt <= overdueBefore && r.createdAt >= overdueSince) overdue++;
        }
        return [n, overdue] as const;
      }),
    // Đơn bổ sung công đã duyệt, chờ chấm tay quá 24 giờ mà người xem có quyền chấm.
    prisma.leaveRequest
      .findMany({
        where: {
          type: "BO_SUNG_CONG",
          status: "APPROVED",
          executedAt: null,
          decidedAt: { lte: overdueBefore, gte: overdueSince },
          employee: employeeScopeWhere(u, q.departmentId),
        },
        select: { employeeId: true, correctionAt: true },
      })
      .then(async (rows) => {
        const memo = new Map<number, boolean>();
        let n = 0;
        for (const r of rows) {
          if (!correctionStillExecutable(r, locked)) continue;
          if (!memo.has(r.employeeId)) memo.set(r.employeeId, await canExecuteCorrection(u, r));
          if (memo.get(r.employeeId)) n++;
        }
        return n;
      }),
    seeSuspicious
      ? prisma.auditLog.count({
          where: {
            action: "SCAN_SPOOF_REJECTED",
            createdAt: { gte: new Date(now.getTime() - 86_400_000) },
          },
        })
      : Promise.resolve(0),
    seeSystem
      ? prisma.auditLog.findFirst({
          where: {
            action: "LIVENESS_L2_UNAVAILABLE",
            createdAt: { gte: new Date(now.getTime() - 3600_000) },
          },
          orderBy: { createdAt: "desc" },
        })
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
    unscheduled,
    rosterWarnings: await rosterWarnings(emps.map((e) => e.departmentId), today),
    pendingRequests,
    overdueRequests: overduePending + overdueExec,
    suspicious24h: suspicious,
    l2Error: l2Down ? { at: l2Down.createdAt, detail: l2Down.detail } : null,
    zalo: seeSystem
      ? {
          simulated: isZaloSimulated(),
          refreshError: await getZaloRefreshError(),
        }
      : null,
  });
});

/** Phòng (trong phạm vi) có nhân viên xoay ca nhưng tuần này / tuần sau chưa đăng ký ca. */
async function rosterWarnings(deptIds: number[], today: string) {
  const scope = [...new Set(deptIds)];
  const rot = await prisma.employee.groupBy({ by: ["departmentId"], where: { active: true, scheduleType: "ROTATING", departmentId: { in: scope } }, _count: true });
  if (!rot.length) return [];
  const thisWeek = startOfWeek(today);
  const weeks = [thisWeek, addDays(thisWeek, 7)];
  const reg = await prisma.rosterWeek.findMany({ where: { weekStart: { in: weeks }, status: "REGISTERED" }, select: { departmentId: true, weekStart: true } });
  const done = new Set(reg.map((r) => `${r.departmentId}|${r.weekStart}`));
  const names = new Map((await prisma.department.findMany({ where: { id: { in: rot.map((r) => r.departmentId) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  return weeks
    .map((w) => ({ week: w, departments: rot.filter((r) => !done.has(`${r.departmentId}|${w}`)).map((r) => names.get(r.departmentId) ?? "") }))
    .filter((x) => x.departments.length);
}
