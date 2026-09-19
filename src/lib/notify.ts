/** Quy tắc nghiệp vụ chọn người nhận và dedupeKey cho các tin Zalo (PRD mục 7). */
import type { LeaveRequest } from "@prisma/client";
import { prisma } from "./db";
import { sendZaloMessage } from "./zalo-oa";
import { toVN, shouldSendLateReminder, vnTime, type DayPlan, type RequestLite } from "./attendance";
import { REQUEST_TYPE_LABEL, type RequestTypeT } from "./roles";
import { can } from "./permissions";

export const fmtDT = (d: Date) => toVN(d).toFormat("HH:mm dd/MM/yyyy");
export const fmtDate = (s: string) => s.split("-").reverse().join("/");

async function activeIdsByRole(role: string, exclude: number): Promise<number[]> {
  const rows = await prisma.employee.findMany({ where: { role, active: true, NOT: { id: exclude } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Người trong tuyến chỉ được tính nếu vai trò của họ còn quyền tương ứng trong ma trận. */
async function roleHas(role: string, cap: "requests.decide" | "attendance.executeCorrection") {
  return can({ role }, cap);
}

/**
 * Tuyến duyệt đơn theo vai trò người tạo (không ai tự duyệt đơn của mình):
 *  - Nhân viên → quản lý phòng; phòng chưa có quản lý → Nhân sự; không có Nhân sự → Quản trị.
 *  - Quản lý → Nhân sự; không có → Quản trị.
 *  - Nhân sự → Quản trị.
 *  - Quản trị → Quản trị khác; không có → Nhân sự.
 */
export async function approversFor(employeeId: number): Promise<number[]> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { role: true, department: { select: { managerId: true } } },
  });
  const chain = async (...roles: string[]) => {
    for (const r of roles) {
      if (!(await roleHas(r, "requests.decide"))) continue;
      const ids = await activeIdsByRole(r, employeeId);
      if (ids.length) return ids;
    }
    return [];
  };
  if (!emp) return chain("ADMIN");
  switch (emp.role) {
    case "ADMIN":
      return chain("ADMIN", "HR");
    case "HR":
      return chain("ADMIN");
    case "MANAGER":
      return chain("HR", "ADMIN");
    default: {
      const managerId = emp.department.managerId;
      if (managerId && managerId !== employeeId && (await roleHas("MANAGER", "requests.decide"))) {
        const m = await prisma.employee.findUnique({ where: { id: managerId }, select: { active: true } });
        if (m?.active) return [managerId];
      }
      return chain("HR", "ADMIN");
    }
  }
}

/** Người dùng có được duyệt đơn này không: có quyền `requests.decide`, không phải đơn của mình, và nằm trong tuyến duyệt (Quản trị luôn được). */
export async function canDecideRequest(user: { id: number; role: string }, req: { employeeId: number }): Promise<boolean> {
  if (!(await can(user, "requests.decide"))) return false;
  if (req.employeeId === user.id) {
    // Ngoại lệ duy nhất: Quản trị không còn ai khác để duyệt (không có Quản trị khác lẫn Nhân sự) — được tự duyệt, có ghi nhật ký.
    return user.role === "ADMIN" && (await approversFor(req.employeeId)).length === 0;
  }
  if (user.role === "ADMIN") return true;
  return (await approversFor(req.employeeId)).includes(user.id);
}

/**
 * Người thực hiện chấm tay cho đơn bổ sung công đã duyệt (bước 2):
 *  - Người tạo đơn là Nhân sự → Quản trị.
 *  - Còn lại → Nhân sự; không có Nhân sự → Quản trị.
 * Không ai tự chấm tay cho đơn của chính mình.
 */
export async function executorsFor(employeeId: number): Promise<number[]> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { role: true } });
  const roles = emp?.role === "HR" ? ["ADMIN"] : ["HR", "ADMIN"];
  for (const role of roles) {
    if (!(await roleHas(role, "attendance.executeCorrection"))) continue;
    const ids = await activeIdsByRole(role, employeeId);
    if (ids.length) return ids;
  }
  return [];
}

