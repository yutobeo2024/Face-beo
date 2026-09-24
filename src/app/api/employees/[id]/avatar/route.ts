import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { canSeeFaceAvatar, canViewSnapshots, clearFaceAvatar, readFaceAvatar } from "@/lib/face-avatar";

// Ảnh khuôn mặt là dữ liệu sinh trắc: giữ ngắn (1 phút) — vẫn cắt được hàng trăm lượt hỏi lại khi cuộn danh sách,
// nhưng mất quyền xem thì chậm nhất 1 phút là hết hiện. Ảnh tự chọn (không sinh trắc) giữ 10 phút.
const AVATAR_CACHE = "private, max-age=60";

/** Ảnh khuôn mặt đại diện (v1.10.0): chính chủ; Nhân sự / Quản trị; Quản lý chỉ nhân viên phòng mình (quyền xem snapshot). */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id }, select: { id: true, departmentId: true, faceAvatarKey: true } });
  const etag = `"${e?.faceAvatarKey ?? "none"}"`;
  if (!e) throw notFound();
  if (!canSeeFaceAvatar(u, e, u.id === e.id ? false : await canViewSnapshots(u))) throw forbidden();
  const buf = await readFaceAvatar(e.id, e.faceAvatarKey);
  if (!buf) {
    // DB còn trỏ tới ảnh nhưng file đã mất (xóa tay, khôi phục DB không kèm data/avatars…): dọn khóa để giao diện về chữ viết tắt.
    if (e.faceAvatarKey) await clearFaceAvatar(e.id);
    throw notFound("Chưa có ảnh đại diện");
  }
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": AVATAR_CACHE } });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      // v1.16.0: URL đã kèm ?v=<mốc thời gian> nên ảnh mới có URL mới → giữ 1 phút ở MÁY NGƯỜI DÙNG (private) thay vì hỏi lại
      // từng ảnh mỗi lần mở danh sách (~100 lượt mạng + 300 truy vấn).
      "Cache-Control": AVATAR_CACHE,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
