import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, HttpError, json, parseJson } from "@/lib/api";
import { requireDevice } from "@/lib/kiosk-auth";
import { rateLimit } from "@/lib/rate-limit";
import { kioskScanSchema } from "@/lib/validators";
import { getSettings } from "@/lib/settings";
import { matchFace } from "@/lib/face-matcher";
import { recordScan } from "@/lib/attendance-service";
import { decodeJpegDataUrl, saveSnapshot } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { notifyLateIfNeeded } from "@/lib/notify";
import { vnTime } from "@/lib/attendance";
import { evaluateLiveness } from "@/lib/liveness";

const MAX_OFFLINE_AGE_MS = 24 * 3600_000;

/**
 * Kiosk gửi embedding + điểm liveness từng khung + snapshot. Server tự kết luận liveness và danh tính;
 * mọi cờ boolean từ client đều bị bỏ qua (PRD mục 6).
 */
export const POST = handle(async (req) => {
  const device = await requireDevice(req);
  const rl = rateLimit(`scan:${device.id}`, 60);
  if (!rl.ok) throw new HttpError(429, "Quá nhiều lượt quét, vui lòng chờ");
  const body = await parseJson(req, kioskScanSchema);

  const now = Date.now();
  const captured = body.capturedAt.getTime();
  if (captured > now + 5 * 60_000) throw new HttpError(400, "capturedAt ở tương lai");
  if (now - captured > MAX_OFFLINE_AGE_MS) throw new HttpError(400, "Bản ghi quá 24 giờ, không được chấp nhận");

  // Idempotent theo clientEventId (đồng bộ offline gửi lại).
  const existing = await prisma.attendanceLog.findUnique({
    where: { clientEventId: body.clientEventId },
    include: { employee: { select: { name: true, code: true } } },
  });
  if (existing) {
    return json({
      result: "OK",
      duplicateEvent: true,
      employee: { name: existing.employee.name, code: existing.employee.code },
      type: existing.type,
      time: vnTime(existing.checkTime),
    });
  }

  const settings = await getSettings();
  const snapshotBuf = body.snapshot ? decodeJpegDataUrl(body.snapshot) : null;
  const live = await evaluateLiveness({
    frames: body.frames,
    threshold: settings.livenessThreshold,
    serverThreshold: settings.livenessServerThreshold,
    snapshot: snapshotBuf,
    faceBox: body.faceBox ?? null,
  });
  if (live.server.status === "unavailable") await auditL2Unavailable(device.id, live.server.error);

  if (!live.verified) {
    const snapshotUrl = snapshotBuf ? await saveSnapshot(snapshotBuf, body.capturedAt) : null;
    await audit({
      action: "SCAN_SPOOF_REJECTED",
      entity: "KioskDevice",
      entityId: device.id,
      detail: {
        score: live.score,
        l1: round(live.l1),
        threshold: settings.livenessThreshold,
        server: live.server,
        meshFlatness: body.meshFlatness ?? null,
        snapshotUrl,
        capturedAt: body.capturedAt.toISOString(),
        clientEventId: body.clientEventId,
      },
    });
    return json({ result: "REJECTED_SPOOF", message: "Không xác minh được người thật. Vui lòng nhìn thẳng vào camera." });
  }

  const m = await matchFace(body.embedding, settings.matchThreshold, settings.matchMargin);
  if (!m.employeeId) {
    await audit({
      action: "SCAN_NO_MATCH",
      entity: "KioskDevice",
      entityId: device.id,
      detail: { top1: round(m.top1), top2: round(m.top2), candidate: m.top1EmployeeId, livenessScore: round(live.score) },
    });
    return json({ result: "NO_MATCH", message: "Không nhận ra khuôn mặt. Vui lòng thử lại." });
  }

  const emp = await prisma.employee.findUnique({ where: { id: m.employeeId }, select: { id: true, name: true, code: true, avatarUrl: true, active: true } });
  if (!emp?.active) return json({ result: "NO_MATCH", message: "Không nhận ra khuôn mặt. Vui lòng thử lại." });

  const snapshotUrl = snapshotBuf ? await saveSnapshot(snapshotBuf, body.capturedAt) : null;
  let outcome: Awaited<ReturnType<typeof recordScan>>;
  try {
    outcome = await recordScan({
    employeeId: emp.id,
    checkTime: body.capturedAt,
    source: "KIOSK",
    deviceId: device.id,
    clientEventId: body.clientEventId,
    snapshotUrl,
    livenessScore: live.score,
    matchScore: m.top1,
    verified3D: live.verified,
    });
  } catch (e) {
    // Hai request đồng thời cùng clientEventId: request sau trả kết quả của bản ghi đã có (idempotent).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ex = await prisma.attendanceLog.findUniqueOrThrow({ where: { clientEventId: body.clientEventId } });
      return json({ result: "OK", duplicateEvent: true, employee: { name: emp.name, code: emp.code }, type: ex.type, time: vnTime(ex.checkTime) });
    }
    throw e;
  }

  if (outcome.status === "DUPLICATE") {
    return json({
      result: "DUPLICATE",
      employee: { name: emp.name, code: emp.code },
      time: vnTime(outcome.previous.checkTime),
      message: `Bạn đã chấm lúc ${vnTime(outcome.previous.checkTime)}`,
    });
  }
  const log = outcome.log;
  if (outcome.status === "CREATED") {
    void notifyLateIfNeeded({ employeeId: emp.id, log, plan: outcome.plan, requests: outcome.requests });
  }
  return json({
    result: "OK",
    employee: { name: emp.name, code: emp.code, avatarUrl: emp.avatarUrl },
    type: log.type,
    time: vnTime(log.checkTime),
    workDate: log.workDate,
    isLate: log.isLate,
    lateMinutes: log.lateMinutes,
    isEarly: log.isEarly,
    earlyMinutes: log.earlyMinutes,
    outOfShift: log.shiftId == null,
  });
});

// Ghi tối đa 1 AuditLog mỗi 10 phút khi L2 lỗi (dashboard ADMIN hiện cảnh báo).
const gl = globalThis as unknown as { __l2AuditAt?: number };
async function auditL2Unavailable(deviceId: number, error: string) {
  if (Date.now() - (gl.__l2AuditAt ?? 0) < 10 * 60_000) return;
  gl.__l2AuditAt = Date.now();
  await audit({ action: "LIVENESS_L2_UNAVAILABLE", entity: "KioskDevice", entityId: deviceId, detail: { error } });
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
