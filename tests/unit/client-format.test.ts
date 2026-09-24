// v1.16.0: bỏ luxon ở phía trình duyệt. Test đối chiếu từng hàm với luxon (vẫn dùng ở phía máy chủ) để chắc không lệch giờ / lệch ngày.
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { addDaysStr, addMonthsStr, fmtDateTime, fmtDay, fmtDayShort, fmtMinutes, fmtTime, fromLocalInput, mondayOf, relTime, todayStr, toLocalInput, weekdayOf } from "@/lib/client/format";

const TZ = "Asia/Ho_Chi_Minh";
const lux = (iso: string) => DateTime.fromISO(iso).setZone(TZ);
// Mốc trải đều: đầu/cuối tháng, qua ngày theo giờ VN, năm nhuận, giao thừa dương lịch.
const STAMPS = [
  "2026-09-24T01:30:00.000Z", // 08:30 24/09 giờ VN
  "2026-09-24T17:05:00.000Z", // 00:05 25/09 giờ VN — đổi ngày
  "2026-01-31T23:59:59.000Z",
  "2024-02-28T16:00:00.000Z", // 23:00 28/02 năm nhuận
  "2026-12-31T17:00:00.000Z", // 00:00 01/01/2027 giờ VN
];
const DAYS = ["2026-09-24", "2026-01-01", "2026-12-31", "2024-02-29", "2026-03-01"];

describe("định dạng ngày giờ phía trình duyệt (không luxon)", () => {
  it("giờ và ngày giờ đầy đủ khớp luxon", () => {
    for (const s of STAMPS) {
      expect(fmtTime(s), s).toBe(lux(s).toFormat("HH:mm"));
      expect(fmtDateTime(s), s).toBe(lux(s).toFormat("HH:mm dd/MM/yyyy"));
      expect(fmtTime(new Date(s)), s).toBe(lux(s).toFormat("HH:mm"));
    }
  });

  it("ngày dạng chuỗi: hiển thị, thứ trong tuần, cộng ngày, thứ Hai đầu tuần", () => {
    for (const d of DAYS) {
      const l = DateTime.fromISO(d, { zone: TZ });
      expect(fmtDay(d), d).toBe(l.toFormat("dd/MM/yyyy"));
      expect(fmtDayShort(d), d).toBe(l.toFormat("dd/MM"));
      expect(weekdayOf(d), d).toBe(l.weekday);
      expect(mondayOf(d), d).toBe(l.startOf("week").toISODate());
      for (const n of [-31, -7, -1, 0, 1, 7, 45]) expect(addDaysStr(d, n), `${d}+${n}`).toBe(l.plus({ days: n }).toISODate());
    }
  });

  it("chuyển tháng (nút tháng trước / tháng sau)", () => {
    for (const m of ["2026-09", "2026-01", "2026-12", "2024-02"]) {
      for (const n of [-13, -1, 1, 5]) {
        expect(addMonthsStr(m, n), `${m}+${n}`).toBe(DateTime.fromISO(`${m}-01`, { zone: TZ }).plus({ months: n }).toFormat("yyyy-LL"));
      }
    }
  });

  it("ô nhập datetime-local đi và về không lệch", () => {
    for (const s of STAMPS) {
      const local = toLocalInput(s);
      expect(local, s).toBe(lux(s).toFormat("yyyy-LL-dd'T'HH:mm"));
      // Đi vòng: ISO → ô nhập → ISO (giây bị cắt nên so tới phút).
      expect(fromLocalInput(local).slice(0, 16)).toBe(new Date(s).toISOString().slice(0, 16));
      expect(fromLocalInput(local)).toBe(DateTime.fromISO(local, { zone: TZ }).toUTC().toISO({ suppressMilliseconds: false })!.replace("+00:00", "Z"));
    }
  });

  it("hôm nay tính theo giờ Việt Nam", () => {
    expect(todayStr()).toBe(DateTime.now().setZone(TZ).toISODate());
  });

  it("thời gian tương đối bằng tiếng Việt", () => {
    const now = Date.now();
    expect(relTime(new Date(now - 3 * 3600_000).toISOString())).toContain("giờ");
    // Intl nói kiểu tự nhiên: "Hôm kia" thay vì "2 ngày trước" — vẫn là tiếng Việt, chấp nhận cả hai.
    expect(relTime(new Date(now - 2 * 86_400_000).toISOString())).toMatch(/ngày|Hôm kia/);
    expect(relTime(new Date(now + 5 * 60_000).toISOString())).toContain("phút");
    expect(typeof relTime(new Date(now).toISOString())).toBe("string");
  });

  it("số phút thành giờ phút", () => {
    expect(fmtMinutes(0)).toBe("0");
    expect(fmtMinutes(45)).toBe("45p");
    expect(fmtMinutes(60)).toBe("1g");
    expect(fmtMinutes(125)).toBe("2g05");
  });
});
