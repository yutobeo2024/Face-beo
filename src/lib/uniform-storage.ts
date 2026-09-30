/**
 * Ảnh của tính năng kiểm đồng phục (v1.20.0), đều nằm NGOÀI thư mục public, chỉ xem được qua route có kiểm quyền.
 *
 *   data/uniform-crops/YYYY/MM/DD/<uuid>.jpg — vùng áo cắt từ ảnh chấm công. KHÔNG chứa khuôn mặt (xem uniform-crop.ts),
 *       nên không phải dữ liệu sinh trắc. Xóa cùng lịch với ảnh chấm công (job snapshot-cleanup).
 *   data/uniforms/<templateId>/<uuid>.jpg      — ảnh mẫu áo do Nhân sự tải lên hoặc lấy từ một lượt chấm công thật.
 *       Đây là CẤU HÌNH, phải nằm trong gói sao lưu (xem deploy/backup.sh).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { TZ } from "./attendance";
import { dataDir } from "./storage";

export const cropDir = () => join(dataDir(), "uniform-crops");
export const templateDir = (templateId: number) => join(dataDir(), "uniforms", String(templateId));

const FILE_RE = /^[0-9a-f-]{36}\.jpg$/;

/** Lưu ảnh vùng áo, trả URL nội bộ (xem qua /api/uniform/crops có kiểm quyền). */
export async function saveCrop(buf: Buffer, at: Date = new Date()): Promise<string> {
  const d = DateTime.fromJSDate(at, { zone: TZ });
  const rel = [d.toFormat("yyyy"), d.toFormat("MM"), d.toFormat("dd"), `${randomUUID()}.jpg`];
  const dir = join(cropDir(), ...rel.slice(0, 3));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, rel[3]), buf);
  return `/api/uniform/crops/${rel.join("/")}`;
}

export async function readCrop(parts: string[]): Promise<Buffer | null> {
  if (parts.length !== 4 || !/^\d{4}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1]) || !/^\d{2}$/.test(parts[2])) return null;
  if (!FILE_RE.test(parts[3])) return null;
  const full = normalize(join(cropDir(), ...parts));
  if (!full.startsWith(normalize(cropDir()) + sep)) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

/** Lưu một ảnh mẫu áo. Trả về khóa tệp để ghi vào UniformSample.fileKey. */
export async function saveTemplateSample(templateId: number, buf: Buffer): Promise<string> {
  const name = `${randomUUID()}.jpg`;
  const dir = templateDir(templateId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), buf);
  return `${templateId}/${name}`;
}

export async function readTemplateSample(fileKey: string): Promise<Buffer | null> {
  const [id, name] = fileKey.split("/");
  if (!/^\d+$/.test(id ?? "") || !FILE_RE.test(name ?? "")) return null;
  const full = normalize(join(dataDir(), "uniforms", id, name));
  if (!full.startsWith(normalize(join(dataDir(), "uniforms")) + sep)) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export async function deleteTemplateSample(fileKey: string): Promise<void> {
  const [id, name] = fileKey.split("/");
  if (!/^\d+$/.test(id ?? "") || !FILE_RE.test(name ?? "")) return;
  await rm(join(dataDir(), "uniforms", id, name), { force: true });
}

/** Xóa cả thư mục ảnh mẫu của một mẫu áo (khi xóa hẳn mẫu áo chưa dùng tới). */
export async function deleteTemplateDir(templateId: number): Promise<void> {
  await rm(templateDir(templateId), { recursive: true, force: true });
}
