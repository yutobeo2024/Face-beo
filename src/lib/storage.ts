/** Lưu snapshot ngoài thư mục public (PRD mục 6, 9): data/snapshots/YYYY/MM/DD/. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { TZ } from "./attendance";
import { badRequest } from "./api";

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

export function dataDir() {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}
export function snapshotDir() {
  return join(dataDir(), "snapshots");
}

export function decodeJpegDataUrl(input: string): Buffer {
  const b64 = input.replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw badRequest("Snapshot không phải base64 hợp lệ");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > MAX_SNAPSHOT_BYTES) throw badRequest("Snapshot vượt quá 1 MB");
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw badRequest("Snapshot phải là JPEG");
  return buf;
}

/** Ghi snapshot, trả về URL nội bộ (chỉ xem qua /api/snapshots có kiểm tra quyền). Tên file do server đặt. */
export async function saveSnapshot(buf: Buffer, at: Date = new Date()): Promise<string> {
  const d = DateTime.fromJSDate(at, { zone: TZ });
  const rel = [d.toFormat("yyyy"), d.toFormat("MM"), d.toFormat("dd"), `${randomUUID()}.jpg`];
  const dir = join(snapshotDir(), ...rel.slice(0, 3));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, rel[3]), buf);
  return `/api/snapshots/${rel.join("/")}`;
}

export async function readSnapshot(parts: string[]): Promise<Buffer | null> {
  if (parts.length !== 4 || !/^\d{4}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1]) || !/^\d{2}$/.test(parts[2])) return null;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(parts[3])) return null;
  const full = normalize(join(snapshotDir(), ...parts));
  if (!full.startsWith(normalize(snapshotDir()) + sep)) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}
