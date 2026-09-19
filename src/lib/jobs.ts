/** Các job nền (PRD mục 8). Mọi job đều idempotent. */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { addDays, decideAbsence, shiftInterval, summarizeDay, TZ, vnDate, vnTime } from "./attendance";
import { buildPlanner, loadRequests } from "./attendance-service";
import { getSettings } from "./settings";
import { sendZaloMessage } from "./zalo-oa";
import { isZaloSimulated, refreshZaloToken } from "./zalo-token";
import { approversFor, correctionText, executorsFor, fmtDate, fmtDT } from "./notify";
import { REQUEST_TYPE_LABEL, type RequestTypeT } from "./roles";
import { audit } from "./audit";
import { dataDir, snapshotDir } from "./storage";
import { FACE_MODEL_VERSION } from "./roles";
import { invalidateFaceCache } from "./face-matcher";
import { announceSystem } from "./announce";
import { lockedMonths } from "./payroll-lock-state";
import { can } from "./permissions";
import { startOfWeek } from "./attendance";

export const JOBS = ["absence-check", "missing-checkout", "zalo-token-refresh", "snapshot-cleanup", "db-backup", "roster-reminder", "roster-report", "request-overdue"] as const;
export type JobName = (typeof JOBS)[number];

type DigestItem = { name: string; code: string; note?: string };

export async function absenceCheck(now = new Date()) {
  const settings = await getSettings();
  const today = vnDate(now);
  const yesterday = addDays(today, -1);
  const emps = await prisma.employee.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      code: true,
      departmentId: true,
      department: { select: { name: true } },
      faceTemplates: { where: { modelVersion: FACE_MODEL_VERSION }, select: { id: true }, take: 1 },
    },
  });
  if (!emps.length) return { warned: 0, digests: 0 };
  const ids = emps.map((e) => e.id);
  const planner = await buildPlanner(ids, yesterday, today);
  const requests = await loadRequests(ids, new Date(now.getTime() - 36 * 3600_000), new Date(now.getTime() + 24 * 3600_000));
  const ins = await prisma.attendanceLog.findMany({
    where: { employeeId: { in: ids }, workDate: { in: [yesterday, today] }, shiftId: { not: null } },
    select: { employeeId: true, workDate: true },
  });
  const hasIn = new Set(ins.map((l) => `${l.employeeId}|${l.workDate}`));

  let warned = 0;
  const digests = new Map<string, { deptId: number; deptName: string; workDate: string; shiftId: number; shiftName: string; items: DigestItem[] }>();

  for (const e of emps) {
    for (const d of [yesterday, today]) {
      const plan = planner.planFor(e.id, d);
      const reqs = requests.filter((r) => r.employeeId === e.id);
      const decision = decideAbsence({
        plan,
        hasIn: hasIn.has(`${e.id}|${d}`),
        enrolled: e.faceTemplates.length > 0,
        requests: reqs,
        now,
        absentAfterMinutes: settings.absentAfterMinutes,
      });
      if (decision.action === "SKIP" || !plan.shift) continue;
      const key = `${e.departmentId}|${d}|${plan.shift.id}`;
      if (!digests.has(key)) {
        digests.set(key, { deptId: e.departmentId, deptName: e.department.name, workDate: d, shiftId: plan.shift.id, shiftName: plan.shift.name, items: [] });
      }
      digests.get(key)!.items.push({ name: e.name, code: e.code, note: decision.action === "DIGEST_ONLY" ? "đơn chờ duyệt" : undefined });
      if (decision.action === "WARN") {
        const r = await sendZaloMessage({
          toEmployeeId: e.id,
          messageType: "ABSENT_WARNING",
          dedupeKey: `absent:${e.id}:${d}`,
          data: { shiftName: plan.shift.name, dateText: fmtDate(d), startText: vnTime(shiftInterval(d, plan.shift).start) },
        });
        if (r.status !== "DUPLICATE") warned++;
      }
    }
  }

  let digestCount = 0;
  for (const dg of digests.values()) {
    const dept = await prisma.department.findUnique({ where: { id: dg.deptId }, select: { managerId: true } });
    const recipients = dept?.managerId ? [dept.managerId] : await approversFor(-1);
    for (const to of recipients) {
      const suffix = dept?.managerId ? "" : `:${to}`;
      const r = await sendZaloMessage({
        toEmployeeId: to,
        messageType: "ABSENT_DIGEST",
        dedupeKey: `absent-digest:${dg.deptId}:${dg.workDate}:${dg.shiftId}${suffix}`,
        data: { departmentName: dg.deptName, dateText: fmtDate(dg.workDate), shiftName: dg.shiftName, items: dg.items },
      });
      if (r.status !== "DUPLICATE") digestCount++;
    }
  }
  return { warned, digests: digestCount };
}

