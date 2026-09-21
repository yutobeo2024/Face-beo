/** Quy tắc nghiệp vụ chọn người nhận và dedupeKey cho các tin Zalo (PRD mục 7). */
import type { LeaveRequest } from "@prisma/client";
import { prisma } from "./db";
import { sendZaloMessage } from "./zalo-oa";
import { announceStaff } from "./zalo-routing";
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

/** Quản lý phòng của nhân viên còn hiệu lực duyệt (đang làm, không phải chính người tạo đơn, vai trò Quản lý còn quyền duyệt). */
async function activeDeptManager(employeeId: number, managerId: number | null): Promise<number | null> {
  if (!managerId || managerId === employeeId || !(await roleHas("MANAGER", "requests.decide"))) return null;
  const m = await prisma.employee.findUnique({ where: { id: managerId }, select: { active: true } });
  return m?.active ? managerId : null;
}

/**
 * Tuyến duyệt đơn theo vai trò người tạo (không ai tự duyệt đơn của mình):
 *  - Nhân viên, phòng có quản lý: theo `Department.approvalMode` (v1.7.0)
 *      MANAGER_OR_HR — quản lý phòng HOẶC Nhân sự (ai duyệt trước cũng có hiệu lực);
 *      TWO_STEP — bước 1 quản lý phòng (đơn PENDING), bước 2 Nhân sự (đơn MANAGER_APPROVED);
 *      MANAGER_ONLY — chỉ quản lý phòng.
 *    Phòng chưa có quản lý → Nhân sự; không có Nhân sự → Quản trị.
 *  - Quản lý → Nhân sự; không có → Quản trị.
 *  - Nhân sự → Quản trị.
 *  - Quản trị → Quản trị khác; không có → Nhân sự.
 * `status` = trạng thái hiện tại của đơn (mặc định PENDING — đơn mới tạo).
 */
export async function approversFor(employeeId: number, status: string = "PENDING"): Promise<number[]> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { role: true, department: { select: { managerId: true, approvalMode: true } } },
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
      // Đơn đã qua bước 1 (trưởng phòng duyệt) luôn chờ Nhân sự — kể cả khi phòng đã đổi cách duyệt hoặc đổi/gỡ quản lý giữa chừng.
      if (status === "MANAGER_APPROVED") return chain("HR", "ADMIN");
      const managerId = await activeDeptManager(employeeId, emp.department.managerId);
      if (!managerId) return chain("HR", "ADMIN");
      switch (emp.department.approvalMode) {
        case "MANAGER_ONLY":
          return [managerId];
        case "TWO_STEP":
          return [managerId];
        default:
          return [...new Set([managerId, ...(await chain("HR", "ADMIN"))])];
      }
    }
  }
}

/**
 * Lần duyệt này chỉ là BƯỚC 1 (trưởng phòng) của phòng duyệt 2 bước? Đúng khi: phòng TWO_STEP, đơn đang PENDING của Nhân viên,
 * người duyệt chính là quản lý phòng đó và không phải Nhân sự/Quản trị (Nhân sự/Quản trị duyệt là quyết định cuối).
 */
export async function isManagerStep(user: { id: number; role: string }, req: { employeeId: number; status: string }): Promise<boolean> {
  if (req.status !== "PENDING" || user.role === "HR" || user.role === "ADMIN") return false;
  const emp = await prisma.employee.findUnique({
    where: { id: req.employeeId },
    select: { role: true, department: { select: { managerId: true, approvalMode: true } } },
  });
  if (!emp || emp.role !== "EMPLOYEE" || emp.department.approvalMode !== "TWO_STEP") return false;
  return (await activeDeptManager(req.employeeId, emp.department.managerId)) === user.id;
}

/**
 * Người dùng có được duyệt đơn này không: có quyền `requests.decide`, không phải đơn của mình, và nằm trong tuyến duyệt ứng với
 * trạng thái hiện tại của đơn (Quản trị luôn được). `status` bỏ trống = PENDING.
 */
