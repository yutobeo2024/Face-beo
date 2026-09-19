import { z } from "zod";
import { prisma } from "./db";

export const settingsSchema = z.object({
  matchThreshold: z.coerce.number().min(0.3).max(0.95),
  matchMargin: z.coerce.number().min(0).max(0.5),
  livenessThreshold: z.coerce.number().min(0).max(1),
  livenessServerThreshold: z.coerce.number().min(0).max(1),
  absentAfterMinutes: z.coerce.number().int().min(5).max(240),
  snapshotRetentionDays: z.coerce.number().int().min(1).max(3650),
  otRoundMinutes: z.coerce.number().int().min(1).max(60),
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  matchThreshold: 0.55,
  matchMargin: 0.05,
  livenessThreshold: 0.5,
  livenessServerThreshold: 0.5,
  absentAfterMinutes: 30,
  snapshotRetentionDays: 90,
  otRoundMinutes: 15,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.appSetting.findMany();
  const raw: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
  for (const r of rows) if (r.key in raw) raw[r.key] = r.value;
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
}

/** Cấu hình dạng chuỗi (không thuộc bộ ngưỡng số). */
export const STRING_SETTINGS = ["zaloGroupId"] as const;
export type StringSettingKey = (typeof STRING_SETTINGS)[number];

export async function getStringSetting(key: StringSettingKey): Promise<string> {
  const r = await prisma.appSetting.findUnique({ where: { key } });
  return r?.value ?? "";
}

export async function saveStringSetting(key: StringSettingKey, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function saveSettings(s: Partial<AppSettings>) {
  await prisma.$transaction(
    Object.entries(s).map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } }),
    ),
  );
}
