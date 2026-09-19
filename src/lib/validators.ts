import { z } from "zod";
import { REQUEST_TYPES, ROLES } from "./roles";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "định dạng YYYY-MM-DD");
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "định dạng HH:mm");
export const idNum = z.coerce.number().int().positive();
export const optId = z.preprocess((v) => (v === "" || v == null ? undefined : v), idNum.optional());
export const isoDateTime = z.string().datetime({ offset: true }).transform((s) => new Date(s));

export const loginSchema = z.object({
  login: z.string().trim().min(3).max(32),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(8, "tối thiểu 8 ký tự")
    .max(128)
    .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), "cần có cả chữ và số"),
});

export const employeeCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/, "chỉ gồm chữ, số, - và _"),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^0\d{9,10}$/, "số điện thoại VN 10–11 số"),
  role: z.enum(ROLES),
  departmentId: idNum,
  defaultShiftId: idNum,
  // Không đặt .default(): schema sửa (partial) sẽ âm thầm điền "FIXED" => mặc định xử lý ở route tạo.
  scheduleType: z.enum(["FIXED", "ROTATING"]).optional(),
  workPatternId: z.number().int().positive().nullable().optional(),
  password: z.string().min(6).max(128).optional(),
});

export const employeeUpdateSchema = employeeCreateSchema
  .omit({ password: true, code: true })
  .partial()
  .extend({
    active: z.boolean().optional(),
    resetPassword: z.boolean().optional(),
    unlinkZalo: z.boolean().optional(),
  });

// Chuỗi rỗng / null không được coi là 0 (tránh vô tình đặt hệ số 0 công khi xóa ô nhập).
const workDayValue = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce
    .number()
    .min(0)
    .max(3)
    .refine((v) => Number.isInteger(v * 4), "Hệ số công phải là bội số của 0.25"),
);

export const shiftSchema = z.object({
  name: z.string().trim().min(2).max(50),
  startTime: timeStr,
  endTime: timeStr,
  breakMinutes: z.coerce.number().int().min(0).max(240),
  graceLateMinutes: z.coerce.number().int().min(0).max(60),
  graceEarlyMinutes: z.coerce.number().int().min(0).max(60),
  breakStart: timeStr.nullable().optional(),
  workDayValue: workDayValue.optional(),
});

/** Hệ số công của ca: 0–3, bước 0.25 (vd. 0.5 = nửa công). */
export const shiftWeightsSchema = z.object({
  weights: z.array(z.object({ departmentId: idNum, shiftId: idNum, workDayValue: z.union([z.null(), workDayValue]) })).min(1).max(500),
});

export const holidaySchema = z.object({ date: dateStr, name: z.string().trim().min(2).max(100) });

export const rosterCellSchema = z.object({
  employeeId: idNum,
  date: dateStr,
  shiftId: z.number().int().positive().nullable(),
  isDayOff: z.boolean(),
  clear: z.boolean().optional(), // true => xóa lịch, quay về ca mặc định
});
export const rosterUpdateSchema = z.object({ cells: z.array(rosterCellSchema).min(1).max(1000) });
export const copyWeekSchema = z.object({
  fromWeek: dateStr,
  toWeek: dateStr,
  departmentId: optId,
  employeeIds: z.array(idNum).optional(),
  reason: z.string().trim().max(300).optional(),
});

const reasonStr = z.string().trim().min(10, "lý do tối thiểu 10 ký tự").max(500);

export const requestCreateSchema = z.union([
  z
    .object({
      type: z.enum(REQUEST_TYPES).exclude(["BO_SUNG_CONG"]),
      fromTime: isoDateTime,
      toTime: isoDateTime,
      reason: reasonStr,
    })
    .refine((r) => r.toTime > r.fromTime, { message: "thời gian kết thúc phải sau thời gian bắt đầu", path: ["toTime"] }),
  // Đơn bổ sung công: quên chấm vào/ra tại một thời điểm cụ thể.
  z.object({
    type: z.literal("BO_SUNG_CONG"),
    correctionAt: isoDateTime,
    correctionKind: z.enum(["IN", "OUT"]),
    reason: reasonStr,
  }),
]);

export const executeCorrectionSchema = z.object({
  checkTime: isoDateTime.optional(), // mặc định = giờ ghi trong đơn
  note: z.string().trim().max(300).optional(),
});

export const decideSchema = z
  .object({ action: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional() })
  .refine((d) => d.action === "APPROVE" || (d.note && d.note.length >= 3), {
    message: "từ chối bắt buộc nhập ghi chú",
    path: ["note"],
  });

export const manualLogSchema = z.object({
  employeeId: idNum,
  checkTime: isoDateTime,
  reason: z.string().trim().min(5, "lý do tối thiểu 5 ký tự").max(300),
});

const frameScore = z.object({ real: z.number().min(0).max(1), live: z.number().min(0).max(1) });

export const kioskScanSchema = z.object({
  embedding: z.array(z.number().finite()).min(64).max(2048),
  frames: z.array(frameScore).min(1).max(10),
  snapshot: z.string().max(1_500_000).optional(),
  clientEventId: z.string().uuid(),
  capturedAt: isoDateTime,
  meshFlatness: z.number().finite().optional(), // chỉ ghi log, không dùng để quyết định
  faceSize: z.number().finite().optional(),
  // Khung mặt [x, y, w, h] theo pixel của snapshot — bắt buộc khi bật L2.
  faceBox: z.tuple([z.number().min(0), z.number().min(0), z.number().positive(), z.number().positive()]).optional(),
});

export const enrollSchema = z.object({
  samples: z
    .array(
      z.object({
        descriptor: z.array(z.number().finite()).min(64).max(2048),
        pose: z.enum(["FRONT", "LEFT", "RIGHT", "UP", "DOWN"]),
        faceSize: z.number().min(0),
      }),
    )
    .length(5, "cần đủ 5 mẫu"),
  force: z.boolean().optional(),
});

export const deviceCreateSchema = z.object({ name: z.string().trim().min(2).max(60), location: z.string().trim().max(100).optional() });
export const pairSchema = z.object({ code: z.string().regex(/^\d{6}$/, "mã gồm 6 chữ số") });

export const rangeQuery = z
  .object({ from: dateStr, to: dateStr, departmentId: optId })
  .refine((q) => q.from <= q.to, { message: "from phải trước to" });
