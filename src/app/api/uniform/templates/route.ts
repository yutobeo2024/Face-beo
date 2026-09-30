import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json } from "@/lib/api";
import { canManageDept, deptScope } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { requirePerm } from "@/lib/permissions";
import { MAX_TEMPLATES_PER_DEPT, templateWarning } from "@/lib/uniform-admin";

const createSchema = z.object({ departmentId: z.number().int().positive(), name: z.string().trim().min(1).max(60) });

/** GET: mẫu áo trong phạm vi phòng của người xem. Quản lý chỉ thấy phòng mình. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "uniform.view");
  const scope = deptScope(u);
  const rows = await prisma.uniformTemplate.findMany({
    where: scope === null ? {} : { departmentId: { in: scope } },
    orderBy: [{ departmentId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      departmentId: true,
      name: true,
      active: true,
      colorHex: true,
      colorHist: true,
      embedding: true,
      embedVersion: true,
      sampleCount: true,
      samples: { select: { id: true, kind: true, createdAt: true }, orderBy: { id: "asc" } },
    },
  });
  return json({
    templates: rows.map((t) => ({
      id: t.id,
      departmentId: t.departmentId,
      name: t.name,
      active: t.active,
      colorHex: t.colorHex,
      sampleCount: t.sampleCount,
      ready: !!t.colorHist,
      warning: templateWarning(t),
      samples: t.samples,
    })),
  });
});

/** POST: thêm mẫu áo cho một phòng. */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "uniform.manage");
  const body = await createSchema.parseAsync(await req.json()).catch(() => {
    throw badRequest("Dữ liệu không hợp lệ");
  });
  if (!canManageDept(u, body.departmentId)) throw badRequest("Không thuộc phạm vi phòng ban của bạn");
  const dept = await prisma.department.findUnique({ where: { id: body.departmentId }, select: { name: true } });
  if (!dept) throw badRequest("Không có phòng ban này");
  const count = await prisma.uniformTemplate.count({ where: { departmentId: body.departmentId } });
  if (count >= MAX_TEMPLATES_PER_DEPT) throw badRequest(`Mỗi phòng chỉ khai tối đa ${MAX_TEMPLATES_PER_DEPT} mẫu áo`);
  const dup = await prisma.uniformTemplate.findFirst({ where: { departmentId: body.departmentId, name: body.name } });
  if (dup) throw badRequest("Phòng này đã có mẫu áo cùng tên");

  const t = await prisma.uniformTemplate.create({
    // Chưa có ảnh mẫu thì chưa dùng được — bật lên sau khi tải ảnh.
    data: { departmentId: body.departmentId, name: body.name, active: false, createdById: u.id, updatedAt: new Date() },
  });
  await audit({ actorId: u.id, action: "UNIFORM_TEMPLATE", entity: "UniformTemplate", entityId: t.id, detail: { name: t.name, department: dept.name } });
  await announce(u, `đã thêm mẫu áo đồng phục "${t.name}" cho phòng ${dept.name}`, { key: `uniform-template:${t.id}`, always: true });
  return json({ template: { id: t.id, name: t.name, departmentId: t.departmentId } });
});
