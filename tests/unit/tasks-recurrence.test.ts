// v1.23.0: việc lặp — giờ cố định, giờ VN; chạy được với TZ=UTC và TZ=Asia/Ho_Chi_Minh (npm run test:tz).
import { describe, expect, it } from "vitest";
import { vnDateTime } from "@/lib/attendance";
import { dueOccurrences, isOccurrence, occurrenceDueAt, shiftStartDate } from "@/lib/tasks/recurrence";
import { parseMentions, reaches } from "@/lib/tasks/tasks";

const root = (recurrence: string, due: string, extra: { recurrenceTime?: string | null; startDate?: string | null } = {}) => ({
  recurrence,
  dueAt: vnDateTime(due, "17:00"),
  recurrenceTime: extra.recurrenceTime ?? null,
  startDate: extra.startDate ?? null,
});

describe("ngày lặp", () => {
  it("không sinh bản cho chính ngày hạn gốc và ngày trước đó", () => {
    expect(isOccurrence("DAILY", "2026-10-15", "2026-10-15")).toBe(false);
    expect(isOccurrence("DAILY", "2026-10-15", "2026-10-14")).toBe(false);
    expect(isOccurrence("DAILY", "2026-10-15", "2026-10-16")).toBe(true);
  });
  it("hằng tuần: cùng thứ với ngày hạn gốc", () => {
    expect(isOccurrence("WEEKLY", "2026-10-15", "2026-10-22")).toBe(true); // thứ Năm
    expect(isOccurrence("WEEKLY", "2026-10-15", "2026-10-21")).toBe(false);
  });
  it("hằng tháng: ngày 31 kẹp về cuối tháng ngắn (28/02, 30/04), tháng dài vẫn 31", () => {
    expect(isOccurrence("MONTHLY", "2026-01-31", "2026-02-28")).toBe(true);
    expect(isOccurrence("MONTHLY", "2026-01-31", "2026-02-27")).toBe(false);
    expect(isOccurrence("MONTHLY", "2026-01-31", "2026-03-31")).toBe(true);
    expect(isOccurrence("MONTHLY", "2026-01-31", "2026-03-28")).toBe(false);
    expect(isOccurrence("MONTHLY", "2026-01-31", "2026-04-30")).toBe(true);
    expect(isOccurrence("MONTHLY", "2026-01-15", "2026-02-15")).toBe(true);
    expect(isOccurrence("NONE", "2026-01-15", "2026-02-15")).toBe(false);
  });
});

describe("thời điểm sinh bản lặp", () => {
  it("bản lặp của hôm nay xuất hiện từ 00:00 giờ VN", () => {
    const t = root("DAILY", "2026-10-15");
    expect(dueOccurrences(t, vnDateTime("2026-10-16", "00:00"))).toEqual(["2026-10-16"]);
    expect(dueOccurrences(t, vnDateTime("2026-10-16", "23:59"))).toEqual(["2026-10-16"]);
    // 23:59 ngày 15 (giờ VN) = 16:59 UTC: chưa sang ngày 16 ⇒ chưa có bản nào.
    expect(dueOccurrences(t, vnDateTime("2026-10-15", "23:59"))).toEqual([]);
  });
  it("server tắt một tuần: chỉ sinh bản của hôm nay, không bù quá 24 giờ", () => {
    const t = root("DAILY", "2026-10-01");
    expect(dueOccurrences(t, vnDateTime("2026-10-09", "08:00"))).toEqual(["2026-10-09"]);
    expect(dueOccurrences(t, vnDateTime("2026-10-09", "08:00"), { lookbackHours: 72 })).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  it("bản lặp đã sinh (kể cả đã bị xóa) không sinh lại: chỉ lấy ngày sau lastOccurrence", () => {
    const t = { ...root("DAILY", "2026-10-15"), lastOccurrence: "2026-10-16" };
    expect(dueOccurrences(t, vnDateTime("2026-10-16", "08:10"))).toEqual([]);
    expect(dueOccurrences(t, vnDateTime("2026-10-17", "00:10"))).toEqual(["2026-10-17"]);
  });
  it("có 'Nhắc trước 1 tuần': bản lặp sinh sớm đúng 1 tuần trước hạn để kịp nhắc", () => {
    const t = root("WEEKLY", "2026-10-15"); // thứ Năm, hạn 17:00
    // Bản 22/10 hạn 17:00 ⇒ sinh lúc 17:00 ngày 15/10.
    expect(dueOccurrences(t, vnDateTime("2026-10-15", "16:59"), { leadHours: 168 })).toEqual([]);
    expect(dueOccurrences(t, vnDateTime("2026-10-15", "17:05"), { leadHours: 168 })).toEqual(["2026-10-22"]);
    // Nhắc trước 1 ngày: bản 22/10 sinh 17:00 ngày 21/10.
    expect(dueOccurrences(t, vnDateTime("2026-10-21", "17:05"), { leadHours: 24 })).toEqual(["2026-10-22"]);
  });
  it("hạn bản lặp = ngày đó lúc giờ hạn gốc, hoặc giờ riêng của việc lặp", () => {
    expect(occurrenceDueAt(root("DAILY", "2026-10-15"), "2026-10-20").toISOString()).toBe(vnDateTime("2026-10-20", "17:00").toISOString());
    expect(occurrenceDueAt(root("DAILY", "2026-10-15", { recurrenceTime: "09:30" }), "2026-10-20").toISOString()).toBe(vnDateTime("2026-10-20", "09:30").toISOString());
  });
  it("ngày bắt đầu giữ khoảng cách 'bắt đầu → hạn' của việc gốc", () => {
    expect(shiftStartDate(root("WEEKLY", "2026-10-15", { startDate: "2026-10-13" }), "2026-10-22")).toBe("2026-10-20");
    expect(shiftStartDate(root("WEEKLY", "2026-10-15"), "2026-10-22")).toBeNull();
  });
});

describe("tiện ích", () => {
  it("nhắc tên theo mã NV, không phân biệt hoa thường, bỏ email", () => {
    expect(parseMentions("@nv007 xem giúp, cc @NV008 và @NV007")).toEqual(["NV007", "NV008"]);
    expect(parseMentions("gửi a@b.com")).toEqual([]);
  });
  it("phát hiện vòng lặp phụ thuộc", () => {
    const edges = new Map([[1, [2]], [2, [3]]]);
    expect(reaches(edges, 1, 3)).toBe(true);
    expect(reaches(edges, 3, 1)).toBe(false);
  });
});
