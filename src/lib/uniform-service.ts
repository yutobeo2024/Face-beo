/**
 * Chọn lượt chấm để kiểm đồng phục và ghi kết quả (v1.20.0).
 *
 * Chạy trong job nền `uniform-check`, KHÔNG chạy trong route chấm công — lượt quét của nhân viên không được chậm đi
 * vì tính năng này.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { addDays, todayVN, vnDate } from "./attendance";
import { TRACKED_WHERE } from "./attendance-scope";
import { getSettings } from "./settings";
import { readSnapshot } from "./storage";
import { saveCrop } from "./uniform-storage";
import { withUniformModel } from "./uniform-embed";
import { evaluateShirt, extractShirtFeature } from "./uniform";
import { UNIFORM_REASON_LABEL, type UniformReason, type UniformTemplateRef, type UniformThresholds } from "./uniform-score";
import type { FaceBox } from "./uniform-crop";

/** Tối đa mỗi lượt job — đủ cho 5 phút của một phòng khám 100 người, mà không giữ mô hình quá lâu. */
export const BATCH_LIMIT = 40;

export type ScanCandidate = { employeeId: number; workDate: string; logId: number; checkTime: Date; shiftId: number | null; snapshotUrl: string; faceBox: string };

type LogLite = { id: number; employeeId: number; workDate: string; checkTime: Date; shiftId: number | null; snapshotUrl: string | null; faceBox: string | null; source: string };

/**
 * Chọn "lượt chấm VÀO đầu ca" cho mỗi (nhân viên, ngày): log SỚM NHẤT có gắn ca.
 * Không dùng `type === "IN"` vì recomputeDay gán lại type theo cặp vào/ra; còn "sớm nhất & trong ca" thì luôn là lượt vào.
 * Bỏ qua log chấm tay, log thiếu ảnh hoặc thiếu khung mặt (không kiểm được).
 */
export function pickFirstInLogs(logs: LogLite[]): ScanCandidate[] {
  const best = new Map<string, LogLite>();
  for (const l of logs) {
    if (l.source !== "KIOSK" || l.shiftId == null || !l.snapshotUrl || !l.faceBox) continue;
    const key = `${l.employeeId}|${l.workDate}`;
    const cur = best.get(key);
    if (!cur || l.checkTime.getTime() < cur.checkTime.getTime() || (l.checkTime.getTime() === cur.checkTime.getTime() && l.id < cur.id)) {
      best.set(key, l);
    }
  }
  return [...best.values()].map((l) => ({
    employeeId: l.employeeId,
    workDate: l.workDate,
    logId: l.id,
    checkTime: l.checkTime,
    shiftId: l.shiftId,
    snapshotUrl: l.snapshotUrl!,
    faceBox: l.faceBox!,
  }));
}

export function parseFaceBox(raw: string): FaceBox | null {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v) || v.length !== 4 || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) return null;
    return v as FaceBox;
  } catch {
    return null;
  }
}

function thresholdsFrom(s: Awaited<ReturnType<typeof getSettings>>): UniformThresholds {
  return { passEmbed: s.uniformPassEmbed, passColor: s.uniformPassColor, failScore: s.uniformFailScore, colorWeight: s.uniformColorWeight };
}

function toTemplateRef(t: { id: number; name: string; colorHist: string | null; embedding: string | null; embedVersion: string | null; sampleCount: number }): UniformTemplateRef {
  const hist = safeJson<number[]>(t.colorHist);
  return {
    id: t.id,
    name: t.name,
    colorHist: hist?.hist ?? (Array.isArray(hist) ? hist : null),
    embedding: safeJson<number[]>(t.embedding) as number[] | null,
    embedVersion: t.embedVersion,
    sampleCount: t.sampleCount,
    pattern: hist?.pattern ?? null,
  };
}

/** colorHist lưu dạng `{ hist, pattern }`; chấp nhận cả mảng thuần của bản cũ. */
function safeJson<T>(raw: string | null): (T & { hist?: number[]; pattern?: number }) | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export type UniformCheckStats = { scanned: number; created: number; pass: number; fail: number; review: number; skipped: number; ms: number };

