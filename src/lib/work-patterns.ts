import { z } from "zod";
import { prisma } from "./db";
import { badRequest } from "./api";

export const PATTERN_DAYS = ["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"] as const;
type DayKey = (typeof PATTERN_DAYS)[number];

const shiftRef = z.number().int().positive().nullable();
export const patternSchema = z.object({
  name: z.string().trim().min(2).max(60),
  monShiftId: shiftRef,
  tueShiftId: shiftRef,
  wedShiftId: shiftRef,
  thuShiftId: shiftRef,
  friShiftId: shiftRef,
  satShiftId: shiftRef,
  sunShiftId: shiftRef,
});

export async function assertShiftsExist(p: Partial<Record<DayKey, number | null>>) {
  const ids = [...new Set(PATTERN_DAYS.map((d) => p[d]).filter((v): v is number => typeof v === "number"))];
  if (!ids.length) return;
  if ((await prisma.shift.count({ where: { id: { in: ids } } })) !== ids.length) throw badRequest("Có ca không tồn tại trong mẫu tuần");
}
