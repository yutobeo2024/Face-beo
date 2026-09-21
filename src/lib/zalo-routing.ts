/**
 * Định tuyến tin nhóm Zalo theo loại tin (v1.6.0). Mỗi nhóm (`ZaloGroup`) chọn loại tin nhận và phòng ban:
 *  - MINH_BACH: thao tác duyệt/sửa của Nhân sự/Quản trị, đăng ký/sửa ca, chốt công, cảnh báo hệ thống (announce()).
 *  - CHAM_CONG: nhân viên chưa chấm giờ vào, quên chấm giờ ra, vắng không phép.
 *  - DON_TU: nhân viên gửi đơn, đơn được duyệt/từ chối, bổ sung công đã chấm tay — chỉ trạng thái, không lý do/ghi chú.
 * Lọc phòng chỉ áp cho tin nhân viên (CHAM_CONG, DON_TU); mảng phòng rỗng = mọi phòng.
 * Không bao giờ ném lỗi — thông báo lỗi không được làm hỏng nghiệp vụ.
 */
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "./db";
import { TZ } from "./attendance";
import { sendZaloMessage } from "./zalo-oa";

export const ZALO_CATEGORIES = ["MINH_BACH", "CHAM_CONG", "DON_TU"] as const;
export type ZaloCategory = (typeof ZALO_CATEGORIES)[number];

export const ZALO_CATEGORY_INFO: Record<ZaloCategory, { label: string; desc: string }> = {
  MINH_BACH: { label: "Minh bạch (quản trị)", desc: "Duyệt/sửa của Nhân sự & Quản trị, đăng ký/sửa ca, chốt công, đơn quá 48 giờ — kèm lý do/ghi chú, chỉ dành cho nhóm quản lý" },
  CHAM_CONG: { label: "Chấm công nhân viên", desc: "Chưa chấm giờ vào, quên chấm giờ ra, vắng không phép" },
  DON_TU: { label: "Đơn từ nhân viên", desc: "Đã gửi đơn, đã duyệt/từ chối/hủy, đã chấm tay bổ sung công (không kèm lý do)" },
};

export const categoriesSchema = z.array(z.enum(ZALO_CATEGORIES)).max(ZALO_CATEGORIES.length);

function parseList<T>(raw: string, item: z.ZodType<T>): T[] {
  try {
    const r = z.array(item).safeParse(JSON.parse(raw));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

export const groupCategories = (raw: string) => parseList(raw, z.enum(ZALO_CATEGORIES));
export const groupDepartmentIds = (raw: string) => parseList(raw, z.number().int());

/** ID các nhóm nhận loại tin `category` (tin nhân viên: thêm lọc theo phòng của nhân viên). */
export async function groupsFor(category: ZaloCategory, departmentId?: number | null): Promise<string[]> {
  // Cột JSON lưu chuỗi: lọc thô bằng contains rồi parse lại cho chắc.
  const rows = await prisma.zaloGroup.findMany({ where: { categories: { contains: `"${category}"` } }, orderBy: { groupId: "asc" } });
  return rows
    .filter((g) => groupCategories(g.categories).includes(category))
    .filter((g) => {
      if (category === "MINH_BACH" || departmentId == null) return true;
      const depts = groupDepartmentIds(g.departmentIds);
      return depts.length === 0 || depts.includes(departmentId);
    })
    .map((g) => g.groupId);
}

/**
 * Khóa dedupe cho tin minh bạch gửi tới `groupId`: "đã gửi" tính THEO NHÓM — nhóm này đã nhận khóa gốc `grp:…` (dữ liệu cũ / lần đầu)
 * hoặc `grp:…@groupId` thì trả null (bỏ qua). Chưa ai dùng khóa gốc → dùng khóa gốc (tương thích); đã có (nhóm khác, hoặc bản ghi
 * "chưa cấu hình nhóm") → thêm `@groupId`. Nhờ vậy thêm/bớt nhóm giữa hai lần chạy job không làm nhóm cũ nhận lặp, nhóm mới vẫn nhận.
 * Tin nhân viên (`staff:…`) luôn dùng `@groupId`.
 */
export async function groupDedupeKey(base: string, groupId: string): Promise<string | null> {
  const rows = await prisma.notificationLog.findMany({ where: { dedupeKey: { in: [base, `${base}@${groupId}`] } }, select: { dedupeKey: true, toGroupId: true } });
  if (rows.some((r) => r.toGroupId === groupId)) return null;
  return rows.some((r) => r.dedupeKey === base) ? `${base}@${groupId}` : base;
}

export const nowText = () => DateTime.now().setZone(TZ).toFormat("HH:mm dd/MM/yyyy");

/** Tin về một nhân viên vào các nhóm nhận `category` (lọc theo phòng hiện tại của nhân viên). Không có nhóm → không làm gì. */
export async function announceStaff(args: { category: Exclude<ZaloCategory, "MINH_BACH">; employeeId: number; icon: string; text: string; key: string }) {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: args.employeeId },
      select: { name: true, code: true, active: true, departmentId: true, department: { select: { name: true } } },
    });
    if (!emp?.active) return; // người đã nghỉ việc: không báo nhóm
    const groups = await groupsFor(args.category, emp.departmentId);
    for (const groupId of groups) {
      await sendZaloMessage({
        toGroupId: groupId,
        messageType: "GROUP_STAFF",
        dedupeKey: `staff:${args.key}@${groupId}`,
        data: { icon: args.icon, employeeName: emp.name, employeeCode: emp.code, departmentName: emp.department.name, text: args.text, atText: nowText() },
      });
    }
  } catch (e) {
    console.error("[announceStaff] lỗi:", (e as Error).message);
  }
}

/** Tách ID nhóm từ chuỗi dán vào: ID trần hoặc link chat OA (`https://oa.zalo.me/chat?gid=…&oaid=…`). */
export function parseGroupInput(input: string): { groupId: string } | { error: string } {
  const raw = input.trim();
  let id = raw;
  if (/^https?:\/\//i.test(raw) || raw.includes("gid=")) {
    const m = raw.match(/[?&]gid=([^&#\s]+)/);
    if (!m) return { error: "Link không có phần gid=… (ID nhóm). Mở nhóm trong OA Manager rồi chép link trên thanh địa chỉ." };
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return { error: "ID nhóm không hợp lệ" };
    }
  }
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(id)) return { error: "ID nhóm không hợp lệ" };
  if (/^\d+$/.test(id)) return { error: `"${id}" toàn chữ số — đây là ID của OA (oaid), không phải ID nhóm. ID nhóm là phần gid=… trong link chat, có lẫn chữ a–f.` };
  return { groupId: id };
}
