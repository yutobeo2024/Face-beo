import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, HttpError, idParam, json, notFound, parseJson } from "@/lib/api";
import { enrollSchema } from "@/lib/validators";
import { encryptDescriptor } from "@/lib/crypto";
import { getTemplates, invalidateFaceCache, matchAgainst } from "@/lib/face-matcher";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { requirePerm } from "@/lib/permissions";
import { assertCanTouchBiometrics } from "@/lib/employee-guards";
import { announce, onceKey } from "@/lib/announce";
import { embedFromSnapshot, FaceInputError } from "@/lib/face-embed";
import { rateLimit } from "@/lib/rate-limit";
import { decodeJpegDataUrl } from "@/lib/storage";
import { clearFaceAvatar, saveFaceAvatar } from "@/lib/face-avatar";

const MIN_ENROLL_FACE_PX = 200;
/** 5 mẫu của cùng một người phải giống nhau ít nhất mức này (chống lẫn người khác vào khung lúc enroll). */
const MIN_SELF_CONSISTENCY = 0.4;
/** Giống nhân viên khác từ mức này trở lên => gần như chắc chắn cùng một người: chỉ Quản trị mới được ghi đè. */
const DUP_HARD_BLOCK = 0.65;

/** Enroll 5 mẫu: lưu embedding mã hóa AES-256-GCM + 1 ảnh đại diện nhỏ cắt từ mẫu nhìn thẳng (v1.10.0); 4 ảnh góc còn lại không lưu. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "faces.enroll");
  if (!rateLimit(`enroll:${u.id}`, 30).ok) throw new HttpError(429, "Quá nhiều lượt enroll, vui lòng chờ một phút");
  const id = await idParam(ctx);
  const body = await parseJson(req, enrollSchema);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e || !e.active) throw notFound();
  await assertCanTouchBiometrics(u, e);
  if (!e.biometricConsentAt) throw forbidden("Nhân viên chưa đồng ý xử lý dữ liệu sinh trắc học");

  const poses = new Set(body.samples.map((s) => s.pose));
  if (poses.size !== 5) throw badRequest("Cần đủ 5 góc: thẳng, trái, phải, ngẩng, cúi");
  const small = body.samples.find((s) => s.faceSize < MIN_ENROLL_FACE_PX);
  if (small) throw badRequest(`Mẫu ${small.pose} có mặt nhỏ hơn ${MIN_ENROLL_FACE_PX}px`);
  // Tính embedding trên server từ snapshot + điểm mốc.
  const descriptors: Float32Array[] = [];
  let frontJpeg: Buffer | null = null;
  for (const s of body.samples) {
    const jpeg = decodeJpegDataUrl(s.snapshot); // HttpError 400 nếu quá 1 MB / không phải JPEG
    if (s.pose === "FRONT") frontJpeg = jpeg;
    try {
      descriptors.push((await embedFromSnapshot(jpeg, s.landmarks)).embedding);
    } catch (e) {
      if (e instanceof FaceInputError) throw badRequest(`Mẫu ${s.pose}: ${e.message}`);
      if (e instanceof HttpError) throw e;
      throw new HttpError(503, `Máy chủ chưa sẵn sàng nhận diện khuôn mặt: ${(e as Error).message}`);
    }
  }
  // 5 mẫu phải là cùng một người.
  for (let i = 0; i < descriptors.length; i++)
    for (let j = i + 1; j < descriptors.length; j++) {
      let d = 0;
      for (let k = 0; k < descriptors[i].length; k++) d += descriptors[i][k] * descriptors[j][k];
      if (d < MIN_SELF_CONSISTENCY) throw badRequest(`Mẫu ${body.samples[i].pose} và ${body.samples[j].pose} không giống nhau — có thể lẫn người khác hoặc ảnh mờ, hãy chụp lại`);
    }

  // Kiểm tra trùng với nhân viên khác.
  const settings = await getSettings();
  const entries = await getTemplates();
  let worst: { employeeId: number; score: number } | null = null;
  for (const d of descriptors) {
    const m = matchAgainst(entries, d, settings.matchThreshold, 0, id);
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
    const hard = worst.score >= DUP_HARD_BLOCK && u.role !== "ADMIN";
    if (!body.force || hard) {
      throw new HttpError(
        409,
        hard
          ? `Khuôn mặt gần như trùng với nhân viên ${other?.code} — ${other?.name} (điểm ${worst.score.toFixed(2)}). Chỉ Quản trị mới được ghi đè.`
          : `Khuôn mặt giống nhân viên ${other?.code} — ${other?.name} (điểm ${worst.score.toFixed(2)})`,
        { duplicate: { employeeId: worst.employeeId, code: other?.code, name: other?.name, score: worst.score, hard } },
      );
    }
  }

  await prisma.$transaction([
    prisma.faceTemplate.deleteMany({ where: { employeeId: id } }),
    ...descriptors.map((d) =>
      prisma.faceTemplate.create({
        data: { employeeId: id, descriptor: encryptDescriptor(Array.from(d)), modelVersion: FACE_MODEL_VERSION, createdById: u.id },
      }),
    ),
  ]);
  invalidateFaceCache();
  // Ảnh đại diện từ mẫu nhìn thẳng — lỗi cắt ảnh không làm hỏng enroll (thẻ nhân viên hiện chữ viết tắt như trước).
  let avatar = false;
  const front = body.samples.find((s) => s.pose === "FRONT");
  if (frontJpeg && front) {
    try {
      await saveFaceAvatar(id, frontJpeg, front.landmarks);
      avatar = true;
    } catch (err) {
      console.error("[enroll] không tạo được ảnh đại diện:", (err as Error).message);
      await clearFaceAvatar(id).catch(() => {}); // ảnh cũ không còn khớp 5 mẫu mới
    }
  }
  await audit({ actorId: u.id, action: "FACE_ENROLL", entity: "Employee", entityId: id, detail: { samples: 5, modelVersion: FACE_MODEL_VERSION, avatar } });
  await announce(u, `đã enroll khuôn mặt cho ${e.code} — ${e.name}`, {
    key: onceKey("face-enroll", id),
    detail: worst ? "⚠️ Có cảnh báo trùng khuôn mặt với nhân viên khác (đã xác nhận vẫn lưu)" : "5 mẫu",
  });
  return json({ ok: true, count: 5, duplicateWarning: worst ? true : false, avatar });
});

/** Xóa mẫu khuôn mặt (nhân viên yêu cầu xóa). */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "faces.enroll");
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id }, select: { id: true, role: true, code: true, name: true, departmentId: true } });
  if (!e) throw notFound();
  await assertCanTouchBiometrics(u, e);
  const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: id } });
  await clearFaceAvatar(id);
  invalidateFaceCache();
  await audit({ actorId: u.id, action: "FACE_DELETE", entity: "Employee", entityId: id, detail: { count: del.count } });
  if (del.count) await announce(u, `đã xóa dữ liệu khuôn mặt của ${e.code} — ${e.name}`, { key: onceKey("face-delete", id) });
  return json({ ok: true, deleted: del.count });
});
