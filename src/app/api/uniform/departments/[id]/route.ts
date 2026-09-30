import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { requirePerm } from "@/lib/permissions";

/**
 * Bật / tắt kiểm đồng phục cho một phòng. Tách khỏi PATCH /api/departments vì đường đó đòi quyền "Tổ chức",
 * trong khi việc này thuộc quyền "Đồng phục" (Nhân sự có, Quản lý thì không).
 *
 *   OFF    — không kiểm (mặc định)
 *   SHADOW — chạy thử: máy vẫn chấm điểm và lưu lại, nhưng KHÔNG gửi Zalo và không dùng để xử lý nhân sự
 *   ON     — kiểm thật
 */
const schema = z.object({ uniformMode: z.enum(["OFF", "SHADOW", "ON"]) });

const LABEL = { OFF: "tắt kiểm đồng phục", SHADOW: "cho chạy thử kiểm đồng phục", ON: "BẬT kiểm đồng phục" } as const;

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "uniform.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, schema);
  const d = await prisma.department.findUnique({ where: { id }, select: { id: true, name: true, uniformMode: true } });
  if (!d) throw notFound("Không có phòng ban này");
  if (!canManageDept(u, id)) throw forbidden("Ngoài phạm vi phòng ban của bạn");
  if (body.uniformMode === d.uniformMode) return json({ ok: true, uniformMode: d.uniformMode });

  // Chỉ chế độ BẬT mới đòi có mẫu áo đang dùng. CHẠY THỬ phải bật được khi chưa có mẫu áo nào, vì cách lấy ảnh mẫu
  // đúng nhất là lấy từ chính lượt chấm công — mà muốn có bản ghi để lấy thì phòng phải đang chạy thử trước.
  if (body.uniformMode === "ON") {
    const ready = await prisma.uniformTemplate.count({ where: { departmentId: id, active: true } });
    if (!ready) throw badRequest("Phòng chưa có mẫu áo nào đang bật — khai mẫu áo và bật lên trước đã");
  }

  await prisma.department.update({ where: { id }, data: { uniformMode: body.uniformMode } });
  await audit({ actorId: u.id, action: "UNIFORM_MODE", entity: "Department", entityId: id, detail: { from: d.uniformMode, to: body.uniformMode, name: d.name } });
  await announce(u, `đã ${LABEL[body.uniformMode]} cho phòng ${d.name}`, {
    key: `dept-uniform:${id}:${Date.now()}`,
    detail: body.uniformMode === "SHADOW" ? "Chế độ chạy thử: chỉ ghi nhận để hiệu chỉnh, không gửi tin và không dùng để xử lý nhân sự." : undefined,
    always: true,
  });
  return json({ ok: true, uniformMode: body.uniformMode });
});
