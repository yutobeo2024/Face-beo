/**
 * Ảnh đại diện tự chọn (v1.13.0): nhân viên tự tải lên (hoặc Nhân sự / Quản trị tải cho), cắt khung 3:4 trên trình duyệt; máy chủ kiểm
 * chữ ký file, mã hóa lại bằng sharp (bỏ EXIF / GPS), ép về 600×800 JPEG. KHÔNG dùng để nhận diện (không đụng mẫu khuôn mặt).
 * Lưu ở data/photos/<employeeId>/<uuid>.jpg (ngoài public). Hiển thị ưu tiên: ảnh tự chọn → ảnh khuôn mặt lúc enroll → chữ viết tắt.
 * Người xem: ai xem được nhân viên đó (chính chủ, Nhân sự / Quản trị, quản lý phòng). Xóa khi nghỉ việc / xóa tài khoản.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { badRequest } from "./api";
import { prisma } from "./db";
import { dataDir } from "./storage";
import { canManageDept, canViewEmployee, type AuthUser } from "./auth";
import { can } from "./permissions";
import { PRIVILEGED_ROLES } from "./roles";
import { avatarUrlFor } from "./face-avatar";

export const PHOTO_W = 600;
export const PHOTO_H = 800;
/** Ảnh gửi lên máy chủ (đã cắt trên trình duyệt). File gốc chọn trên máy giới hạn 5 MB ở giao diện. */
export const MAX_PHOTO_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 25_000_000;

const photoDir = (employeeId: number) => join(dataDir(), "photos", String(employeeId));
const KEY_RE = /^[0-9a-f-]{36}\.jpg$/;