/** Gắn cờ "thiếu giờ ra": ghi AuditLog một lần cho mỗi (nhân viên, ngày công). Cờ cũng được tính động ở báo cáo. */
export async function missingCheckout(now = new Date()) {
  const today = vnDate(now);
  const from = addDays(today, -2);
  const logs = await prisma.attendanceLog.findMany({
    where: { workDate: { gte: from, lte: today }, shiftId: { not: null } },
    orderBy: { checkTime: "asc" },
  });
  const by = new Map<string, typeof logs>();
  for (const l of logs) {
    const k = `${l.employeeId}|${l.workDate}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(l);
  }
  const ids = [...new Set(logs.map((l) => l.employeeId))];
  if (!ids.length) return { flagged: 0 };
  const planner = await buildPlanner(ids, from, today);
  let flagged = 0;
  for (const [k, group] of by) {
    const [id, d] = k.split("|");
    const plan = planner.planFor(Number(id), d);
    if (!plan.shift) continue;
    const s = summarizeDay({ plan, logs: group, requests: [], now });
    if (!s.missingOut) continue;
    const exists = await prisma.auditLog.findFirst({ where: { action: "MISSING_CHECKOUT", entityId: k } });
    if (exists) continue;
    await audit({ action: "MISSING_CHECKOUT", entity: "AttendanceDay", entityId: k, detail: { employeeId: Number(id), workDate: d } });
    // Nhắc nhân viên tạo đơn bổ sung công (link điền sẵn ngày).
    await sendZaloMessage({
      toEmployeeId: Number(id),
      messageType: "MISSING_OUT_NUDGE",
      dedupeKey: `missing-out:${k}`,
      data: { date: d, dateText: fmtDate(d), inText: s.inTime ? vnTime(s.inTime) : "", shiftName: plan.shift.name },
    });
    flagged++;
  }
  return { flagged };
}

export async function zaloTokenRefresh() {
  if (isZaloSimulated()) return { skipped: "simulation" };
  await refreshZaloToken(true);
  return { refreshed: true };
}

export async function snapshotCleanup(now = new Date()) {
  const settings = await getSettings();
  const cutoff = DateTime.fromJSDate(now, { zone: TZ }).minus({ days: settings.snapshotRetentionDays }).startOf("day");
  let removedDirs = 0;
  const root = snapshotDir();
  const years = await readdir(root).catch(() => [] as string[]);
  for (const y of years) {
    const months = await readdir(join(root, y)).catch(() => [] as string[]);
    for (const m of months) {
      const days = await readdir(join(root, y, m)).catch(() => [] as string[]);
      for (const d of days) {
        const dt = DateTime.fromISO(`${y}-${m}-${d}`, { zone: TZ });
        if (dt.isValid && dt < cutoff) {
          await rm(join(root, y, m, d), { recursive: true, force: true });
          removedDirs++;
        }
      }
      if (!(await readdir(join(root, y, m)).catch(() => [])).length) await rm(join(root, y, m), { recursive: true, force: true });
    }
  }
  const cleared = await prisma.attendanceLog.updateMany({
    where: { checkTime: { lt: cutoff.toJSDate() }, snapshotUrl: { not: null } },
    data: { snapshotUrl: null },
  });
  const pair = await prisma.kioskDevice.updateMany({
    where: { pairExpiresAt: { lt: now } },
    data: { pairCode: null, pairExpiresAt: null },
  });
  const links = await prisma.zaloLinkCode.deleteMany({ where: { expiresAt: { lt: now } } });
  // Nhân viên nghỉ việc: xóa template khuôn mặt (PRD mục 9, trong vòng 30 ngày).
  const faces = await prisma.faceTemplate.deleteMany({ where: { employee: { active: false } } });
  if (faces.count) invalidateFaceCache();
  return { removedDirs, clearedLogs: cleared.count, expiredPairCodes: pair.count, expiredLinkCodes: links.count, deletedTemplates: faces.count };
}

export async function dbBackup(now = new Date()) {
  const dir = join(dataDir(), "backups");
  await mkdir(dir, { recursive: true });
  // Một bản mỗi ngày: chạy lại trong ngày không tạo thêm file, không đẩy bản cũ ra khỏi cửa sổ 14 ngày.
  const name = `facebeo-${DateTime.fromJSDate(now, { zone: TZ }).toFormat("yyyyLLdd")}.db`;
  if ((await readdir(dir)).includes(name)) return { file: name, skipped: "đã có bản sao lưu hôm nay", removed: 0 };
  const target = join(dir, name).replace(/\\/g, "/").replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target}'`);
  const files = (await readdir(dir)).filter((f) => /^facebeo-\d{8}\.db$/.test(f)).sort();
  const old = files.slice(0, Math.max(0, files.length - 14));
  for (const f of old) await rm(join(dir, f), { force: true });
  return { file: name, removed: old.length };
}

