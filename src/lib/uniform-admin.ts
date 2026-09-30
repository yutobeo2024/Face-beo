/**
 * Quản lý mẫu áo đồng phục (v1.20.0): thêm / sửa / tắt mẫu, thêm và xóa ảnh mẫu, tính lại đặc trưng.
 *
 * Mỗi mẫu áo thuộc MỘT phòng; đặc trưng (màu · độ có logo · vector mô hình) là trung bình của các ảnh mẫu, tính sẵn
 * lúc tải ảnh lên để job nền chỉ việc so cho nhanh.
 *
 * Ảnh mẫu nên chụp ngay tại kiosk khi nhân viên mặc áo: ảnh chấm công tối hơn ảnh thường nhiều (đo thực tế độ sáng
 * chỉ 0,16–0,28), mẫu chụp ngoài sáng sẽ lệch điều kiện.
 */
import { prisma } from "./db";
import { badRequest, notFound } from "./api";
import { sniffImage } from "./profile-photo";
import { deleteTemplateSample, readTemplateSample, saveTemplateSample } from "./uniform-storage";
import { withUniformModel } from "./uniform-embed";
import { averageHistograms, averageVectors, extractSampleFeature } from "./uniform";
import { MIN_SAMPLES_TRUSTED } from "./uniform-score";

export const MAX_SAMPLE_BYTES = 2 * 1024 * 1024;
export const MAX_SAMPLES_PER_TEMPLATE = 10;
export const MAX_TEMPLATES_PER_DEPT = 6;
/** Cạnh ảnh mẫu sau khi chuẩn hóa — đủ chi tiết cho logo, nhẹ để lưu lâu dài. */
export const SAMPLE_SIZE = 256;
export const SAMPLE_KINDS = ["SHIRT", "WORN"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/** Kiểm + chuẩn hóa ảnh mẫu: JPG/PNG/WebP ≤ 2 MB → JPEG vuông 256, bỏ mọi thông tin đi kèm (EXIF, GPS). */
export async function normalizeSample(buf: Uint8Array): Promise<Buffer> {
  if (!buf.length) throw badRequest("Chưa có ảnh");
  if (buf.length > MAX_SAMPLE_BYTES) throw badRequest("Ảnh quá lớn (tối đa 2 MB)");
  if (!sniffImage(buf)) throw badRequest("Chỉ nhận ảnh JPG, PNG hoặc WebP");
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(buf), { failOn: "none" })
    .rotate()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "cover" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86 })
    .toBuffer();
}

/** Tính lại đặc trưng của cả mẫu áo từ các ảnh mẫu hiện có. Gọi sau mỗi lần thêm / xóa ảnh. */
export async function recomputeTemplate(templateId: number): Promise<void> {
  const samples = await prisma.uniformSample.findMany({ where: { templateId }, select: { id: true, fileKey: true, embedding: true, colorHist: true } });
  if (!samples.length) {
    await prisma.uniformTemplate.update({
      where: { id: templateId },
      data: { embedding: null, embedVersion: null, colorHist: null, colorHex: null, sampleCount: 0, active: false },
    });
    return;
  }

  await withUniformModel(async (model) => {
    const hists: (number[] | null)[] = [];
    const vecs: (number[] | null)[] = [];
    const patterns: number[] = [];
    let hex: string | null = null;

    for (const s of samples) {
      const buf = await readTemplateSample(s.fileKey);
      if (!buf) continue;
      const f = await extractSampleFeature(buf, model);
      if (!f) continue;
      hists.push(f.colorHist);
      vecs.push(f.embedding);
      patterns.push(f.pattern);
      hex ??= f.colorHex;
      await prisma.uniformSample.update({
        where: { id: s.id },
        data: { colorHist: JSON.stringify(f.colorHist), embedding: f.embedding ? JSON.stringify(f.embedding) : null },
      });
    }

    const hist = averageHistograms(hists);
    const vec = averageVectors(vecs);
    const pattern = patterns.length ? patterns.reduce((a, b) => a + b, 0) / patterns.length : 0;
    const { UNIFORM_MODEL_VERSION } = await import("./uniform-embed");
    await prisma.uniformTemplate.update({
      where: { id: templateId },
      data: {
        colorHist: hist ? JSON.stringify({ hist, pattern }) : null,
        embedding: vec ? JSON.stringify(vec) : null,
        embedVersion: vec ? UNIFORM_MODEL_VERSION : null,
        colorHex: hex,
        sampleCount: hists.length,
      },
    });
  });
}

export async function addSample(templateId: number, buf: Uint8Array, kind: SampleKind, createdById: number) {
  const t = await prisma.uniformTemplate.findUnique({ where: { id: templateId }, select: { id: true, _count: { select: { samples: true } } } });
  if (!t) throw notFound("Không có mẫu áo này");
  if (t._count.samples >= MAX_SAMPLES_PER_TEMPLATE) throw badRequest(`Mỗi mẫu áo chỉ giữ tối đa ${MAX_SAMPLES_PER_TEMPLATE} ảnh`);
  const jpeg = await normalizeSample(buf);
  const fileKey = await saveTemplateSample(templateId, jpeg);
  const sample = await prisma.uniformSample.create({ data: { templateId, fileKey, kind, createdById } });
  await recomputeTemplate(templateId);
  return sample;
}

