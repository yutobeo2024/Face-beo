import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { canSeeFaceAvatar, canViewSnapshots, readFaceAvatar } from "@/lib/face-avatar";

/** Ảnh khuôn mặt đại diện (v1.10.0): chính chủ; Nhân sự / Quản trị; Quản lý chỉ nhân viên phòng mình (quyền xem snapshot). */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id }, select: { id: true, departmentId: true, faceAvatarKey: true } });
  const etag = `"${e?.faceAvatarKey ?? "none"}"`;
  if (!e) throw notFound();
  if (!canSeeFaceAvatar(u, e, u.id === e.id ? false : await canViewSnapshots(u))) throw forbidden();
  if (req.headers.get("if-none-match") === etag && e.faceAvatarKey) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  const buf = await readFaceAvatar(e.id, e.faceAvatarKey);
  if (!buf) throw notFound("Chưa có ảnh đại diện");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      // Luôn hỏi lại máy chủ (304 khi chưa đổi): ảnh bị xóa / hết quyền xem là ngừng hiện ngay, không nằm trong cache 24 giờ.
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