/** Người dùng có được chấm tay cho đơn bổ sung công này không (Quản trị luôn được, trừ đơn của chính mình). */
export async function canExecuteCorrection(user: { id: number; role: string }, req: { employeeId: number }): Promise<boolean> {
  if (req.employeeId === user.id) return false;
  if (!(await can(user, "attendance.executeCorrection"))) return false;
  if (user.role === "ADMIN") return true;
  return (await executorsFor(req.employeeId)).includes(user.id);
}

export const correctionText = (r: Pick<LeaveRequest, "correctionAt" | "correctionKind">) =>
  r.correctionAt ? `${r.correctionKind === "OUT" ? "giờ ra" : "giờ vào"} lúc ${fmtDT(r.correctionAt)}` : "";

export async function notifyRequestCreated(r: LeaveRequest) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { name: true, code: true } });
  const data = {
    requestId: r.id,
    employeeName: emp.name,
    employeeCode: emp.code,
    typeLabel: REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type,
    fromText: fmtDT(r.fromTime),
    toText: fmtDT(r.toTime),
    correctionText: correctionText(r),
    reason: r.reason,
  };
  const approvers = new Set(await approversFor(r.employeeId));
  const to = new Set(approvers);
  // Đơn bổ sung công: Nhân sự (người sẽ chấm tay) nhận tin ngay từ đầu — dạng "để biết", không phải "cần duyệt".
  if (r.type === "BO_SUNG_CONG") for (const id of await executorsFor(r.employeeId)) to.add(id);
  return Promise.all(
    [...to].map((toId) =>
      sendZaloMessage({
        toEmployeeId: toId,
        messageType: "REQUEST_CREATED",
        data: { ...data, fyi: !approvers.has(toId) },
        dedupeKey: `req-created:${r.id}:${toId}`,
      }),
    ),
  );
}

/** Đơn bổ sung công vừa được duyệt: báo người thực hiện chấm tay. */
export async function notifyCorrectionReady(r: LeaveRequest) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { name: true, code: true } });
  const data = { requestId: r.id, employeeName: emp.name, employeeCode: emp.code, correctionText: correctionText(r), reason: r.reason };
  return Promise.all(
    (await executorsFor(r.employeeId)).map((toId) =>
      sendZaloMessage({ toEmployeeId: toId, messageType: "CORRECTION_READY", data, dedupeKey: `corr-ready:${r.id}:${toId}` }),
    ),
  );
}

/** Đã chấm tay xong: báo nhân viên. */
export async function notifyCorrectionDone(r: LeaveRequest, executorName: string, time: Date) {
  return sendZaloMessage({
    toEmployeeId: r.employeeId,
    messageType: "CORRECTION_DONE",
    dedupeKey: `corr-done:${r.id}`,
    data: { requestId: r.id, executorName, timeText: fmtDT(time), kindText: r.correctionKind === "OUT" ? "giờ ra" : "giờ vào" },
  });
}

export async function notifyRequestDecided(r: LeaveRequest) {
  const approver = r.approverId ? await prisma.employee.findUnique({ where: { id: r.approverId }, select: { name: true } }) : null;
  return sendZaloMessage({
    toEmployeeId: r.employeeId,
    messageType: "REQUEST_DECIDED",
    dedupeKey: `req-decided:${r.id}`,
    data: {
      requestId: r.id,
      status: r.status,
      typeLabel: REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type,
      fromText: fmtDT(r.fromTime),
      toText: fmtDT(r.toTime),
      correctionText: correctionText(r),
      decisionNote: r.decisionNote,
      approverName: approver?.name ?? "",
    },
  });
}

export async function notifyLateIfNeeded(args: {
  employeeId: number;
  log: { type: string; isLate: boolean; lateMinutes: number; checkTime: Date; workDate: string };
  plan: DayPlan | null;
  requests: RequestLite[];
}) {
  const { log, plan } = args;
  if (log.type !== "IN" || !plan?.shift) return null;
  if (!shouldSendLateReminder(log.isLate, plan.workDate, plan.shift, args.requests)) return null;
  return sendZaloMessage({
    toEmployeeId: args.employeeId,
    messageType: "LATE_REMINDER",
    dedupeKey: `late:${args.employeeId}:${log.workDate}`,
    data: {
      timeText: vnTime(log.checkTime),
      dateText: fmtDate(log.workDate),
      lateMinutes: log.lateMinutes,
      shiftName: plan.shift.name,
    },
  });
}
