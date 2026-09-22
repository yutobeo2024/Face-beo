import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MAX_PHOTO_UPLOAD_BYTES, canEditProfilePhoto, canSeeProfilePhoto, clearProfilePhoto, clearStalePhoto, readProfilePhoto, saveProfilePhoto } from "@/lib/profile-photo";

type P = { id: string };
const TOO_BIG = "Ảnh quá lớn (tối đa 2 MB sau khi cắt)";

/** Đọc thân yêu cầu nhưng dừng ngay khi vượt giới hạn (không tin Content-Length, không đọc hết file lớn vào bộ nhớ). */
async function readLimited(req: Request, limit: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) throw badRequest(TOO_BIG);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw badRequest(TOO_BIG);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function load(id: number) {
  const e = await prisma.employee.findUnique({ where: { id }, select: { id: true, code: true, role: true, departmentId: true, active: true, photoKey: true } });
  if (!e) throw notFound();
  return e;
}

/** Ảnh đại diện tự chọn (v1.13.0) — ai xem được nhân viên đó. */
export const GET = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await load(await idParam(ctx));
  if (!canSeeProfilePhoto(u, e)) throw forbidden();
  if (!e.photoKey) throw notFound("Chưa có ảnh đại diện");
  const etag = `"${e.photoKey}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  const buf = await readProfilePhoto(e.id, e.photoKey);
  if (!buf) {
    await clearStalePhoto(e.id, e.photoKey); // DB trỏ tới file đã mất: dọn để giao diện về ảnh khuôn mặt / chữ viết tắt
    throw notFound("Chưa có ảnh đại diện");
  }
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-cache", ETag: etag, "X-Content-Type-Options": "nosniff" },
  });
});

/** Tải lên / thay ảnh (thân = ảnh đã cắt, JPEG / PNG / WebP ≤ 2 MB): chính chủ, Nhân sự / Quản trị (tài khoản HR/ADMIN khác: chỉ Quản trị). */
export const PUT = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await load(await idParam(ctx));
  if (!(await canEditProfilePhoto(u, e))) throw forbidden("Bạn không được đổi ảnh đại diện của người này");
  if (!e.active) throw badRequest("Nhân viên đã nghỉ việc — không đổi ảnh đại diện");
  const saved = await saveProfilePhoto(e.id, await readLimited(req, MAX_PHOTO_UPLOAD_BYTES));
  await audit({ actorId: u.id, action: "PHOTO_UPDATE", entity: "Employee", entityId: e.id, detail: { code: e.code, size: saved.size } });
  return json({ ok: true, photoUrl: `/api/employees/${e.id}/photo?v=${saved.at.getTime()}` });
});

/** Xóa ảnh tự chọn → quay về ảnh khuôn mặt lúc enroll (nếu có) hoặc chữ viết tắt. */
export const DELETE = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await load(await idParam(ctx));
  if (!(await canEditProfilePhoto(u, e))) throw forbidden("Bạn không được đổi ảnh đại diện của người này");
  if (e.photoKey) {
    await clearProfilePhoto(e.id);
    await audit({ actorId: u.id, action: "PHOTO_DELETE", entity: "Employee", entityId: e.id, detail: { code: e.code } });
  }
  return json({ ok: true });
});
