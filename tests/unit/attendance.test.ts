import { describe, expect, it } from "vitest";
import {
  assignScan,
  computeDayLogs,
  decideAbsence,
  findDuplicateScan,
  otMinutes,
  resolveDayPlan,
  shouldSendLateReminder,
  summarizeDay,
  vnDateTime,
  type DayPlan,
  type RequestLite,
  type ShiftDef,
} from "@/lib/attendance";

const HC: ShiftDef = { id: 1, name: "Hành chính", startTime: "08:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5, graceEarlyMinutes: 0 };
const SANG: ShiftDef = { id: 2, name: "Sáng sớm", startTime: "07:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5, graceEarlyMinutes: 0 };
const DEM: ShiftDef = { id: 3, name: "Ca đêm", startTime: "22:00", endTime: "06:00", breakMinutes: 60, graceLateMinutes: 5, graceEarlyMinutes: 0 };
const shiftsById = new Map([HC, SANG, DEM].map((s) => [s.id, s]));

const MON = "2026-09-21"; // Thứ Hai
const SUN = "2026-09-20"; // Chủ nhật
const at = (date: string, hhmm: string) => vnDateTime(date, hhmm);
const plan = (date: string, shift: ShiftDef | null, extra: Partial<DayPlan> = {}): DayPlan => ({
  workDate: date,
  shift,
  isDayOff: !shift,
  isHoliday: false,
  source: "DEFAULT",
  ...extra,
});
const req = (id: number, type: string, from: Date, to: Date, status = "APPROVED"): RequestLite => ({ id, type, status, fromTime: from, toTime: to });
const logsAt = (date: string, ...times: string[]) => times.map((t) => ({ checkTime: at(date, t), type: "OUT" }));

describe("ca hành chính — đi trễ", () => {
  it("vào 07:58 là đúng giờ", () => {
    const [r] = computeDayLogs(plan(MON, HC), logsAt(MON, "07:58"), []);
    expect(r).toMatchObject({ type: "IN", isLate: false, lateMinutes: 0 });
  });
  it("vào 08:04 trong ân hạn, không trễ", () => {
    const [r] = computeDayLogs(plan(MON, HC), logsAt(MON, "08:04"), []);
    expect(r.isLate).toBe(false);
  });
  it("vào 08:06 trễ 6 phút (không trừ ân hạn)", () => {
    const [r] = computeDayLogs(plan(MON, HC), logsAt(MON, "08:06"), []);
    expect(r).toMatchObject({ isLate: true, lateMinutes: 6 });
  });
});

describe("ca hành chính — về sớm", () => {
  it("ra 16:50 về sớm 10 phút", () => {
    const r = computeDayLogs(plan(MON, HC), logsAt(MON, "08:00", "16:50"), []);
    expect(r[1]).toMatchObject({ type: "OUT", isEarly: true, earlyMinutes: 10 });
  });
  it("ra 17:20 không về sớm", () => {
    const r = computeDayLogs(plan(MON, HC), logsAt(MON, "08:00", "17:20"), []);
    expect(r[1]).toMatchObject({ isEarly: false, earlyMinutes: 0 });
  });
  it("lần OUT sau ghi đè kết quả lần OUT trước", () => {
    const s = summarizeDay({ plan: plan(MON, HC), logs: logsAt(MON, "08:00", "16:50", "17:05"), requests: [], now: at(MON, "23:00") });
    expect(s.isEarly).toBe(false);
    expect(s.earlyMinutes).toBe(0);
    expect(s.outTime).toEqual(at(MON, "17:05"));
    expect(s.workMinutes).toBe(8 * 60);
  });
});

describe("ca đêm 22:00–06:00", () => {
  it("IN 21:55 và OUT 06:05 hôm sau cùng thuộc ngày công bắt đầu", () => {
    const planFor = (d: string) => plan(d, DEM);
    const a = assignScan(at(MON, "21:55"), planFor);
    const b = assignScan(at("2026-09-22", "06:05"), planFor);
    expect(a.workDate).toBe(MON);
    expect(b.workDate).toBe(MON);
    const r = computeDayLogs(plan(MON, DEM), [{ checkTime: at(MON, "21:55"), type: "IN" }, { checkTime: at("2026-09-22", "06:05"), type: "OUT" }], []);
    expect(r.map((x) => x.type)).toEqual(["IN", "OUT"]);
    expect(r[0].isLate).toBe(false);
    expect(r[1].isEarly).toBe(false);
  });
});

describe("gán quét", () => {
  it("quét lại trong 120 giây không tạo log mới", () => {
    const prev = [{ id: 7, checkTime: at(MON, "08:00"), type: "IN" }];
    expect(findDuplicateScan(new Date(at(MON, "08:00").getTime() + 119_000), prev)?.id).toBe(7);
    expect(findDuplicateScan(new Date(at(MON, "08:00").getTime() + 121_000), prev)).toBeNull();
  });
  it("quét ngoài mọi cửa sổ ca => ngoài ca, shiftId = null", () => {
    const a = assignScan(at(MON, "02:00"), (d) => plan(d, HC));
    expect(a.outOfShift).toBe(true);
    expect(a.plan).toBeNull();
    expect(a.workDate).toBe(MON);
  });
  it("hai cửa sổ chồng nhau => chọn ca có mốc gần nhất", () => {
    // Hôm qua ca đêm (kết thúc 06:00, cửa sổ tới 10:00), hôm nay ca sáng 07:00 (cửa sổ từ 05:00)
    const planFor = (d: string) => (d === MON ? plan(d, SANG) : plan(d, DEM));
    expect(assignScan(at(MON, "06:10"), planFor).workDate).toBe(SUN); // gần 06:00 kết thúc ca đêm
    expect(assignScan(at(MON, "06:45"), planFor).workDate).toBe(MON); // gần 07:00 bắt đầu ca sáng
  });
});

describe("đơn đã duyệt", () => {
  it("NGHI_PHEP buổi sáng: vào 13:05 không bị tính trễ từ 08:00", () => {
    const r = req(11, "NGHI_PHEP", at(MON, "08:00"), at(MON, "13:00"));
    const [x] = computeDayLogs(plan(MON, HC), logsAt(MON, "13:05"), [r]);
    expect(x.isLate).toBe(false);
    expect(x.lateMinutes).toBe(5);
    expect(x.excusedByRequestId).toBe(11);
  });
  it("VE_SOM từ 15:00: ra 15:02 không bị về sớm và có excusedByRequestId", () => {
    const r = req(12, "VE_SOM", at(MON, "15:00"), at(MON, "17:00"));
    const res = computeDayLogs(plan(MON, HC), logsAt(MON, "07:59", "15:02"), [r]);
    expect(res[1]).toMatchObject({ isEarly: false, earlyMinutes: 0, excusedByRequestId: 12 });
  });
  it("hai đơn NGHI_PHEP nối tiếp 08–12 và 12–17 = nghỉ cả ca, không vắng", () => {
    const reqs = [req(51, "NGHI_PHEP", at(MON, "12:00"), at(MON, "17:00")), req(52, "NGHI_PHEP", at(MON, "08:00"), at(MON, "12:00"))];
    const d = decideAbsence({ plan: plan(MON, HC), hasIn: false, enrolled: true, requests: reqs, now: at(MON, "09:00"), absentAfterMinutes: 30 });
    expect(d).toEqual({ action: "SKIP", reason: "ON_LEAVE" });
    expect(summarizeDay({ plan: plan(MON, HC), logs: [], requests: reqs, now: at(MON, "18:00") }).status).toBe("ON_LEAVE");
  });
  it("đơn nghỉ chuỗi 10–12 rồi 08–10 (thứ tự bất kỳ): vào 12:00 không trễ", () => {
    const reqs = [req(53, "NGHI_PHEP", at(MON, "10:00"), at(MON, "12:00")), req(54, "NGHI_PHEP", at(MON, "08:00"), at(MON, "10:00"))];
    const [x] = computeDayLogs(plan(MON, HC), logsAt(MON, "12:00"), reqs);
    expect(x.isLate).toBe(false);
    expect(x.lateMinutes).toBe(0);
    expect(x.excusedByRequestId).toBe(53);
  });
  it("đơn PENDING/REJECTED không đổi giờ hiệu lực", () => {
    const r = req(13, "NGHI_PHEP", at(MON, "08:00"), at(MON, "13:00"), "PENDING");
    const [x] = computeDayLogs(plan(MON, HC), logsAt(MON, "13:05"), [r]);
    expect(x.isLate).toBe(true);
    expect(x.excusedByRequestId).toBeNull();
  });
});

describe("OT", () => {
  it("đơn 17:00–20:00, ra 19:40 => 150 phút", () => {
    const r = req(21, "TANG_CA_OT", at(MON, "17:00"), at(MON, "20:00"));
    const ot = otMinutes({ workDate: MON, shift: HC, inTime: at(MON, "07:55"), outTime: at(MON, "19:40"), requests: [r], otRoundMinutes: 15 });
    expect(ot.minutes).toBe(150);
    const s = summarizeDay({ plan: plan(MON, HC), logs: logsAt(MON, "07:55", "19:40"), requests: [r], now: at(MON, "23:00") });
    expect(s.otMinutes).toBe(150);
    expect(s.relatedRequestIds).toContain(21);
  });
  it("không có đơn đã duyệt => 0 phút", () => {
    const pending = req(22, "TANG_CA_OT", at(MON, "17:00"), at(MON, "20:00"), "PENDING");
    const ot = otMinutes({ workDate: MON, shift: HC, inTime: at(MON, "07:55"), outTime: at(MON, "19:40"), requests: [pending], otRoundMinutes: 15 });
    expect(ot.minutes).toBe(0);
  });
});

describe("xác định ca trong ngày", () => {
  const holidays = new Set<string>();
  it("có WorkSchedule thì dùng ca đó", () => {
    const p = resolveDayPlan({ date: MON, schedule: { shiftId: DEM.id, isDayOff: false }, defaultShift: HC, shiftsById, holidays });
    expect(p.shift?.id).toBe(DEM.id);
  });
  it("không có WorkSchedule thì dùng defaultShift", () => {
    const p = resolveDayPlan({ date: MON, schedule: null, defaultShift: HC, shiftsById, holidays });
    expect(p.shift?.id).toBe(HC.id);
  });
  it("Chủ nhật không có lịch => nghỉ", () => {
    const p = resolveDayPlan({ date: SUN, schedule: null, defaultShift: HC, shiftsById, holidays });
    expect(p.isDayOff).toBe(true);
  });
  it("isDayOff thì không bị tính vắng", () => {
    const p = resolveDayPlan({ date: MON, schedule: { shiftId: null, isDayOff: true }, defaultShift: HC, shiftsById, holidays });
    const s = summarizeDay({ plan: p, logs: [], requests: [], now: at(MON, "12:00") });
    expect(s.status).toBe("DAY_OFF");
    expect(decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [], now: at(MON, "09:00"), absentAfterMinutes: 30 }).action).toBe("SKIP");
  });
});

