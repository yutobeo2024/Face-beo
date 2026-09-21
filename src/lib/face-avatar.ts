/**
 * Ảnh khuôn mặt đại diện (v1.10.0): 1 ảnh nhìn thẳng lấy từ mẫu FRONT lúc enroll, cắt quanh khuôn mặt theo 5 điểm mốc, 256×256 JPEG,
 * bỏ EXIF. Lưu ở data/avatars/<employeeId>/<uuid>.jpg (ngoài public), xem qua /api/employees/[id]/avatar có kiểm quyền.
 * 4 ảnh góc còn lại không lưu. Xóa cùng lúc với mẫu khuôn mặt (xóa khuôn mặt, rút đồng ý, nghỉ việc, xóa tài khoản).
 * Người xem: chính chủ; hoặc có quyền `snapshots.view` trong phạm vi phòng (Nhân sự / Quản trị toàn công ty, Quản lý phòng mình).
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { dataDir } from "./storage";
import { canManageDept, type AuthUser } from "./auth";
import { can } from "./permissions";
import { MAX_SNAPSHOT_PIXELS } from "./face-embed";

export const AVATAR_SIZE = 256;
const avatarDir = (employeeId: number) => join(dataDir(), "avatars", String(employeeId));
const KEY_RE = /^[0-9a-f-]{36}\.jpg$/;

/**
 * Cắt khung vuông quanh khuôn mặt: tâm = trung điểm giữa mắt và miệng, cạnh ≈ 2,2 × khoảng cách mắt–miệng (tối thiểu 2,4 × khoảng cách
 * hai mắt), kẹp trong ảnh. Trả về JPEG 256×256.
 */
export async function cropFaceAvatar(jpeg: Buffer, landmarks: [number, number][]): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  // Điểm mốc ở hệ tọa độ pixel gốc (chưa xoay theo EXIF) — giống embedFromSnapshot: cắt trên ảnh gốc, KHÔNG .rotate().
  const meta = await sharp(jpeg, { failOn: "error", limitInputPixels: MAX_SNAPSHOT_PIXELS }).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) throw new Error("không đọc được kích thước ảnh");
  if (W * H > MAX_SNAPSHOT_PIXELS) throw new Error("ảnh quá lớn");
  if (landmarks.length !== 5 || !landmarks.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) throw new Error("điểm mốc không hợp lệ");
  const [le, re, , lm, rm2] = landmarks;
  const eye = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];
  const mouth = [(lm[0] + rm2[0]) / 2, (lm[1] + rm2[1]) / 2];
  const eyeMouth = Math.hypot(mouth[0] - eye[0], mouth[1] - eye[1]);
  const eyeDist = Math.hypot(re[0] - le[0], re[1] - le[1]);
  let side = Math.max(eyeMouth * 2.2, eyeDist * 2.4);
  side = Math.min(Math.round(side), W, H);
  if (side < 32) throw new Error("khuôn mặt quá nhỏ để làm ảnh đại diện");
  const cx = (eye[0] + mouth[0]) / 2, cy = (eye[1] + mouth[1]) / 2;
  const left = Math.min(Math.max(0, Math.round(cx - side / 2)), W - side);
  const top = Math.min(Math.max(0, Math.round(cy - side / 2)), H - side);
  // sharp mặc định không giữ metadata (EXIF, GPS) khi xuất.
  return sharp(jpeg, { failOn: "error", limitInputPixels: MAX_SNAPSHOT_PIXELS })
    .extract({ left, top, width: side, height: side })
    .resize(AVATAR_SIZE, AVATAR_SIZE)
    .jpeg({ quality: 80 })
    .toBuffer();
}

