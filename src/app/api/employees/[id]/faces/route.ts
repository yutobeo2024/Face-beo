import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, HttpError, idParam, json, notFound, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { enrollSchema } from "@/lib/validators";
import { encryptDescriptor } from "@/lib/crypto";
import { getTemplates, invalidateFaceCache, matchAgainst } from "@/lib/face-matcher";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { FACE_MODEL_VERSION } from "@/lib/roles";

const MIN_ENROLL_FACE_PX = 200;

/** Enroll 5 mẫu. Không lưu ảnh, chỉ lưu embedding mã hóa AES-256-GCM. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const body = await parseJson(req, enrollSchema);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e || !e.active) throw notFound();
  if (!e.biometricConsentAt) throw forbidden("Nhân viên chưa đồng ý xử lý dữ liệu sinh trắc học");

  const poses = new Set(body.samples.map((s) => s.pose));
  if (poses.size !== 5) throw badRequest("Cần đủ 5 góc: thẳng, trái, phải, ngẩng, cúi");
  const small = body.samples.find((s) => s.faceSize < MIN_ENROLL_FACE_PX);
  if (small) throw badRequest(`Mẫu ${small.pose} có mặt nhỏ hơn ${MIN_ENROLL_FACE_PX}px`);
  const len = body.samples[0].descriptor.length;
  if (body.samples.some((s) => s.descriptor.length !== len)) throw badRequest("Độ dài embedding không đồng nhất");

  // Kiểm tra trùng với nhân viên khác.
  const settings = await getSettings();
  const entries = await getTemplates();
  let worst: { employeeId: number; score: number } | null = null;
  for (const s of body.samples) {
    const m = matchAgainst(entries, s.descriptor, settings.matchThreshold, 0, id);
    if (m.top1EmployeeId && m.top1 >= settings.matchThreshold && (!worst || m.top1 > worst.score)) {
      worst = { employeeId: m.top1EmployeeId, score: m.top1 };
    }
  }
  if (worst) {
    const other = await prisma.employee.findUnique({ where: { id: worst.employeeId }, select: { code: true, name: true } });
    await audit({
      actorId: u.id,
      action: "FACE_DUPLICATE_WARNING",
      entity: "Employee",
      entityId: id,
      detail: { otherEmployeeId: worst.employeeId, score: Math.round(worst.score * 1000) / 1000, forced: !!body.force },
    });
    if (!body.force) {
      throw new HttpError(409, `Khuôn mặt giống nhân viên ${other?.code} — ${other?.name} (điểm ${worst.score.toFixed(2)})`, {
        duplicate: { employeeId: worst.employeeId, code: other?.code, name: other?.name, score: worst.score },
      });
    }
  }

  await prisma.$transaction([
    prisma.faceTemplate.deleteMany({ where: { employeeId: id } }),
    ...body.samples.map((s) =>
      prisma.faceTemplate.create({
        data: { employeeId: id, descriptor: encryptDescriptor(s.descriptor), modelVersion: FACE_MODEL_VERSION, createdById: u.id },
      }),
    ),
  ]);
  invalidateFaceCache();
  await audit({ actorId: u.id, action: "FACE_ENROLL", entity: "Employee", entityId: id, detail: { samples: 5, modelVersion: FACE_MODEL_VERSION } });
  return json({ ok: true, count: 5, duplicateWarning: worst ? true : false });
});

/** Xóa mẫu khuôn mặt (nhân viên yêu cầu xóa). */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: id } });
  invalidateFaceCache();
  await audit({ actorId: u.id, action: "FACE_DELETE", entity: "Employee", entityId: id, detail: { count: del.count } });
  return json({ ok: true, deleted: del.count });
});