/** Các phòng có nhân viên xoay ca đang làm việc nhưng tuần `week` chưa đăng ký ca. */
async function unregisteredDepartments(week: string) {
  const rot = await prisma.employee.groupBy({ by: ["departmentId"], where: { active: true, scheduleType: "ROTATING" }, _count: true });
  if (!rot.length) return [];
  const reg = await prisma.rosterWeek.findMany({ where: { weekStart: week, status: "REGISTERED" }, select: { departmentId: true } });
  const done = new Set(reg.map((r) => r.departmentId));
  const depts = await prisma.department.findMany({ where: { id: { in: rot.map((r) => r.departmentId) } }, select: { id: true, name: true, manager: { select: { id: true, role: true, active: true } } } });
  return depts.filter((d) => !done.has(d.id)).map((d) => ({ ...d, rotatingCount: rot.find((r) => r.departmentId === d.id)!._count }));
}

/** Thứ Sáu 15:00: nhắc quản lý các phòng chưa đăng ký ca TUẦN SAU. */
export async function rosterReminder(now = new Date()) {
  const week = addDays(startOfWeek(vnDate(now)), 7);
  const pending = await unregisteredDepartments(week);
  let sent = 0;
  for (const d of pending) {
    // Quản lý phải còn làm việc và còn quyền xếp ca; nếu không, nhắc người duyệt dự phòng (HR/Quản trị).
    const m = d.manager;
    const to = m && m.active && (await can(m, "roster.edit")) ? [m.id] : await approversFor(-1);
    for (const id of to) {
      const r = await sendZaloMessage({
        toEmployeeId: id,
        messageType: "ROSTER_REMINDER",
        dedupeKey: `roster-remind:${d.id}:${week}:${id}`,
        data: { departmentName: d.name, rotatingCount: d.rotatingCount, week, weekText: `${fmtDate(week)}–${fmtDate(addDays(week, 6))}` },
      });
      if (r.status !== "DUPLICATE") sent++;
    }
  }
  return { week, pending: pending.length, sent };
}

/** Thứ Hai 07:00: báo Nhân sự + nhóm Zalo các phòng vẫn chưa đăng ký ca TUẦN NÀY. */
export async function rosterReport(now = new Date()) {
  const week = startOfWeek(vnDate(now));
  const pending = await unregisteredDepartments(week);
  if (!pending.length) return { week, pending: 0 };
  const data = {
    week,
    weekText: `${fmtDate(week)}–${fmtDate(addDays(week, 6))}`,
    count: pending.length,
    list: pending.map((d) => `• ${d.name} (${d.rotatingCount} người xoay ca)`).join("\n"),
  };
  const hrs = await prisma.employee.findMany({ where: { role: "HR", active: true }, select: { id: true } });
  for (const h of hrs) await sendZaloMessage({ toEmployeeId: h.id, messageType: "ROSTER_UNREGISTERED", dedupeKey: `roster-unreg:${week}:${h.id}`, data });
  await announceSystem(`báo: tuần ${data.weekText} còn ${pending.length} phòng CHƯA ĐĂNG KÝ ca`, { key: `roster-unreg:${week}`, detail: data.list });
  return { week, pending: pending.length };
}

const HOUR = 3_600_000;
export const OVERDUE_REMIND_HOURS = 24;
export const OVERDUE_ESCALATE_HOURS = 48;
/** Đơn bổ sung công chỉ được chấm tay trong vòng 7 ngày kể từ giờ cần bổ sung. */
export const MAX_EXECUTE_AGE_DAYS = 7;
export const OVERDUE_LOOKBACK_DAYS = 60;

/** Đơn bổ sung công đã duyệt còn chấm tay được không (trong cửa sổ 7 ngày, tháng chưa chốt). */
export function correctionStillExecutable(r: { correctionAt: Date | null }, locked: Set<string>, now = new Date()) {
  if (!r.correctionAt) return false;
  if (now.getTime() - r.correctionAt.getTime() > MAX_EXECUTE_AGE_DAYS * 86_400_000) return false;
  return !locked.has(vnDate(r.correctionAt).slice(0, 7));
}

