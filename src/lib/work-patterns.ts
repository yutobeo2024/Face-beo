import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { todayVN } from "./attendance";
import { BASELINE_DATE, snapshotAssignment } from "./schedule-assignments";
import { badRequest } from "./api";

export const PATTERN_DAYS = ["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"] as const;
type DayKey = (typeof PATTERN_DAYS)[number];

const shiftRef = z.number().int().positive().nullable();
export const patternSchema = z.object({
  name: z.string().trim().min(2).max(60),
  monShiftId: shiftRef,
  tueShiftId: shiftRef,
  wedShiftId: shiftRef,
  thuShiftId: shiftRef,
  friShiftId: shiftRef,
  satShiftId: shiftRef,
  sunShiftId: shiftRef,
});

export async function assertShiftsExist(p: Partial<Record<DayKey, number | null>>) {
  const ids = [...new Set(PATTERN_DAYS.map((d) => p[d]).filter((v): v is number => typeof v === "number"))];
  if (!ids.length) return;
  if ((await prisma.shift.count({ where: { id: { in: ids } } })) !== ids.length) throw badRequest("Có ca không tồn tại trong mẫu tuần");
}

// ---------------------------------------------------------------------------------------------------------------------------
// v1.12.1 — Nhân viên ca cố định LUÔN theo một mẫu tuần có trong Cấu hình (không còn lựa chọn ẩn "ca mặc định, nghỉ Chủ nhật").
// Luồng nào lưu nhân viên cố định mà thiếu mẫu (API, nhập Excel, admin:create, dữ liệu cũ) thì gán mẫu TƯƠNG ĐƯƠNG với hành vi cũ:
// T2–T7 = ca mặc định, CN nghỉ — dùng lại mẫu có sẵn nếu trùng, không thì tạo "<tên ca> T2–T7". Lịch từng ngày không đổi.
type Db = Prisma.TransactionClient | typeof prisma;

/** Mẫu "T2–T7 = ca này, CN nghỉ": tìm hoặc tạo. */
export async function ensurePatternFor(shiftId: number, db: Db = prisma) {
  const same = { monShiftId: shiftId, tueShiftId: shiftId, wedShiftId: shiftId, thuShiftId: shiftId, friShiftId: shiftId, satShiftId: shiftId, sunShiftId: null };
  const found = await db.workPattern.findFirst({ where: same, orderBy: { id: "asc" } });
  if (found) return found;
  const shift = await db.shift.findUnique({ where: { id: shiftId }, select: { name: true } });
  if (!shift) throw badRequest("Ca mặc định không tồn tại");
  let name = `${shift.name} T2–T7`;
  for (let i = 2; await db.workPattern.findUnique({ where: { name } }); i++) name = `${shift.name} T2–T7 (${i})`;
  try {
    return await db.workPattern.create({ data: { name, ...same } });
  } catch (err) {
    // Hai lượt lưu cùng lúc cùng tạo mẫu: lượt sau dùng lại mẫu lượt trước vừa tạo (không 500).
    if ((err as { code?: string }).code === "P2002") {
      const again = await db.workPattern.findFirst({ where: same, orderBy: { id: "asc" } });
      if (again) return again;
    }
    throw err;
  }
}

/** Ca thứ Hai của mẫu (ca đầu tiên có trong tuần nếu thứ Hai nghỉ) — dùng làm ca mặc định cho nhân viên cố định. */
export async function firstShiftOf(patternId: number, db: Db = prisma): Promise<number | null> {
  const p = await db.workPattern.findUnique({ where: { id: patternId } });
  if (!p) return null;
  return p.monShiftId ?? p.tueShiftId ?? p.wedShiftId ?? p.thuShiftId ?? p.friShiftId ?? p.satShiftId ?? p.sunShiftId ?? null;
}

/**
 * Chuyển dữ liệu cũ: nhân viên ĐANG LÀM, ca cố định, chưa gán mẫu → gán mẫu tương đương, ghi lịch từ hôm nay (lịch sử giữ nguyên).
 * An toàn chạy nhiều lần (không còn ai thiếu mẫu thì không làm gì). Chạy khi khởi động máy chủ.
 */
export async function backfillFixedPatterns(db: typeof prisma = prisma) {
  const emps = await db.employee.findMany({ where: { active: true, scheduleType: "FIXED", workPatternId: null }, select: { id: true, code: true, defaultShiftId: true } });
  const done: { code: string; pattern: string }[] = [];
  for (const e of emps) {
    await db.$transaction(async (tx) => {
      // Chưa có lịch sử: chụp cấu hình hiện tại làm bản gốc trước, để các ngày đã qua vẫn tính như cũ.
      if (!(await tx.scheduleAssignment.count({ where: { employeeId: e.id } }))) await snapshotAssignment(e.id, BASELINE_DATE, tx);
      const p = await ensurePatternFor(e.defaultShiftId, tx);
      // Chỉ khi VẪN chưa có mẫu (Nhân sự có thể vừa chọn mẫu trong lúc máy chủ khởi động) — không ghi đè lựa chọn của người.
      const upd = await tx.employee.updateMany({ where: { id: e.id, workPatternId: null, scheduleType: "FIXED" }, data: { workPatternId: p.id } });
      if (!upd.count) return;
      await snapshotAssignment(e.id, todayVN(), tx);
      await tx.auditLog.create({
        data: { actorId: null, action: "PATTERN_UPDATE", entity: "Employee", entityId: String(e.id), detail: JSON.stringify({ reason: "v1.12.1: ca cố định luôn theo mẫu tuần", workPatternId: p.id, pattern: p.name }) },
      });
      done.push({ code: e.code, pattern: p.name });
    });
  }
  return done;
}
