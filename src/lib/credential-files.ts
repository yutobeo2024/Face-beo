/**
 * File scan văn bằng / chứng chỉ / CME (v1.9.0): lưu ở data/credentials/<employeeId>/<uuid>.<ext>, ngoài thư mục public.
 * Chỉ nhận PDF / JPEG / PNG (kiểm chữ ký file, không tin phần mở rộng), tối đa 10 MB; tên file trên đĩa do server đặt.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { badRequest } from "./api";
import { dataDir } from "./storage";

export const MAX_CREDENTIAL_FILE_BYTES = 10 * 1024 * 1024;
const credentialsDir = () => join(dataDir(), "credentials");

export function sniffCredentialFile(buf: Uint8Array): { ext: "pdf" | "jpg" | "png"; mime: string } | null {
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return { ext: "pdf", mime: "application/pdf" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: "png", mime: "image/png" };
  return null;
}

export async function saveCredentialFile(employeeId: number, buf: Uint8Array) {
  if (!buf.length) throw badRequest("File rỗng");
  if (buf.length > MAX_CREDENTIAL_FILE_BYTES) throw badRequest("File quá lớn (tối đa 10 MB)");
  const kind = sniffCredentialFile(buf);
  if (!kind) throw badRequest("Chỉ nhận file PDF, JPG hoặc PNG");
  const key = `${randomUUID()}.${kind.ext}`;
  const dir = join(credentialsDir(), String(employeeId));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), buf);
  return { key, mime: kind.mime, size: buf.length };
}

const KEY_RE = /^[0-9a-f-]{36}\.(pdf|jpg|png)$/;

export async function readCredentialFile(employeeId: number, key: string): Promise<Buffer | null> {
  if (!KEY_RE.test(key)) return null;
  try {
    return await readFile(join(credentialsDir(), String(employeeId), key));
  } catch {
    return null;
  }
}

export async function deleteCredentialFile(employeeId: number, key: string | null | undefined) {
  if (!key || !KEY_RE.test(key)) return;
  await rm(join(credentialsDir(), String(employeeId), key), { force: true });
}

/** Xóa toàn bộ file hồ sơ hành nghề của một người (khi xóa tài khoản tạo nhầm — dòng DB đã xóa theo cascade). */
export async function deleteCredentialDir(employeeId: number) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return;
  await rm(join(credentialsDir(), String(employeeId)), { recursive: true, force: true });
}