export async function canDecideRequest(user: { id: number; role: string }, req: { employeeId: number; status?: string }): Promise<boolean> {
  if (!(await can(user, "requests.decide"))) return false;
  if (req.employeeId === user.id) {
    // Ngoại lệ duy nhất: Quản trị không còn ai khác để duyệt (không có Quản trị khác lẫn Nhân sự) — được tự duyệt, có ghi nhật ký.
    return user.role === "ADMIN" && (await approversFor(req.employeeId, req.status)).length === 0;
  }
  if (user.role === "ADMIN") return true;
  return (await approversFor(req.employeeId, req.status)).includes(user.id);
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

/** "Nghỉ phép 08:00 22/09/2026 → 17:00 22/09/2026" / "Bổ sung công — giờ ra lúc …": dùng cho tin nhóm nhân viên (không lý do). */
function requestSummary(r: LeaveRequest) {
  const type = REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type;
  return r.correctionAt ? `${type} — ${correctionText(r)}` : `${type} ${fmtDT(r.fromTime)} → ${fmtDT(r.toTime)}`;
}

async function namesOf(ids: number[]) {
  const rows = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => r.name).join(", ");
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
    correctionText: correctionText(r),
    reason: r.reason,
  };
  const approvers = new Set(await approversFor(r.employeeId));
  const approverNames = await namesOf([...approvers]);
  await announceStaff({
    category: "DON_TU",
    employeeId: r.employeeId,
    icon: "📝",
    text: `Đã gửi đơn #${r.id}: ${requestSummary(r)}\nĐang chờ ${approverNames || "người duyệt"} duyệt`,
    key: `req-created:${r.id}`,
  });
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

/** Trưởng phòng đã duyệt bước 1 (phòng duyệt 2 bước): báo Nhân sự (bước 2) + nhóm đơn từ. */
export async function notifyManagerApproved(r: LeaveRequest) {
  const [emp, manager] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { name: true, code: true } }),
    r.managerApproverId ? prisma.employee.findUnique({ where: { id: r.managerApproverId }, select: { name: true } }) : null,
  ]);
  const hr = await approversFor(r.employeeId, "MANAGER_APPROVED");
  await announceStaff({
    category: "DON_TU",
    employeeId: r.employeeId,
    icon: "☑️",
    text: `Đơn #${r.id} ${requestSummary(r)} đã được trưởng phòng ${manager?.name ?? ""} duyệt\nĐang chờ ${(await namesOf(hr)) || "Nhân sự"} duyệt`,
    key: `req-mgr:${r.id}`,
  });
  const data = {
    requestId: r.id,
    employeeName: emp.name,
    employeeCode: emp.code,
    typeLabel: REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type,
    fromText: fmtDT(r.fromTime),
    toText: fmtDT(r.toTime),
    correctionText: correctionText(r),
    reason: r.reason,
    managerName: manager?.name ?? "",
    managerNote: r.managerNote ?? "",
  };
  return Promise.all(hr.map((toId) => sendZaloMessage({ toEmployeeId: toId, messageType: "REQUEST_STAGE2", data, dedupeKey: `req-stage2:${r.id}:${toId}` })));
}

/** Nhân viên tự hủy đơn đang chờ: báo nhóm đơn từ (để tin "đang chờ duyệt" trước đó không treo). */
export async function notifyRequestCancelled(r: LeaveRequest) {
  await announceStaff({ category: "DON_TU", employeeId: r.employeeId, icon: "↩️", text: `Đã tự hủy đơn #${r.id}: ${requestSummary(r)}`, key: `req-cancelled:${r.id}` });
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
  await announceStaff({
    category: "DON_TU",
    employeeId: r.employeeId,
    icon: "🛠️",
    text: `Đơn bổ sung công #${r.id} đã được ${executorName} chấm tay: ${r.correctionKind === "OUT" ? "giờ ra" : "giờ vào"} lúc ${fmtDT(time)}`,
    key: `corr-done:${r.id}`,
  });
  return sendZaloMessage({
    toEmployeeId: r.employeeId,
    messageType: "CORRECTION_DONE",
    dedupeKey: `corr-done:${r.id}`,
    data: { requestId: r.id, executorName, timeText: fmtDT(time), kindText: r.correctionKind === "OUT" ? "giờ ra" : "giờ vào" },
  });
}

export async function notifyRequestDecided(r: LeaveRequest) {
  const approver = r.approverId ? await prisma.employee.findUnique({ where: { id: r.approverId }, select: { name: true } }) : null;
  // Tin nhóm: chỉ trạng thái — không kèm ghi chú duyệt/từ chối (có thể là chuyện riêng).
  await announceStaff({
    category: "DON_TU",
    employeeId: r.employeeId,
    icon: r.status === "APPROVED" ? "✅" : "❌",
    text: `Đơn #${r.id} ${requestSummary(r)} ${r.status === "APPROVED" ? "đã được DUYỆT" : "bị TỪ CHỐI"}${approver ? ` bởi ${approver.name}` : ""}`,
    key: `req-decided:${r.id}`,
  });
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
