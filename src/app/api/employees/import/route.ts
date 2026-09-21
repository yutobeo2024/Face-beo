import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, HttpError, json, parseQuery } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { announce, onceKey } from "@/lib/announce";
import { BASE_SHIFTS } from "@/lib/bootstrap";
import {
  IMPORT_MAX_BYTES,
  ImportFileError,
  UNASSIGNED_DEPARTMENT,
  buildResultFile,
  commitImport,
  planImport,
  readImportFile,
  summarize,
  type ImportDefaults,
} from "@/lib/employee-import";

const query = z.object({
  mode: z.enum(["preview", "commit"]).default("preview"),
  // Mặc định cho ô trống của người MỚI (chọn trên màn hình nhập): phòng ("unassigned" = "Chưa phân phòng"), ca, mẫu tuần ("none").
  defaultDepartmentId: z.union([z.literal("unassigned"), z.coerce.number().int().positive()]).default("unassigned"),
  defaultShiftId: z.coerce.number().int().positive().optional(),
  defaultPatternId: z.union([z.literal("none"), z.coerce.number().int().positive()]).default("none"),
});

/**
 * Nhập nhân viên từ Excel. Body = file .xlsx thô (≤ 2 MB). mode=preview: chỉ kiểm tra, không ghi gì. mode=commit: kiểm lại từ đầu,
 * còn dòng lỗi thì 400 (không nhập dòng nào); hợp lệ thì nhập trong một giao dịch và trả file kết quả có mật khẩu tạm (base64, một lần).
 */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "employees.manage");
  if (!rateLimit(`emp-import:${u.id}`, 20).ok) throw new HttpError(429, "Thao tác quá nhanh — thử lại sau một phút");
  const q = parseQuery(req, query);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > IMPORT_MAX_BYTES) throw badRequest("File quá lớn (tối đa 2 MB)");

  // Kiểm mặc định tồn tại (phòng / ca / mẫu tuần); ca bỏ trống → "Hành chính", không có thì ca đầu tiên.
  const shift = q.defaultShiftId
    ? await prisma.shift.findUnique({ where: { id: q.defaultShiftId } })
    : ((await prisma.shift.findUnique({ where: { name: BASE_SHIFTS[0].name } })) ?? (await prisma.shift.findFirst({ orderBy: { id: "asc" } })));
  if (!shift) throw badRequest(q.defaultShiftId ? "Ca mặc định đã chọn không tồn tại" : "Chưa có ca làm việc nào — tạo ca trước (Cấu hình → Ca làm việc)");
  if (q.defaultDepartmentId !== "unassigned" && !(await prisma.department.findUnique({ where: { id: q.defaultDepartmentId } }))) throw badRequest("Phòng mặc định không tồn tại");
  if (q.defaultPatternId !== "none" && !(await prisma.workPattern.findUnique({ where: { id: q.defaultPatternId } }))) throw badRequest("Mẫu tuần mặc định không tồn tại");
  const defaults: ImportDefaults = { departmentId: q.defaultDepartmentId, shiftId: shift.id, patternId: q.defaultPatternId === "none" ? null : q.defaultPatternId };

  let rows;
  try {
    rows = await readImportFile(await req.arrayBuffer());
  } catch (e) {
    if (e instanceof ImportFileError) throw badRequest(e.message);
    throw e;
  }
  if (!rows.length) throw badRequest("File không có dòng dữ liệu nào (dòng 1 là tiêu đề)");
  const items = await planImport(rows, u, defaults);
  const summary = summarize(items);
  const defaultsText = {
    department: q.defaultDepartmentId === "unassigned" ? UNASSIGNED_DEPARTMENT : ((await prisma.department.findUnique({ where: { id: q.defaultDepartmentId } }))?.name ?? ""),
    shift: `${shift.name} ${shift.startTime}–${shift.endTime}`,
    pattern: q.defaultPatternId === "none" ? null : ((await prisma.workPattern.findUnique({ where: { id: q.defaultPatternId } }))?.name ?? null),
  };
  // Xem trước: không trả dữ liệu cá nhân thừa — chỉ mã, tên, hành động, lỗi/cảnh báo, trường thay đổi.
  const view = items.map((i) => ({ row: i.row, code: i.code, name: i.name, action: i.action, errors: i.errors, warnings: i.warnings, changes: i.changes }));
  if (q.mode === "preview") return json({ summary, items: view, defaults: defaultsText });

  if (summary.errors) throw badRequest(`Còn ${summary.errors} dòng lỗi — sửa file rồi nhập lại (chưa nhập dòng nào)`, { summary, items: view });
  if (!summary.create && !summary.update) throw badRequest("Không có dòng nào cần tạo hoặc cập nhật");
  const res = await commitImport(items, u);
  await announce(u, `đã NHẬP nhân viên từ Excel: tạo mới ${res.created}, cập nhật ${res.updated}`, {
    key: onceKey("emp-import", u.id),
    detail: res.created ? `Người mới: ${res.rows.filter((r) => r.tempPassword).map((r) => r.code).slice(0, 30).join(", ")}${res.created > 30 ? "…" : ""}` : undefined,
  });
  const file = await buildResultFile(res.rows);
  return json({ summary, created: res.created, updated: res.updated, resultFile: file.toString("base64") });
});
