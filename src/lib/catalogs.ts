/**
 * Danh mục Chức danh / Chuyên khoa (v1.7.0): thuộc tính mô tả của nhân viên (Bác sĩ · Tai Mũi Họng, KTV · Siêu âm…),
 * KHÔNG ảnh hưởng phân quyền, duyệt đơn hay tính công. Dùng để hiển thị, lọc danh sách và thêm cột trong Excel.
 * Hai danh mục cùng cấu trúc nên dùng chung một bộ route handler.
 */
import { z } from "zod";
import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { badRequest, handle, idParam, json, notFound, parseJson } from "./api";
import { requireUser } from "./auth";
import { requirePerm } from "./permissions";
import { audit } from "./audit";

export type CatalogKind = "jobTitle" | "specialty";
export const CATALOG_LABEL: Record<CatalogKind, string> = { jobTitle: "Chức danh", specialty: "Chuyên khoa" };
const FK: Record<CatalogKind, "jobTitleId" | "specialtyId"> = { jobTitle: "jobTitleId", specialty: "specialtyId" };

// Chuẩn hóa dấu tiếng Việt về NFC (bàn phím Mac/Windows có thể gõ dạng tổ hợp NFD) để "Bác sĩ" gõ kiểu nào cũng là một.
const itemSchema = z.object({
  name: z.string().trim().min(2, "tối thiểu 2 ký tự").max(80, "tối đa 80 ký tự").transform((s) => s.normalize("NFC")),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
// PATCH: không .default() — trường không gửi thì giữ nguyên.
const patchSchema = itemSchema.partial();

type Row = { id: number; name: string; sortOrder: number };
// Hai model cùng hình dạng: gom lại một kiểu tối thiểu để dùng chung.
type Delegate = {
  findMany(args: object): Promise<(Row & { _count: { employees: number } })[]>;
  findUnique(args: { where: { id: number } | { name: string } }): Promise<Row | null>;
  create(args: { data: { name: string; sortOrder?: number } }): Promise<Row>;
  update(args: { where: { id: number }; data: { name?: string; sortOrder?: number } }): Promise<Row>;
  delete(args: { where: { id: number } }): Promise<Row>;
};
/** Hai thao tác cùng lúc (trùng tên, sửa/xóa mục vừa bị xóa) → lỗi rõ ràng thay vì 500. */
function mapPrismaError(e: unknown, label: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw badRequest(`${label} này đã tồn tại`);
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw notFound();
  throw e;
}

/** Trùng tên không phân biệt hoa/thường, dấu đã chuẩn hóa (danh mục nhỏ: so trong bộ nhớ). */
async function nameTaken(kind: CatalogKind, name: string, exceptId?: number) {
  const key = name.normalize("NFC").toLocaleLowerCase("vi");
  const rows = await delegate(kind).findMany({ select: { id: true, name: true } });
  return rows.some((r) => r.id !== exceptId && r.name.normalize("NFC").toLocaleLowerCase("vi") === key);
}

const delegate = (kind: CatalogKind) => (kind === "jobTitle" ? prisma.jobTitle : prisma.specialty) as unknown as Delegate;

/** Kiểm tra id chức danh / chuyên khoa gửi lên tồn tại (null/undefined = bỏ trống, hợp lệ). */
export async function assertCatalogIds(ids: { jobTitleId?: number | null; specialtyId?: number | null }, db: Pick<typeof prisma, "jobTitle" | "specialty"> = prisma) {
  if (ids.jobTitleId && !(await db.jobTitle.findUnique({ where: { id: ids.jobTitleId } }))) throw badRequest("Chức danh không tồn tại");
  if (ids.specialtyId && !(await db.specialty.findUnique({ where: { id: ids.specialtyId } }))) throw badRequest("Chuyên khoa không tồn tại");
}

export function catalogRoutes(kind: CatalogKind) {
  const label = CATALOG_LABEL[kind];
  const db = () => delegate(kind);
  return {
    /** Mọi người đăng nhập đều đọc được (dùng cho ô chọn / bộ lọc); kèm số nhân viên đang làm dùng mục đó. */
    list: handle(async (req) => {
      await requireUser(req);
      const rows = await db().findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { employees: true } } },
      });
      // Đếm cả người đã nghỉ việc: xóa mục sẽ để trống cho tất cả những người này.
      return json({ items: rows.map(({ _count, ...r }) => ({ ...r, employeeCount: _count.employees })) });
    }),
    create: handle(async (req) => {
      const u = await requirePerm(req, "org.manage");
      const body = await parseJson(req, itemSchema);
      if (await nameTaken(kind, body.name)) throw badRequest(`${label} "${body.name}" đã tồn tại`);
      const item = await db().create({ data: body }).catch((e) => mapPrismaError(e, label));
      await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: kind === "jobTitle" ? "JobTitle" : "Specialty", entityId: item.id, detail: { created: item.name } });
      return json({ item }, { status: 201 });
    }),
    update: handle<{ id: string }>(async (req, ctx) => {
      const u = await requirePerm(req, "org.manage");
      const id = await idParam(ctx);
      const body = await parseJson(req, patchSchema);
      const before = await db().findUnique({ where: { id } });
      if (!before) throw notFound();
      if (body.name && (await nameTaken(kind, body.name, id))) throw badRequest(`${label} "${body.name}" đã tồn tại`);
      const item = await db().update({ where: { id }, data: body }).catch((e) => mapPrismaError(e, label));
      await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: kind === "jobTitle" ? "JobTitle" : "Specialty", entityId: id, detail: { before, after: item } });
      return json({ item });
    }),
    /** Xóa: chỉ là nhãn mô tả nên được xóa kể cả đang dùng — nhân viên đang gắn mục này được để trống (báo số người trong phản hồi). */
    remove: handle<{ id: string }>(async (req, ctx) => {
      const u = await requirePerm(req, "org.manage");
      const id = await idParam(ctx);
      const before = await db().findUnique({ where: { id } });
      if (!before) throw notFound();
      const [detached] = await prisma
        .$transaction([
          prisma.employee.updateMany({ where: { [FK[kind]]: id }, data: { [FK[kind]]: null } }),
          kind === "jobTitle" ? prisma.jobTitle.delete({ where: { id } }) : prisma.specialty.delete({ where: { id } }),
        ])
        .catch((e) => mapPrismaError(e, label));
      await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: kind === "jobTitle" ? "JobTitle" : "Specialty", entityId: id, detail: { deleted: before.name, detached: detached.count } });
      return json({ ok: true, detached: detached.count });
    }),
  };
}