describe("vắng mặt", () => {
  it("ngày lễ không sinh cảnh báo vắng mặt", () => {
    const p = resolveDayPlan({ date: MON, schedule: { shiftId: HC.id, isDayOff: false }, defaultShift: HC, shiftsById, holidays: new Set([MON]) });
    const d = decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [], now: at(MON, "09:00"), absentAfterMinutes: 30 });
    expect(d).toEqual({ action: "SKIP", reason: "HOLIDAY" });
    expect(summarizeDay({ plan: p, logs: [], requests: [], now: at(MON, "12:00") }).status).toBe("HOLIDAY");
  });
  it("quá 30 phút chưa IN => cảnh báo; trước đó => chưa tới hạn", () => {
    const p = plan(MON, HC);
    expect(decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [], now: at(MON, "08:29"), absentAfterMinutes: 30 }).action).toBe("SKIP");
    expect(decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [], now: at(MON, "08:31"), absentAfterMinutes: 30 }).action).toBe("WARN");
    expect(decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [], now: at(MON, "15:00"), absentAfterMinutes: 30 })).toEqual({ action: "SKIP", reason: "TOO_OLD" });
  });
  it("đơn nghỉ PENDING chỉ đưa vào digest; APPROVED cả ca thì bỏ qua", () => {
    const p = plan(MON, HC);
    const pending = req(31, "NGHI_PHEP", at(MON, "08:00"), at(MON, "17:00"), "PENDING");
    const ok = req(32, "NGHI_PHEP", at(MON, "00:00"), at("2026-09-22", "00:00"));
    expect(decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [pending], now: at(MON, "09:00"), absentAfterMinutes: 30 }).action).toBe("DIGEST_ONLY");
    expect(decideAbsence({ plan: p, hasIn: false, enrolled: true, requests: [ok], now: at(MON, "09:00"), absentAfterMinutes: 30 })).toEqual({ action: "SKIP", reason: "ON_LEAVE" });
    expect(summarizeDay({ plan: p, logs: [], requests: [ok], now: at(MON, "12:00") }).status).toBe("ON_LEAVE");
  });
  it("chưa enroll khuôn mặt thì không cảnh báo", () => {
    expect(decideAbsence({ plan: plan(MON, HC), hasIn: false, enrolled: false, requests: [], now: at(MON, "09:00"), absentAfterMinutes: 30 }).action).toBe("SKIP");
  });
  it("hết cửa sổ ca mà chỉ có IN => thiếu giờ ra", () => {
    const s = summarizeDay({ plan: plan(MON, HC), logs: logsAt(MON, "08:00"), requests: [], now: at(MON, "21:30") });
    expect(s.missingOut).toBe(true);
  });
});

