/**
 * QC đối kháng v1.2 A (hệ số công, nửa ngày phép, trừ giờ nghỉ D1) — hàm thuần.
 * Test đánh dấu là lỗi thật — cố ý để fail.
 */
import { describe, expect, it } from "vitest";
import {
  approvedLeaveMinutes,
  breakFitsShift,
  breakInterval,
  dayUnits,
  netShiftMinutes,
  summarizeDay,
  vnDateTime,
  workMinutes,
  type DayPlan,
  type RequestLite,
  type ShiftDef,
} from "@/lib/attendance";

const HCB: ShiftDef = { id: 1, name: "Hành chính", startTime: "08:00", endTime: "17:00", breakMinutes: 60, breakStart: "12:00", graceLateMinutes: 5, graceEarlyMinutes: 0 };
const DEMB: ShiftDef = { id: 3, name: "Ca đêm", startTime: "22:00", endTime: "06:00", breakMinutes: 60, breakStart: "02:00", graceLateMinutes: 5, graceEarlyMinutes: 0 };
const T7S: ShiftDef = { id: 4, name: "Sáng thứ Bảy", startTime: "08:00", endTime: "12:00", breakMinutes: 0, graceLateMinutes: 5, graceEarlyMinutes: 0, workDayValue: 0.5 };
const NOBR: ShiftDef = { id: 5, name: "Ca 4h không nghỉ", startTime: "09:00", endTime: "13:00", breakMinutes: 0, breakStart: "11:00", graceLateMinutes: 5, graceEarlyMinutes: 0 };

const D = "2026-06-01"; // Thứ Hai
const D2 = "2026-06-02";
const PREV = "2026-05-31";
const at = (date: string, hhmm: string) => vnDateTime(date, hhmm);
const plan = (shift: ShiftDef | null, extra: Partial<DayPlan> = {}, date = D): DayPlan => ({ workDate: date, shift, isDayOff: !shift, isHoliday: false, source: "DEFAULT", ...extra });
let rid = 1000;
const lv = (from: Date, to: Date, status = "APPROVED", type = "NGHI_PHEP"): RequestLite => ({ id: rid++, type, status, fromTime: from, toTime: to });
const logsAt = (date: string, ...times: string[]) => times.map((t) => ({ checkTime: at(date, t), type: "OUT" }));
const sum = (p: DayPlan, logs: { checkTime: Date; type: string }[], reqs: RequestLite[] = []) =>
  summarizeDay({ plan: p, logs, requests: reqs, now: at(D2, "23:00") });