/**
 * Một lượt job: tìm các lượt chấm vào đầu ca chưa kiểm của hôm nay và hôm qua, chấm điểm, ghi kết quả.
 * Không ném lỗi ra ngoài — hỏng gì cũng chỉ ghi CẦN XEM LẠI cho bản ghi đó.
 */
export async function runUniformCheck(now = new Date()): Promise<UniformCheckStats> {
  const t0 = Date.now();
  const stats: UniformCheckStats = { scanned: 0, created: 0, pass: 0, fail: 0, review: 0, skipped: 0, ms: 0 };

  const depts = await prisma.department.findMany({ where: { uniformMode: { not: "OFF" } }, select: { id: true, uniformMode: true } });
  if (!depts.length) return { ...stats, ms: Date.now() - t0 };
  const modeOf = new Map(depts.map((d) => [d.id, d.uniformMode]));

  const today = vnDate(now);
  const days = [addDays(today, -1), today];
  const employees = await prisma.employee.findMany({
    where: { AND: [{ active: true }, { departmentId: { in: depts.map((d) => d.id) } }, TRACKED_WHERE] },
    select: { id: true, departmentId: true },
  });
  if (!employees.length) return { ...stats, ms: Date.now() - t0 };
  const deptOf = new Map(employees.map((e) => [e.id, e.departmentId]));

  const logs = await prisma.attendanceLog.findMany({
    where: { employeeId: { in: [...deptOf.keys()] }, workDate: { in: days } },
    select: { id: true, employeeId: true, workDate: true, checkTime: true, shiftId: true, snapshotUrl: true, faceBox: true, source: true },
    orderBy: { checkTime: "asc" },
  });
  const candidates = pickFirstInLogs(logs);
  if (!candidates.length) return { ...stats, ms: Date.now() - t0 };

  const done = await prisma.uniformCheck.findMany({
    where: { employeeId: { in: candidates.map((c) => c.employeeId) }, workDate: { in: days } },
    select: { employeeId: true, workDate: true },
  });
  const doneKeys = new Set(done.map((d) => `${d.employeeId}|${d.workDate}`));
  const todo = candidates.filter((c) => !doneKeys.has(`${c.employeeId}|${c.workDate}`)).slice(0, BATCH_LIMIT);
  if (!todo.length) return { ...stats, ms: Date.now() - t0 };

  const locked = await prisma.payrollLock.findMany({ where: { month: { in: [...new Set(todo.map((c) => c.workDate.slice(0, 7)))] } }, select: { month: true } });
  const lockedMonths = new Set(locked.map((l) => l.month));

  const settings = await getSettings();
  const th = thresholdsFrom(settings);
  const keepCrop = settings.uniformKeepCrop === 1;

  const templates = await prisma.uniformTemplate.findMany({
    where: { departmentId: { in: depts.map((d) => d.id) }, active: true },
    select: { id: true, departmentId: true, name: true, colorHist: true, embedding: true, embedVersion: true, sampleCount: true },
  });
  const byDept = new Map<number, UniformTemplateRef[]>();
  for (const t of templates) byDept.set(t.departmentId, [...(byDept.get(t.departmentId) ?? []), toTemplateRef(t)]);

  await withUniformModel(async (model) => {
    for (const c of todo) {
      if (lockedMonths.has(c.workDate.slice(0, 7))) continue;
      const departmentId = deptOf.get(c.employeeId);
      if (departmentId == null) continue;
      stats.scanned++;
      const mode = modeOf.get(departmentId) ?? "OFF";
      const row = await evaluateOne(c, departmentId, byDept.get(departmentId) ?? [], th, keepCrop, model);
      try {
        await prisma.uniformCheck.create({ data: { ...row, departmentId, mode } });
        stats.created++;
        if (row.status === "PASS") stats.pass++;
        else if (row.status === "FAIL") stats.fail++;
        else if (row.status === "SKIPPED") stats.skipped++;
        else stats.review++;
      } catch {
        // P2002: một lượt job khác vừa ghi cho cùng (người, ngày) — bỏ qua, đúng tinh thần chạy lại không trùng.
      }
    }
  });

  return { ...stats, ms: Date.now() - t0 };
}