export async function removeSample(templateId: number, sampleId: number) {
  const s = await prisma.uniformSample.findUnique({ where: { id: sampleId } });
  if (!s || s.templateId !== templateId) throw notFound("Không có ảnh mẫu này");
  await deleteTemplateSample(s.fileKey);
  await prisma.uniformSample.delete({ where: { id: sampleId } });
  await recomputeTemplate(templateId);
}

/** Mẫu áo đã từng dùng để kết luận thì KHÔNG xóa cứng (lịch sử là bất biến) — chỉ tắt đi. */
export async function canHardDelete(templateId: number): Promise<boolean> {
  return (await prisma.uniformCheck.count({ where: { templateId } })) === 0;
}

/** Lời nhắc cho giao diện khi mẫu áo chưa đủ tin. */
export function templateWarning(t: { sampleCount: number; embedding: string | null; colorHist: string | null }): string | null {
  if (!t.colorHist) return "Chưa có ảnh mẫu — mẫu áo này chưa dùng được.";
  if (t.sampleCount < MIN_SAMPLES_TRUSTED) return `Mới có ${t.sampleCount} ảnh mẫu: máy vẫn chấm điểm nhưng luôn để "cần xem lại" cho tới khi đủ ${MIN_SAMPLES_TRUSTED} ảnh.`;
  return null;
}

/**
 * Lấy ảnh mẫu THẲNG TỪ MỘT LƯỢT CHẤM CÔNG đã có (v1.20.0).
 *
 * Đây là cách lấy mẫu đúng nhất: ảnh sinh ra ở CHÍNH điều kiện sau này máy phải so — cùng camera, cùng đèn, cùng
 * khoảng cách. Nhân viên chỉ việc chấm công bình thường, Nhân sự bấm một nút trên bảng theo dõi.
 *
 * Ảnh lưu lại đã được CÂN BẰNG TRẮNG (cùng phép cân bằng áp cho ảnh chấm công lúc so), nên tính lại đặc trưng bằng
 * extractSampleFeature — vốn không cân bằng — vẫn ra đúng màu.
 *
 * Ảnh cắt nằm dưới cằm nên KHÔNG chứa khuôn mặt, giống hệt ảnh vùng áo trong bảng theo dõi.
 */
export async function addSampleFromCheck(templateId: number, checkId: number, createdById: number) {
  const { readSnapshot } = await import("./storage");
  const { chestRect, SHIRT_CROP } = await import("./uniform-crop");
  const { applyGains, grayWorldGains } = await import("./uniform-color");
  const { parseFaceBox } = await import("./uniform-service");

  const t = await prisma.uniformTemplate.findUnique({ where: { id: templateId }, select: { id: true, departmentId: true, _count: { select: { samples: true } } } });
  if (!t) throw notFound("Không có mẫu áo này");
  if (t._count.samples >= MAX_SAMPLES_PER_TEMPLATE) throw badRequest(`Mỗi mẫu áo chỉ giữ tối đa ${MAX_SAMPLES_PER_TEMPLATE} ảnh`);

  const check = await prisma.uniformCheck.findUnique({ where: { id: checkId }, select: { logId: true, departmentId: true } });
  if (!check) throw notFound("Không có bản ghi kiểm này");
  if (check.departmentId !== t.departmentId) throw badRequest("Bản ghi này thuộc phòng khác, không dùng làm mẫu cho mẫu áo này được");
  if (check.logId == null) throw badRequest("Bản ghi này không gắn với lượt chấm công nào");

  const log = await prisma.attendanceLog.findUnique({ where: { id: check.logId }, select: { snapshotUrl: true, faceBox: true } });
  if (!log?.snapshotUrl || !log.faceBox) throw badRequest("Lượt chấm công này không còn ảnh hoặc thiếu khung khuôn mặt");
  const box = parseFaceBox(log.faceBox);
  if (!box) throw badRequest("Khung khuôn mặt của lượt chấm công không đọc được");

  const jpeg = await readSnapshot(log.snapshotUrl.replace("/api/snapshots/", "").split("/"));
  if (!jpeg) throw badRequest("Ảnh chấm công đã bị xóa theo hạn lưu, không lấy mẫu được nữa");

  const { default: sharp } = await import("sharp");
  const meta = await sharp(jpeg, { failOn: "none" }).metadata();
  const crop = chestRect(meta.width ?? 0, meta.height ?? 0, box, SHIRT_CROP);
  if (!crop.ok) throw badRequest("Ảnh chấm công này không thấy đủ vùng áo — chọn lượt khác");

  // Cân bằng trắng tính trên TOÀN khung (có tường / da / tóc), y như lúc kiểm.
  const whole = await sharp(jpeg, { failOn: "none" }).resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const gains = grayWorldGains(whole);
  const raw = await sharp(jpeg, { failOn: "none" }).extract(crop.rect).removeAlpha().raw().toBuffer();
  const balanced = applyGains(raw, gains);
  const out = await sharp(balanced, { raw: { width: crop.rect.width, height: crop.rect.height, channels: 3 } })
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "cover" })
    .jpeg({ quality: 88 })
    .toBuffer();

  const fileKey = await saveTemplateSample(templateId, out);
  const sample = await prisma.uniformSample.create({ data: { templateId, fileKey, kind: "WORN", createdById } });
  await recomputeTemplate(templateId);
  return sample;
}
