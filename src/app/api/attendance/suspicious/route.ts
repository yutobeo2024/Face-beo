import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

/**
 * "Lần quét đáng ngờ" + phân bố matchScore để hiệu chỉnh ngưỡng trong pilot (PRD mục 6). Chỉ ADMIN.
 */
export const GET = handle(async (req) => {
  await requireUser(req, ["ADMIN"]);
  const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }));
  const since = new Date(Date.now() - days * 86_400_000);
  const settings = await getSettings();
  const [audits, logs, devices] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: { in: ["SCAN_SPOOF_REJECTED", "SCAN_NO_MATCH"] }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.attendanceLog.findMany({
      where: { source: "KIOSK", checkTime: { gte: since } },
      select: { id: true, matchScore: true, livenessScore: true, checkTime: true, snapshotUrl: true, employee: { select: { code: true, name: true } } },
      orderBy: { checkTime: "desc" },
    }),
    prisma.kioskDevice.findMany({ select: { id: true, name: true } }),
  ]);
  const deviceName = new Map(devices.map((d) => [String(d.id), d.name]));
  // Histogram matchScore theo bước 0.05.
  const bins: { from: number; count: number }[] = [];
  for (let b = 0.3; b < 1.0001; b += 0.05) bins.push({ from: Math.round(b * 100) / 100, count: 0 });
  const noMatchBins = bins.map((b) => ({ ...b }));
  const put = (arr: typeof bins, v: number) => {
    const i = Math.min(arr.length - 1, Math.max(0, Math.floor((v - 0.3) / 0.05)));
    arr[i].count++;
  };
  for (const l of logs) if (l.matchScore != null) put(bins, l.matchScore);
  const events = audits.map((a) => {
    const d = a.detail ? JSON.parse(a.detail) : {};
    if (a.action === "SCAN_NO_MATCH" && typeof d.top1 === "number") put(noMatchBins, d.top1);
    return { id: a.id, action: a.action, at: a.createdAt, device: deviceName.get(a.entityId ?? "") ?? a.entityId, detail: d };
  });
  const lowMargin = logs.filter((l) => l.matchScore != null && l.matchScore < settings.matchThreshold + 0.05).slice(0, 50);
  return json({ settings, events, histogram: { matched: bins, noMatch: noMatchBins }, lowMargin, totalKioskScans: logs.length });
});