type CheckRow = Omit<Prisma.UniformCheckUncheckedCreateInput, "departmentId" | "mode">;

async function evaluateOne(
  c: ScanCandidate,
  departmentId: number,
  templates: UniformTemplateRef[],
  th: UniformThresholds,
  keepCrop: boolean,
  model: Parameters<Parameters<typeof withUniformModel>[0]>[0],
): Promise<CheckRow> {
  const base = { employeeId: c.employeeId, workDate: c.workDate, shiftId: c.shiftId, logId: c.logId, checkTime: c.checkTime };
  const review = (reason: UniformReason, detail?: Record<string, unknown>): CheckRow => ({
    ...base,
    machineStatus: "REVIEW",
    status: "REVIEW",
    reason,
    detail: JSON.stringify({ reasonText: UNIFORM_REASON_LABEL[reason], ...detail }),
  });

  const parts = c.snapshotUrl.replace("/api/snapshots/", "").split("/");
  const jpeg = await readSnapshot(parts);
  if (!jpeg) return review("SNAPSHOT_GONE");

  const box = parseFaceBox(c.faceBox);
  if (!box) return review("CROP_OUT_OF_FRAME");

  // Phòng chưa khai mẫu áo: KHÔNG kết luận gì, nhưng vẫn cắt và lưu ảnh vùng áo — đó là nguồn để Nhân sự bấm
  // "Dùng ảnh này làm ảnh mẫu". Không có bước này thì thành vòng luẩn quẩn: muốn có mẫu phải có ảnh, muốn có ảnh
  // phải có mẫu. Bỏ qua mô hình AI vì chẳng có gì để so.
  if (!templates.length) {
    let cropUrl: string | null = null;
    // Ghi lại VÌ SAO không cắt được, kể cả khi bỏ qua: trước đây nuốt mất lý do nên nhìn bảng theo dõi không biết tại
    // sao thiếu ảnh, phải vào tận máy chủ mới tìm ra (v1.21.1).
    const info: Record<string, unknown> = { reasonText: UNIFORM_REASON_LABEL.NO_TEMPLATE };
    try {
      const r = await extractShirtFeature(jpeg, box, { embedder: null, keepCrop });
      if (r.ok) {
        info.quality = { brightness: round(r.feature.quality.brightness), contrast: round(r.feature.quality.contrast), skin: round(r.feature.quality.skin) };
        info.rect = r.feature.rect;
        info.pattern = round(r.feature.pattern);
        if (r.feature.cropJpeg) cropUrl = await saveCrop(r.feature.cropJpeg, c.checkTime);
      } else {
        info.cropReason = r.reason;
        info.cropReasonText = UNIFORM_REASON_LABEL[r.reason];
      }
    } catch (e) {
      info.cropReason = "MODEL_ERROR";
      info.cropReasonText = (e as Error).message;
    }
    return { ...base, machineStatus: "SKIPPED", status: "SKIPPED", reason: "NO_TEMPLATE", cropUrl, detail: JSON.stringify(info) };
  }

  let feature;
  try {
    const r = await extractShirtFeature(jpeg, box, { embedder: model, keepCrop });
    if (!r.ok) return review(r.reason);
    feature = r.feature;
  } catch (e) {
    return review("MODEL_ERROR", { error: (e as Error).message });
  }

  const verdict = evaluateShirt(feature, templates, th);
  const cropUrl = feature.cropJpeg ? await saveCrop(feature.cropJpeg, c.checkTime) : null;
  return {
    ...base,
    machineStatus: verdict.status,
    status: verdict.status,
    reason: verdict.reason,
    templateId: verdict.templateId,
    score: verdict.score,
    embedScore: verdict.embedScore,
    colorScore: verdict.colorScore,
    cropUrl,
    detail: JSON.stringify({
      reasonText: verdict.reason ? UNIFORM_REASON_LABEL[verdict.reason] : null,
      scores: verdict.scores.map((s) => ({ id: s.templateId, name: s.name, embed: round(s.embedScore), color: round(s.colorScore), score: round(s.score) })),
      quality: { brightness: round(feature.quality.brightness), contrast: round(feature.quality.contrast), skin: round(feature.quality.skin) },
      pattern: round(feature.pattern),
      colorHex: feature.colorHex,
      rect: feature.rect,
      thresholds: th,
      modelVersion: feature.embedVersion,
    }),
  };
}

