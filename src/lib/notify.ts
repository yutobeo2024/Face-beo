/** Quy tắc nghiệp vụ chọn người nhận và dedupeKey cho các tin Zalo (PRD mục 7). */
import type { LeaveRequest } from "@prisma/client";
import { prisma } from "./db";
import { sendZaloMessage } from "./zalo-oa";
import { toVN, shouldSendLateReminder, vnTime, type DayPlan, type RequestLite } from "./attendance";
import { REQUEST_TYPE_LABEL, type RequestTypeT } from "./roles";

export const fmtDT = (d: Date) => toVN(d).toFormat("HH:mm dd/MM/yyyy");
export const fmtDate = (s: string) => s.split("-").reverse().join("/");

/** Người duyệt đơn: quản lý phòng; không có hoặc chính là người tạo đơn => tất cả ADMIN. */
export async function approversFor(employeeId: number): Promise<number[]> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { department: { select: { managerId: true } } },
  });
  const managerId = emp?.department.managerId;
  if (managerId && managerId !== employeeId) {
    const m = await prisma.employee.findUnique({ where: { id: managerId }, select: { active: true } });
    if (m?.active) return [managerId];
  }
  const admins = await prisma.employee.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  return admins.map((a) => a.id).filter((id) => id !== employeeId);
}

/** Người được quyền duyệt đơn này không. */
export async function canDecideRequest(user: { id: number; role: string }, req: { employeeId: number }): Promise<boolean> {
  if (req.employeeId === user.id) return false;
  if (user.role === "ADMIN") return true;
  if (user.role !== "MANAGER") return false;
  return (await approversFor(req.employeeId)).includes(user.id);
}

export async function notifyRequestCreated(r: LeaveRequest) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { name: true, code: true } });
  const data = {
    requestId: r.id,
    employeeName: emp.name,
    employeeCode: emp.code,
    typeLabel: REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type,
    fromText: fmtDT(r.fromTime),
    toText: fmtDT(r.toTime),
    reason: r.reason,
  };
  const to = await approversFor(r.employeeId);
  return Promise.all(
    to.map((managerId) =>
      sendZaloMessage({ toEmployeeId: managerId, messageType: "REQUEST_CREATED", data, dedupeKey: `req-created:${r.id}:${managerId}` }),
    ),
  );
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