describe("nhắc đi trễ", () => {
  it("không nhắc khi có đơn PENDING phủ giờ bắt đầu ca", () => {
    const pending = req(41, "NGHI_PHEP", at(MON, "08:00"), at(MON, "10:00"), "PENDING");
    expect(shouldSendLateReminder(true, MON, HC, [pending])).toBe(false);
    expect(shouldSendLateReminder(true, MON, HC, [])).toBe(true);
    expect(shouldSendLateReminder(false, MON, HC, [])).toBe(false);
  });
  it("đơn bổ sung công trùng giờ vào ca không chặn tin nhắc trễ", () => {
    const corr = req(42, "BO_SUNG_CONG", at(MON, "08:00"), at(MON, "08:01"), "PENDING");
    expect(shouldSendLateReminder(true, MON, HC, [corr])).toBe(true);
  });
});

describe("múi giờ máy chủ", () => {
  it("mốc giờ VN không phụ thuộc process.env.TZ", () => {
    // 08:00 giờ VN = 01:00 UTC, bất kể TZ của tiến trình (chạy bằng `npm run test:tz`).
    expect(at(MON, "08:00").toISOString()).toBe("2026-09-21T01:00:00.000Z");
    const a = assignScan(new Date("2026-09-21T17:30:00.000Z"), (d) => plan(d, HC)); // 00:30 ngày 22 giờ VN
    expect(a.workDate).toBe("2026-09-22");
  });
});