const round = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 1000);

/** Dùng cho trang theo dõi: ngày hôm nay theo giờ VN. */
export const todayForUniform = () => todayVN();

// ---------------------------------------------------------------------------
// Tin Zalo tổng hợp cuối ngày (job `uniform-digest`, 18:00)
// ---------------------------------------------------------------------------

/** Tối đa số dòng trong một tin; dư thì ghi "… và N người nữa". */
export const DIGEST_MAX_ROWS = 15;

const DIGEST_LABEL: Record<string, string> = { FAIL: "không đúng đồng phục", REVIEW: "cần xem lại" };

/**
 * Gom kết quả đồng phục trong ngày thành MỘT tin cho quản lý mỗi (phòng | ngày | ca).
 *
 * Luật khóa cứng:
 *   - Chỉ bản ghi chế độ ON: bản chạy thử chỉ để đo ngưỡng, không làm phiền ai.
 *   - Cả nhóm đều đạt thì KHÔNG gửi tin (vẫn đánh dấu đã gom để hôm sau không lặp).
 *   - Không kèm lý do cá nhân; chỉ tên, mã và mức kết luận.
 */
export async function runUniformDigest(now = new Date()) {
  const { sendZaloMessage } = await import("./zalo-oa");
  const { approversFor, fmtDate } = await import("./notify");

  const workDate = vnDate(now);
  const rows = await prisma.uniformCheck.findMany({
    where: { workDate, mode: "ON", digestAt: null },
    orderBy: [{ departmentId: "asc" }, { shiftId: "asc" }, { id: "asc" }],
  });
  if (!rows.length) return { groups: 0, sent: 0, skipped: 0 };

  const employees = new Map(
    (await prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, code: true, name: true } })).map((e) => [e.id, e]),
  );
  const depts = new Map(
    (await prisma.department.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.departmentId))] } }, select: { id: true, name: true, managerId: true } })).map((d) => [d.id, d]),
  );
  const shifts = new Map((await prisma.shift.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));

  type Group = { deptId: number; shiftId: number | null; items: { name: string; code: string; note: string }[]; total: number };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.departmentId}|${r.shiftId ?? 0}`;
    const g = groups.get(key) ?? { deptId: r.departmentId, shiftId: r.shiftId, items: [], total: 0 };
    g.total++;
    const e = employees.get(r.employeeId);
    if (e && (r.status === "FAIL" || r.status === "REVIEW")) g.items.push({ name: e.name, code: e.code, note: DIGEST_LABEL[r.status] });
    groups.set(key, g);
  }

  let sent = 0;
  let skipped = 0;
  for (const g of groups.values()) {
    if (!g.items.length) {
      skipped++; // cả nhóm đều đạt: không làm phiền quản lý
      continue;
    }
    const dept = depts.get(g.deptId);
    const recipients = dept?.managerId ? [dept.managerId] : await approversFor(-1);
    for (const to of recipients) {
      const suffix = dept?.managerId ? "" : `:${to}`;
      const r = await sendZaloMessage({
        toEmployeeId: to,
        messageType: "UNIFORM_DIGEST",
        dedupeKey: `uniform-digest:${g.deptId}:${workDate}:${g.shiftId ?? 0}${suffix}`,
        data: {
          departmentName: dept?.name ?? "",
          dateText: fmtDate(workDate),
          shiftName: (g.shiftId != null && shifts.get(g.shiftId)) || "",
          total: g.total,
          items: g.items.slice(0, DIGEST_MAX_ROWS),
          more: Math.max(0, g.items.length - DIGEST_MAX_ROWS),
        },
      });
      if (r.status !== "DUPLICATE") sent++;
    }
  }

  await prisma.uniformCheck.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { digestAt: now } });
  return { groups: groups.size, sent, skipped };
}