describe("QC nửa ngày phép — ngưỡng & biên", () => {
  it("nghỉ chiều đúng một nửa (13:00–17:00 = 240/480) => 0.5 + 0.5", () => {
    expect(netShiftMinutes(HCB)).toBe(480);
    expect(sum(plan(HCB), logsAt(D, "07:57", "12:02"), [lv(at(D, "13:00"), at(D, "17:00"))])).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("nghỉ thiếu 1 phút so với nửa (13:01–17:00 = 239) => vẫn 1 công, 0 phép", () => {
    const r = [lv(at(D, "13:01"), at(D, "17:00"))];
    expect(approvedLeaveMinutes(D, HCB, r)).toBe(239);
    expect(sum(plan(HCB), logsAt(D, "07:57", "13:01"), r)).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
  });

  it("nghỉ sáng 3h59 (08:00–11:59) => 1 công", () => {
    const r = [lv(at(D, "08:00"), at(D, "11:59"))];
    expect(approvedLeaveMinutes(D, HCB, r)).toBe(239);
    expect(sum(plan(HCB), logsAt(D, "11:58", "17:02"), r)).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
  });

  it("đơn phủ qua giờ nghỉ: 11:00–15:00 chỉ tính 180 phút => 1 công; 10:00–15:00 = 240 => 0.5", () => {
    expect(approvedLeaveMinutes(D, HCB, [lv(at(D, "11:00"), at(D, "15:00"))])).toBe(180);
    expect(sum(plan(HCB), logsAt(D, "07:58", "17:02"), [lv(at(D, "11:00"), at(D, "15:00"))]).workDayUnits).toBe(1);
    expect(sum(plan(HCB), logsAt(D, "07:58", "17:02"), [lv(at(D, "10:00"), at(D, "15:00"))])).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("đơn nằm trọn trong giờ nghỉ 12:00–13:00 => 0 phút phép", () => {
    expect(approvedLeaveMinutes(D, HCB, [lv(at(D, "12:00"), at(D, "13:00"))])).toBe(0);
  });

  it("hai đơn nối tiếp 13–15 + 15–17 gộp => 0.5; hai đơn chồng nhau không bị cộng đôi", () => {
    const adj = [lv(at(D, "13:00"), at(D, "15:00")), lv(at(D, "15:00"), at(D, "17:00"))];
    expect(sum(plan(HCB), logsAt(D, "07:58", "12:02"), adj)).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
    expect(approvedLeaveMinutes(D, HCB, [lv(at(D, "13:00"), at(D, "16:00")), lv(at(D, "14:00"), at(D, "17:00"))])).toBe(240);
    // Hai đơn trùng hệt 13–15: vẫn chỉ 120 phút => không đủ nửa ngày
    const dup = [lv(at(D, "13:00"), at(D, "15:00")), lv(at(D, "13:00"), at(D, "15:00"))];
    expect(approvedLeaveMinutes(D, HCB, dup)).toBe(120);
    expect(sum(plan(HCB), logsAt(D, "07:58", "17:02"), dup).workDayUnits).toBe(1);
  });

  it("đơn nằm một phần ngoài ca: chỉ tính phần trong ca", () => {
    expect(approvedLeaveMinutes(D, HCB, [lv(at(D, "15:00"), at(D, "20:00"))])).toBe(120);
    expect(approvedLeaveMinutes(D, HCB, [lv(at(D, "13:00"), at(D, "21:00"))])).toBe(240);
    // Đơn bắt đầu từ tối hôm trước tới trưa nay
    expect(approvedLeaveMinutes(D, HCB, [lv(at(PREV, "20:00"), at(D, "12:00"))])).toBe(240);
    expect(sum(plan(HCB), logsAt(D, "12:58", "17:02"), [lv(at(PREV, "20:00"), at(D, "12:00"))])).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("đơn PENDING / REJECTED / CANCELLED không làm giảm công", () => {
    for (const st of ["PENDING", "REJECTED", "CANCELLED"]) {
      expect(sum(plan(HCB), logsAt(D, "07:58", "12:02"), [lv(at(D, "13:00"), at(D, "17:00"), st)])).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
    }
  });

  it("VE_SOM phủ > nửa ca không trừ công; TANG_CA_OT không phải phép", () => {
    expect(sum(plan(HCB), logsAt(D, "07:58", "10:00"), [lv(at(D, "10:00"), at(D, "17:00"), "APPROVED", "VE_SOM")])).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
    expect(sum(plan(HCB), logsAt(D, "07:58", "17:02"), [lv(at(D, "13:00"), at(D, "17:00"), "APPROVED", "TANG_CA_OT")])).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
  });

  it("ca T7 hệ số 0.5: nghỉ cả ca = 0.5 phép; nghỉ nửa ca (10–12) = 0.25 + 0.25; 10:01–12:00 => 0.5 công", () => {
    expect(sum(plan(T7S), [], [lv(at(D, "08:00"), at(D, "12:00"))])).toMatchObject({ status: "ON_LEAVE", workDayUnits: 0, leaveDayUnits: 0.5 });
    expect(sum(plan(T7S), logsAt(D, "07:58", "10:00"), [lv(at(D, "10:00"), at(D, "12:00"))])).toMatchObject({ workDayUnits: 0.25, leaveDayUnits: 0.25 });
    expect(sum(plan(T7S), logsAt(D, "07:58", "10:01"), [lv(at(D, "10:01"), at(D, "12:00"))])).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0 });
  });

  it("đi trễ + nghỉ chiều: LATE vẫn 0.5 công + 0.5 phép", () => {
    const s = sum(plan(HCB), logsAt(D, "08:30", "12:00"), [lv(at(D, "13:00"), at(D, "17:00"))]);
    expect(s).toMatchObject({ status: "LATE", isLate: true, workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("nghỉ phép chiều 13:00–17:00, ra về 12:00 (đầu giờ nghỉ trưa) bị tính VỀ SỚM 60 phút", () => {
    const s = sum(plan(HCB), logsAt(D, "07:58", "12:00"), [lv(at(D, "13:00"), at(D, "17:00"))]);
    expect(s).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
    expect(s.isEarly).toBe(false);
  });

  it("vắng không phép = 0 / 0; hệ số 0 => 0 công", () => {
    expect(sum(plan(HCB), [])).toMatchObject({ status: "ABSENT", workDayUnits: 0, leaveDayUnits: 0 });
    expect(sum(plan(HCB, { workDayValue: 0 }), logsAt(D, "07:58", "17:02"))).toMatchObject({ workDayUnits: 0 });
    expect(dayUnits("ON_LEAVE", plan(HCB, { workDayValue: 0 }), [])).toEqual({ work: 0, leave: 0 });
  });

  it("nghỉ phép nửa ngày đã duyệt + nửa kia vắng: nửa ngày phép bị mất (ABSENT => 0 phép)", () => {
    const s = sum(plan(HCB), [], [lv(at(D, "13:00"), at(D, "17:00"))]);
    expect(s.status).toBe("ABSENT");
    expect(s.leaveDayUnits).toBe(0.5);
  });

  it("nghỉ phép sáng 08:00–12:00, vào lại 12:58 (sau giờ nghỉ trưa) vẫn bị tính ĐI TRỄ 58 phút", () => {
    const s = sum(plan(HCB), logsAt(D, "12:58", "17:02"), [lv(at(D, "08:00"), at(D, "12:00"))]);
    expect(s).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
    expect(s.isLate).toBe(false);
    expect(s.status).toBe("ON_TIME");
  });

  it("ngày lễ có ca theo lịch và đi làm => 1 công + holidayWork; ngày lễ không có ca => 0 công", () => {
    expect(sum(plan(HCB, { isHoliday: true, source: "SCHEDULE" }), logsAt(D, "07:58", "17:02"))).toMatchObject({ status: "ON_TIME", holidayWork: true, workDayUnits: 1 });
    expect(sum(plan(null, { isHoliday: true }), logsAt(D, "07:58", "17:02"))).toMatchObject({ status: "OUT_OF_SHIFT", holidayWork: true, workDayUnits: 0, leaveDayUnits: 0 });
  });
});

describe("QC ca qua đêm có giờ nghỉ sau nửa đêm", () => {
  it("giờ nghỉ 02:00 thuộc ngày hôm sau; giờ công trừ đúng phần giao", () => {
    const br = breakInterval(D, DEMB)!;
    expect(br.start.getTime()).toBe(at(D2, "02:00").getTime());
    expect(workMinutes(DEMB, at(D, "22:00"), at(D2, "06:00"), D)).toBe(420);
    expect(workMinutes(DEMB, at(D, "21:30"), at(D2, "07:00"), D)).toBe(420); // kẹp trong ca
    expect(workMinutes(DEMB, at(D2, "02:30"), at(D2, "06:00"), D)).toBe(180);
    expect(workMinutes(DEMB, at(D, "22:00"), at(D2, "01:00"), D)).toBe(180);
  });

  it("nghỉ phép 01:00–06:00 (300 − 60 nghỉ = 240 ≥ 210) => 0.5; 00:30–02:00 (90) => 1 công", () => {
    const half = [lv(at(D2, "01:00"), at(D2, "06:00"))];
    expect(approvedLeaveMinutes(D, DEMB, half)).toBe(240);
    const s = sum(plan(DEMB), [{ checkTime: at(D, "21:58"), type: "OUT" }, { checkTime: at(D2, "01:00"), type: "OUT" }], half);
    expect(s).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5, workMinutes: 180 });
    const notHalf = [lv(at(D2, "00:30"), at(D2, "02:00"))];
    expect(approvedLeaveMinutes(D, DEMB, notHalf)).toBe(90);
    expect(sum(plan(DEMB), [{ checkTime: at(D, "21:58"), type: "OUT" }, { checkTime: at(D2, "06:02"), type: "OUT" }], notHalf).workDayUnits).toBe(1);
  });

  it("breakFitsShift ca đêm: 22:00 / 00:00 / 05:00 hợp lệ; 05:30, 21:00 không hợp lệ", () => {
    expect(breakFitsShift({ ...DEMB, breakStart: "22:00" })).toBe(true);
    expect(breakFitsShift({ ...DEMB, breakStart: "00:00" })).toBe(true);
    expect(breakFitsShift({ ...DEMB, breakStart: "05:00" })).toBe(true);
    expect(breakFitsShift({ ...DEMB, breakStart: "05:30" })).toBe(false);
    expect(breakFitsShift({ ...DEMB, breakStart: "21:00" })).toBe(false);
  });
});

describe("QC ca không có giờ nghỉ (breakMinutes = 0)", () => {
  it("breakStart bị bỏ qua khi breakMinutes = 0; luôn hợp lệ", () => {
    expect(breakInterval(D, NOBR)).toBeNull();
    expect(breakFitsShift({ ...NOBR, breakStart: "23:00" })).toBe(true);
    expect(netShiftMinutes(NOBR)).toBe(240);
    expect(workMinutes(NOBR, at(D, "09:00"), at(D, "13:00"), D)).toBe(240);
    expect(workMinutes(NOBR, at(D, "09:00"), at(D, "11:00"), D)).toBe(120);
  });

  it("ca không nghỉ: đến sớm 08:30 ra 12:30 được tính 240 phút (phải kẹp trong ca 09:00–12:30 = 210)", () => {
    expect(workMinutes(NOBR, at(D, "08:30"), at(D, "12:30"), D)).toBe(210);
    expect(workMinutes(T7S, at(D, "07:30"), at(D, "11:30"), D)).toBe(210);
  });
});