// Khóa theo nhân viên (ứng dụng chạy 1 tiến trình): hai lượt enroll lại cùng lúc không được xen kẽ ghi file / cập nhật DB / dọn file,
// nếu không lượt này có thể xóa file mà DB của lượt kia vừa trỏ tới.
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(employeeId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(employeeId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(employeeId, tail);
  void tail.then(() => {
    if (locks.get(employeeId) === tail) locks.delete(employeeId);
  });
  return run;
}

/** Lưu ảnh đại diện mới (thay ảnh cũ). Trả về key đã lưu. */
export async function saveFaceAvatar(employeeId: number, jpeg: Buffer, landmarks: [number, number][]): Promise<string> {
  const img = await cropFaceAvatar(jpeg, landmarks);
  return withLock(employeeId, () => storeAvatar(employeeId, img));
}

async function storeAvatar(employeeId: number, img: Buffer): Promise<string> {
  const key = `${randomUUID()}.jpg`;
  const dir = avatarDir(employeeId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), img);
  try {
    // Chỉ gắn ảnh khi người đó VẪN còn dữ liệu khuôn mặt hợp lệ (đang làm, còn đồng ý, còn mẫu) — tránh chạy đua với xóa khuôn mặt /
    // rút đồng ý / cho nghỉ việc xảy ra giữa lúc lưu mẫu và lúc lưu ảnh.
    const upd = await prisma.employee.updateMany({
      where: { id: employeeId, active: true, biometricConsentAt: { not: null }, faceTemplates: { some: {} } },
      data: { faceAvatarKey: key, faceAvatarAt: new Date() },
    });
    if (!upd.count) throw new Error("dữ liệu khuôn mặt đã bị xóa trong lúc lưu ảnh");
  } catch (err) {
    await rm(join(dir, key), { force: true });
    throw err;
  }
  // Dọn mọi file khác trong thư mục (ảnh cũ, và ảnh của lượt enroll chạy song song bị lượt này ghi đè) — chỉ giữ ảnh DB đang trỏ tới.
  const current = (await prisma.employee.findUnique({ where: { id: employeeId }, select: { faceAvatarKey: true } }))?.faceAvatarKey;
  for (const f of await readdir(dir).catch(() => [] as string[])) if (f !== current && KEY_RE.test(f)) await rm(join(dir, f), { force: true });
  return key;
}

/** Xóa ảnh đại diện (file + cột DB). Không ném lỗi khi không có ảnh. */
export async function clearFaceAvatar(employeeId: number, opts: { dbAlreadyGone?: boolean } = {}) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return;
  await withLock(employeeId, async () => {
    await rm(avatarDir(employeeId), { recursive: true, force: true });
    if (!opts.dbAlreadyGone) await prisma.employee.updateMany({ where: { id: employeeId, faceAvatarKey: { not: null } }, data: { faceAvatarKey: null, faceAvatarAt: null } });
  });
}

export async function readFaceAvatar(employeeId: number, key: string | null): Promise<Buffer | null> {
  if (!key || !KEY_RE.test(key)) return null;
  try {
    return await readFile(join(avatarDir(employeeId), key));
  } catch {
    return null;
  }
}

/** Người xem có được thấy ảnh khuôn mặt của nhân viên này không. `canSnapshots` truyền sẵn khi xét cả danh sách. */
export function canSeeFaceAvatar(u: AuthUser, e: { id: number; departmentId: number }, canSnapshots: boolean) {
  return u.id === e.id || (canSnapshots && canManageDept(u, e.departmentId));
}
export const canViewSnapshots = (u: AuthUser) => can(u, "snapshots.view");

/** URL ảnh (kèm phiên bản để trình duyệt tải lại khi enroll lại) hoặc null khi không có / không được xem. */
export function avatarUrlFor(u: AuthUser, e: { id: number; departmentId: number; faceAvatarKey: string | null; faceAvatarAt: Date | null }, canSnapshots: boolean) {
  if (!e.faceAvatarKey || !canSeeFaceAvatar(u, e, canSnapshots)) return null;
  return `/api/employees/${e.id}/avatar?v=${e.faceAvatarAt?.getTime() ?? 0}`;
}