/**
 * D3 — đơn chờ quá lâu (không bao giờ tự duyệt):
 *  - chờ duyệt (PENDING, tính từ lúc tạo) / chờ chấm tay (bổ sung công đã duyệt, tính từ lúc duyệt)
 *  - quá 24h: nhắc lại người phải xử lý; quá 48h: báo mọi Quản trị + nhóm Zalo. Mỗi mốc gửi một lần.
 */
export async function requestOverdue(now = new Date()) {
  const remindBefore = new Date(now.getTime() - OVERDUE_REMIND_HOURS * HOUR);
  const since = new Date(now.getTime() - OVERDUE_LOOKBACK_DAYS * 24 * HOUR); // bỏ qua đơn quá cũ
  const [pending, awaitingExec] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { status: "PENDING", createdAt: { lte: remindBefore, gte: since } }, include: { employee: { select: { name: true, code: true } } } }),
    prisma.leaveRequest.findMany({
      where: { type: "BO_SUNG_CONG", status: "APPROVED", executedAt: null, decidedAt: { lte: remindBefore, gte: since } },
      include: { employee: { select: { name: true, code: true } } },
    }),
  ]);
  const locked = await lockedMonths();
  const admins = (await prisma.employee.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } })).map((a) => a.id);
  const names = async (ids: number[]) =>
    (await prisma.employee.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((e) => e.name).join(", ");
  let reminded = 0;
  let escalated = 0;
  const items = [
    ...pending.map((r) => ({ r, stage: "duyệt", since: r.createdAt, key: "req", handlers: () => approversFor(r.employeeId) })),
    // Bổ sung công quá cửa sổ chấm tay / thuộc tháng đã chốt: không còn chấm được => không nhắc.
    ...awaitingExec
      .filter((r) => correctionStillExecutable(r, locked, now))
      .map((r) => ({ r, stage: "chấm tay", since: r.decidedAt!, key: "corr", handlers: () => executorsFor(r.employeeId) })),
  ];
  for (const it of items) {
    const { r } = it;
    const hours = Math.floor((now.getTime() - it.since.getTime()) / HOUR);
    const handlers = (await it.handlers()).filter((id) => id !== r.employeeId);
    const data = {
      requestId: r.id,
      stage: it.stage,
      hours,
      employeeName: r.employee.name,
      employeeCode: r.employee.code,
      typeLabel: REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type,
      timeText: r.type === "BO_SUNG_CONG" ? correctionText(r) : `${fmtDT(r.fromTime)} → ${fmtDT(r.toTime)}`,
    };
    for (const to of handlers) {
      const x = await sendZaloMessage({ toEmployeeId: to, messageType: "REQUEST_OVERDUE", dedupeKey: `${it.key}-overdue24:${r.id}:${to}`, data });
      if (x.status !== "DUPLICATE") reminded++;
    }
    if (hours >= OVERDUE_ESCALATE_HOURS) {
      const handlerNames = await names(handlers);
      for (const to of admins.filter((id) => id !== r.employeeId)) {
        const x = await sendZaloMessage({ toEmployeeId: to, messageType: "REQUEST_ESCALATED", dedupeKey: `${it.key}-overdue48:${r.id}:${to}`, data: { ...data, handlers: handlerNames } });
        if (x.status !== "DUPLICATE") escalated++;
      }
      await announceSystem(`báo: đơn #${r.id} của ${r.employee.name} chờ ${it.stage} đã quá ${OVERDUE_ESCALATE_HOURS} giờ`, {
        key: `${it.key}-overdue48:${r.id}`,
        detail: `${data.typeLabel}: ${data.timeText}\nNgười phải xử lý: ${handlerNames || "(không có)"}`,
      });
    }
  }
  return { pending: pending.length, awaitingExecution: awaitingExec.length, reminded, escalated };
}

export async function runJob(name: JobName, now = new Date()) {
  switch (name) {
    case "request-overdue":
      return requestOverdue(now);
    case "roster-reminder":
      return rosterReminder(now);
    case "roster-report":
      return rosterReport(now);
    case "absence-check":
      return absenceCheck(now);
    case "missing-checkout":
      return missingCheckout(now);
    case "zalo-token-refresh":
      return zaloTokenRefresh();
    case "snapshot-cleanup":
      return snapshotCleanup(now);
    case "db-backup":
      return dbBackup(now);
  }
}
