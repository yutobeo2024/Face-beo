/**
 * Ai được chấm công (v1.12.0). Ban Giám đốc / Quản trị có thể "không chấm công": không cảnh báo, không tin Zalo trễ / vắng / quên chấm,
 * không hiện ở Tổng quan, Chấm công, Báo cáo & Excel, Xếp ca, chốt công. Cấu hình:
 *   - Department.attendanceExempt = true → cả phòng không chấm công;
 *   - Employee.attendanceExempt: null = theo phòng · true = không chấm công · false = vẫn chấm công (dù phòng không chấm công).
 * Ghép TRACKED_WHERE bằng AND với bộ lọc phạm vi (không spread — xem CLAUDE.md).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const TRACKED_WHERE: Prisma.EmployeeWhereInput = {
  OR: [{ attendanceExempt: false }, { attendanceExempt: null, department: { attendanceExempt: false } }],
};

export type ExemptSource = "EMPLOYEE" | "DEPARTMENT" | null;

/** Hiệu lực + nguồn: người đặt riêng thắng cấu hình phòng. */
export function exemptInfo(e: { attendanceExempt: boolean | null; department: { attendanceExempt: boolean } }): { exempt: boolean; source: ExemptSource } {
  if (e.attendanceExempt === true) return { exempt: true, source: "EMPLOYEE" };
  if (e.attendanceExempt === false) return { exempt: false, source: null };
  return e.department.attendanceExempt ? { exempt: true, source: "DEPARTMENT" } : { exempt: false, source: null };
}

/**
 * Chống "lách" quyền: chỉ Quản trị được cho ai đó không chấm công. Người khác (Nhân sự, Quản lý có quyền quản lý nhân viên, nhập Excel)
 * tạo / chuyển người vào phòng "không chấm công" thì người đó được đặt RIÊNG là "vẫn chấm công" (false) — Quản trị muốn miễn thì tự đổi.
 * Trả về số người đã được giữ lại chấm công.
 */
export async function keepTrackedUnlessAdmin(actorRole: string, employeeIds: number[], db: Pick<typeof prisma, "employee"> = prisma): Promise<number> {
  if (actorRole === "ADMIN" || !employeeIds.length) return 0;
  const r = await db.employee.updateMany({
    where: { id: { in: employeeIds }, attendanceExempt: null, department: { attendanceExempt: true } },
    data: { attendanceExempt: false },
  });
  return r.count;
}