export function sniffImage(buf: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 12 && String.fromCharCode(...buf.subarray(0, 4)) === "RIFF" && String.fromCharCode(...buf.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

/** Kiểm + chuẩn hóa: JPEG / PNG / WebP, ≤ 2 MB, ≤ 25 triệu điểm ảnh → 600×800 JPEG (cắt giữa nếu lệch tỉ lệ), không metadata. */
export async function normalizeProfilePhoto(buf: Uint8Array): Promise<Buffer> {
  if (!buf.length) throw badRequest("Chưa có ảnh");
  if (buf.length > MAX_PHOTO_UPLOAD_BYTES) throw badRequest("Ảnh quá lớn (tối đa 2 MB sau khi cắt)");
  if (!sniffImage(buf)) throw badRequest("Chỉ nhận ảnh JPG, PNG hoặc WebP");
  const { default: sharp } = await import("sharp");
  const opts = { failOn: "error" as const, limitInputPixels: MAX_PHOTO_PIXELS };
  // Giải mã ảnh tốn bộ nhớ (ảnh 25 triệu điểm ≈ 100 MB): tối đa 2 lượt cùng lúc trên cả máy chủ.
  await acquire();
  try {
    const meta = await sharp(buf, opts).metadata();
    if (!meta.width || !meta.height) throw new Error("size");
    if (meta.width * meta.height > MAX_PHOTO_PIXELS) throw badRequest("Ảnh quá nhiều điểm ảnh (tối đa 25 triệu)");
    // .rotate() = xoay theo EXIF trước khi bỏ metadata; sharp mặc định không giữ EXIF / GPS khi xuất.
    return await sharp(buf, opts).rotate().resize(PHOTO_W, PHOTO_H, { fit: "cover", position: "centre" }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
  } catch (err) {
    if ((err as { status?: number }).status) throw err;
    throw badRequest("Không đọc được ảnh (file hỏng hoặc quá lớn)");
  } finally {
    release();
  }
}

const MAX_DECODES = 2;
let decoding = 0;
const waiting: (() => void)[] = [];
function acquire(): Promise<void> {
  if (decoding < MAX_DECODES) {
    decoding++;
    return Promise.resolve();
  }
  return new Promise((r) => waiting.push(r)); // chỗ được chuyển thẳng cho lượt chờ (không giảm bộ đếm)
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else decoding--;
}

// Khóa theo nhân viên (1 tiến trình): hai lượt lưu cùng lúc không xen kẽ ghi file / cập nhật DB / dọn file.
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

/** Lưu ảnh tự chọn (thay ảnh cũ). Chỉ gắn cho người đang làm việc. Trả về kích thước đã lưu. */
export async function saveProfilePhoto(employeeId: number, raw: Uint8Array) {
  const img = await normalizeProfilePhoto(raw);
  return withLock(employeeId, async () => {
    const key = `${randomUUID()}.jpg`;
    const dir = photoDir(employeeId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key), img);
    const now = new Date();
    try {
      const upd = await prisma.employee.updateMany({ where: { id: employeeId, active: true }, data: { photoKey: key, photoAt: now } });
      if (!upd.count) throw badRequest("Nhân viên đã nghỉ việc — không đổi ảnh đại diện");
    } catch (err) {
      await rm(join(dir, key), { force: true });
      throw err;
    }
    for (const f of await readdir(dir).catch(() => [] as string[])) if (f !== key && KEY_RE.test(f)) await rm(join(dir, f), { force: true });
    return { key, size: img.length, at: now };
  });
}

/** Xóa ảnh tự chọn (file + cột DB). Không ném lỗi khi không có ảnh. */
export async function clearProfilePhoto(employeeId: number, opts: { dbAlreadyGone?: boolean } = {}) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return;
  await withLock(employeeId, async () => {
    await rm(photoDir(employeeId), { recursive: true, force: true });
    if (!opts.dbAlreadyGone) await prisma.employee.updateMany({ where: { id: employeeId, photoKey: { not: null } }, data: { photoKey: null, photoAt: null } });
  });
}

/**
 * DB trỏ tới file đã mất: chỉ dọn khi khóa VẪN là khóa đã thấy — tránh xóa nhầm ảnh vừa được tải lên song song (lượt đọc cầm khóa cũ).
 */
export async function clearStalePhoto(employeeId: number, staleKey: string) {
  await withLock(employeeId, async () => {
    const upd = await prisma.employee.updateMany({ where: { id: employeeId, photoKey: staleKey }, data: { photoKey: null, photoAt: null } });
    if (upd.count && KEY_RE.test(staleKey)) await rm(join(photoDir(employeeId), staleKey), { force: true });
  });
}

export async function readProfilePhoto(employeeId: number, key: string | null): Promise<Buffer | null> {
  if (!key || !KEY_RE.test(key)) return null;
  try {
    return await readFile(join(photoDir(employeeId), key));
  } catch {
    return null;
  }
}

/** Xem ảnh tự chọn: ai xem được nhân viên đó (chính chủ, Nhân sự / Quản trị, quản lý phòng). */
export const canSeeProfilePhoto = (u: AuthUser, e: { id: number; departmentId: number }) => canViewEmployee(u, e);

/**
 * Đổi / xóa ảnh tự chọn: chính chủ; hoặc người có `employees.manage` trong phạm vi phòng — tài khoản Nhân sự / Quản trị của người khác thì
 * chỉ Quản trị (giống luật sửa tài khoản).
 */
export async function canEditProfilePhoto(u: AuthUser, e: { id: number; role: string; departmentId: number }) {
  if (u.id === e.id) return true;
  return photoEditRule(u, e, { manage: await can(u, "employees.manage"), privileged: await can(u, "roles.assignPrivileged") });
}

/** Bản đồng bộ (quyền truyền sẵn) để xét cả danh sách. */
export function photoEditRule(u: AuthUser, e: { id: number; role: string; departmentId: number }, caps: { manage: boolean; privileged: boolean }) {
  if (u.id === e.id) return true;
  if (!caps.manage || !canManageDept(u, e.departmentId)) return false;
  return caps.privileged || !(PRIVILEGED_ROLES as readonly string[]).includes(e.role);
}

type AvatarRow = { id: number; departmentId: number; faceAvatarKey: string | null; faceAvatarAt: Date | null; photoKey: string | null; photoAt: Date | null };

/** Ảnh hiển thị: ảnh tự chọn (nếu có) → ảnh khuôn mặt (nếu được xem) → null (chữ viết tắt). */
export function displayAvatarUrl(u: AuthUser, e: AvatarRow, canSnapshots: boolean) {
  if (e.photoKey && canSeeProfilePhoto(u, e)) return `/api/employees/${e.id}/photo?v=${e.photoAt?.getTime() ?? 0}`;
  return avatarUrlFor(u, e, canSnapshots);
}
