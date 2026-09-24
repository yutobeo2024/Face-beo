/**
 * QC v1.16.0 — các ca hiểm cho bộ định dạng ngày giờ phía trình duyệt sau khi bỏ luxon.
 * Bổ sung cho tests/unit/client-format.test.ts: mốc quanh nửa đêm giờ VN, biên tháng / năm, ngày nhuận,
 * cộng ngày với N lớn, thứ Hai đầu tuần cho cả 7 thứ, đi vòng ô nhập datetime-local với 50 mốc ngẫu nhiên
 * (có seed, chạy lại ra đúng kết quả cũ) và đầu vào rác.
 * Mọi khẳng định "đúng" đều đối chiếu với luxon (vẫn dùng ở phía máy chủ) để không tự xác nhận chính mình.
 */
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  addDaysStr,
  addMonthsStr,
  fmtDateTime,
  fmtDay,
  fmtDayShort,
  fmtMinutes,
  fmtTime,
  fromLocalInput,
  mondayOf,
  toLocalInput,
  weekdayOf,
  WEEKDAY_SHORT,
} from "@/lib/client/format";

const TZ = "Asia/Ho_Chi_Minh";
const lux = (iso: string) => DateTime.fromISO(iso).setZone(TZ);

// Mốc UTC được chọn để rơi đúng vào ranh giới theo GIỜ VN (UTC+7): 17:00Z = 00:00 hôm sau.
const EDGE_STAMPS = [
  "2026-09-23T16:59:59.999Z", // 23:59 23/09 giờ VN — sát nửa đêm
  "2026-09-23T17:00:00.000Z", // 00:00 24/09 giờ VN — vừa qua nửa đêm
  "2026-09-23T17:00:00.001Z",
  "2025-12-31T16:59:59.999Z", // 23:59 31/12/2025
  "2025-12-31T17:00:00.000Z", // 00:00 01/01/2026 — biên năm
  "2026-01-31T17:00:00.000Z", // 00:00 01/02/2026 — biên tháng
  "2024-02-28T17:00:00.000Z", // 00:00 29/02/2024 — ngày nhuận
  "2024-02-29T17:00:00.000Z", // 00:00 01/03/2024 — hết ngày nhuận
  "2023-02-28T17:00:00.000Z", // 00:00 01/03/2023 — năm không nhuận
  "2026-06-30T17:00:00.000Z", // 00:00 01/07/2026
  "2026-12-31T16:59:59.000Z", // 23:59 31/12/2026
  "1975-06-13T17:00:00.000Z", // mốc sớm nhất còn đúng: VN chuyển hẳn sang UTC+7 từ 13/06/1975
];

describe("QC — giờ / ngày giờ quanh nửa đêm, biên tháng, biên năm, ngày nhuận", () => {
  it("fmtTime và fmtDateTime khớp luxon ở mọi mốc ranh giới", () => {
    for (const s of EDGE_STAMPS) {
      expect(fmtTime(s), `fmtTime ${s}`).toBe(lux(s).toFormat("HH:mm"));
      expect(fmtDateTime(s), `fmtDateTime ${s}`).toBe(lux(s).toFormat("HH:mm dd/MM/yyyy"));
    }
  });

  it("nhận cả đối tượng Date, không chỉ chuỗi ISO", () => {
    for (const s of EDGE_STAMPS) {
      expect(fmtTime(new Date(s)), `Date ${s}`).toBe(fmtTime(s));
      expect(fmtDateTime(new Date(s)), `Date ${s}`).toBe(fmtDateTime(s));
    }
  });

  it("chuỗi ISO có sẵn múi giờ khác UTC vẫn ra giờ VN", () => {
    // Cùng một khoảnh khắc viết theo 3 cách: kết quả phải như nhau.
    const same = ["2026-09-24T01:30:00.000Z", "2026-09-24T08:30:00+07:00", "2026-09-23T21:30:00-04:00"];
    for (const s of same) expect(fmtDateTime(s), s).toBe("08:30 24/09/2026");
  });

  it("ngày dạng chuỗi ở biên tháng / năm / ngày nhuận", () => {
    for (const d of ["2024-02-29", "2024-03-01", "2023-02-28", "2026-01-01", "2026-12-31", "2100-02-28"]) {
      const l = DateTime.fromISO(d, { zone: TZ });
      expect(fmtDay(d), d).toBe(l.toFormat("dd/MM/yyyy"));
      expect(fmtDayShort(d), d).toBe(l.toFormat("dd/MM"));
    }
  });
});

describe("QC — cộng ngày, thứ trong tuần, thứ Hai đầu tuần", () => {
  it("addDaysStr qua biên tháng / năm / ngày nhuận, kể cả N lớn (±400)", () => {
    const days = ["2024-02-28", "2024-02-29", "2024-03-01", "2025-12-31", "2026-01-01", "2026-01-31", "2026-08-31"];
    const steps = [-400, -366, -365, -100, -31, -30, -1, 0, 1, 28, 29, 30, 31, 365, 366, 400];
    for (const d of days) {
      const l = DateTime.fromISO(d, { zone: TZ });
      for (const n of steps) {
        expect(addDaysStr(d, n), `${d} + ${n}`).toBe(l.plus({ days: n }).toISODate());
      }
    }
  });

  it("cộng rồi trừ đúng bằng N thì quay về ngày cũ", () => {
    for (const d of ["2024-02-29", "2026-01-01", "2026-12-31"]) {
      for (const n of [1, 7, 31, 365, 400]) expect(addDaysStr(addDaysStr(d, n), -n), `${d} ±${n}`).toBe(d);
    }
  });

  it("weekdayOf trả 1..7 (thứ Hai..Chủ nhật) khớp luxon cho cả 7 thứ của một tuần", () => {
    const week = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
    const seen: number[] = [];
    for (const d of week) {
      const l = DateTime.fromISO(d, { zone: TZ });
      expect(weekdayOf(d), d).toBe(l.weekday);
      seen.push(weekdayOf(d));
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Nhãn tiếng Việt phải tra được bằng chính số này (Chủ nhật = 7, không phải 0).
    expect(WEEKDAY_SHORT[weekdayOf("2026-09-27")]).toBe("CN");
    expect(WEEKDAY_SHORT[weekdayOf("2026-09-21")]).toBe("T2");
  });

  it("mondayOf: cả 7 ngày trong tuần đều về đúng thứ Hai (Chủ nhật KHÔNG nhảy sang tuần sau)", () => {
    for (const d of ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]) {
      expect(mondayOf(d), d).toBe("2026-09-21");
      expect(mondayOf(d), `${d} vs luxon`).toBe(DateTime.fromISO(d, { zone: TZ }).startOf("week").toISODate());
    }
    // Tuần vắt qua năm và qua ngày nhuận.
    for (const d of ["2025-12-28", "2026-01-01", "2024-02-29", "2024-03-03"]) {
      expect(mondayOf(d), d).toBe(DateTime.fromISO(d, { zone: TZ }).startOf("week").toISODate());
    }
    expect(weekdayOf(mondayOf("2026-09-27"))).toBe(1); // bất biến: mondayOf luôn là thứ Hai
  });

  it("addMonthsStr ở biên năm và tháng 31 ngày", () => {
    for (const m of ["2026-01", "2026-12", "2024-02", "2026-08"]) {
      for (const n of [-25, -12, -1, 0, 1, 12, 25]) {
        expect(addMonthsStr(m, n), `${m} + ${n}`).toBe(DateTime.fromISO(`${m}-01`, { zone: TZ }).plus({ months: n }).toFormat("yyyy-LL"));
      }
    }
  });
});

describe("QC — ô nhập datetime-local đi và về", () => {
  /** Bộ sinh số ngẫu nhiên có seed (mulberry32): cùng seed → cùng 50 mốc, test không đỏ ngẫu nhiên. */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("50 mốc ngẫu nhiên trải suốt một năm: ISO → ô nhập → ISO không lệch phút nào", () => {
    const rand = rng(20260924);
    const start = Date.UTC(2025, 9, 1); // 01/10/2025
    const span = 400 * 86_400_000; // hơn một năm, vắt qua giao thừa và tháng 2
    for (let i = 0; i < 50; i++) {
      const ms = Math.floor((start + rand() * span) / 60_000) * 60_000; // tròn phút (ô nhập không có giây)
      const iso = new Date(ms).toISOString();
      const local = toLocalInput(iso);
      expect(local, iso).toBe(lux(iso).toFormat("yyyy-LL-dd'T'HH:mm"));
      expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local), `dạng ${local}`).toBe(true);
      expect(fromLocalInput(local), `${iso} → ${local}`).toBe(iso);
      expect(fromLocalInput(local), `${local} vs luxon`).toBe(DateTime.fromISO(local, { zone: TZ }).toUTC().toISO({ suppressMilliseconds: false })!.replace("+00:00", "Z"));
    }
  });

  it("fromLocalInput nhận cả dạng có giây 'YYYY-MM-DDTHH:mm:ss' — không ném lỗi, cùng phút với luxon", () => {
    for (const v of ["2026-09-24T08:30:45", "2026-01-01T00:00:00", "2024-02-29T23:59:59"]) {
      const short = v.slice(0, 16);
      expect(() => fromLocalInput(v)).not.toThrow();
      expect(fromLocalInput(v), v).toBe(fromLocalInput(short));
      // Giây bị cắt (ô datetime-local mặc định chỉ tới phút) — so tới phút thì khớp luxon.
      expect(fromLocalInput(v).slice(0, 17), v).toBe(DateTime.fromISO(v, { zone: TZ }).toUTC().toISO()!.slice(0, 17));
      // Ghi lại hành vi thật: giây luôn bị làm tròn về :00, KHÔNG giữ như luxon.
      expect(fromLocalInput("2026-09-24T08:30:45")).toBe("2026-09-24T01:30:00.000Z");
    }
  });

  it("fromLocalInput dạng phút 'YYYY-MM-DDTHH:mm' khớp luxon ở nửa đêm và giao thừa", () => {
    for (const v of ["2026-09-24T00:00", "2025-12-31T23:59", "2026-01-01T00:00", "2024-02-29T12:00"]) {
      expect(fromLocalInput(v), v).toBe(DateTime.fromISO(v, { zone: TZ }).toUTC().toISO({ suppressMilliseconds: false })!.replace("+00:00", "Z"));
    }
  });
});

describe("QC — đầu vào rác (ghi lại hành vi THẬT để đổi mà không ai biết thì test đỏ)", () => {
  const JUNK = ["", "abc", "2026-13-45"];

  it("các hàm hiển thị không ném lỗi, chỉ ra chuỗi 'NaN' (giao diện xấu chứ không trắng trang)", () => {
    for (const s of JUNK) {
      expect(() => fmtTime(s), `fmtTime ${s}`).not.toThrow();
      expect(fmtTime(s), `fmtTime ${s}`).toBe("NaN:NaN");
      expect(fmtDateTime(s), `fmtDateTime ${s}`).toBe("NaN:NaN NaN/NaN/NaN");
      expect(fmtDayShort(s), `fmtDayShort ${s}`).toBe("NaN/NaN");
      expect(addDaysStr(s, 1), `addDaysStr ${s}`).toBe("NaN-NaN-NaN");
      expect(mondayOf(s), `mondayOf ${s}`).toBe("NaN-NaN-NaN");
      expect(weekdayOf(s), `weekdayOf ${s}`).toBeNaN();
    }
  });

  it("fmtDay chỉ đảo chuỗi nên không kiểm tra gì (ghi lại để khỏi tưởng nó có kiểm)", () => {
    expect(fmtDay("")).toBe("");
    expect(fmtDay("abc")).toBe("abc");
    expect(fmtDay("2026-13-45")).toBe("45/13/2026");
  });

  it("fromLocalInput với ô trống / chuỗi rác: trả chuỗi rỗng, KHÔNG ném lỗi", () => {
    // Trả rỗng để máy chủ từ chối kèm thông báo tiếng Việt (giống thời còn luxon). Nếu đổi thành ném lỗi,
    // người dùng sẽ thấy thông báo tiếng Anh "Invalid time value" ở trang Chấm công và trang Đơn từ.
    for (const s of JUNK) {
      expect(fromLocalInput(s), `fromLocalInput ${JSON.stringify(s)}`).toBe("");
    }
  });
});

describe("QC — fmtMinutes: số âm và số rất lớn", () => {
  it("số dương và 0 như mong đợi", () => {
    expect(fmtMinutes(0)).toBe("0");
    expect(fmtMinutes(1)).toBe("1p");
    expect(fmtMinutes(59)).toBe("59p");
    expect(fmtMinutes(60)).toBe("1g");
    expect(fmtMinutes(61)).toBe("1g01");
    expect(fmtMinutes(125)).toBe("2g05");
    expect(fmtMinutes(1440)).toBe("24g");
  });

  it("số rất lớn vẫn ra chuỗi hợp lý (một tháng công, một năm công)", () => {
    expect(fmtMinutes(100_000)).toBe("1666g40");
    expect(fmtMinutes(525_600)).toBe("8760g"); // 365 ngày
    expect(fmtMinutes(Number.MAX_SAFE_INTEGER)).toMatch(/^\d+g/);
  });

  it("số âm cho chuỗi VÔ NGHĨA — nơi gọi phải tự chặn (hiện đều đã lọc > 0)", () => {
    // Đây là hành vi có sẵn từ trước v1.16.0, không phải lỗi mới; ghi lại để ai định dùng cho
    // "thiếu giờ" / "công bù âm" biết là phải sửa hàm trước.
    expect(fmtMinutes(-1)).toBe("-1g-1");
    expect(fmtMinutes(-30)).toBe("-1g-30");
    expect(fmtMinutes(-60)).toBe("-1g");
    expect(fmtMinutes(-90)).toBe("-2g-30"); // đúng ra phải là "-1g30"
    expect(fmtMinutes(-125)).toBe("-3g-5");
  });

  it("NaN / Infinity không ném lỗi", () => {
    expect(() => fmtMinutes(NaN)).not.toThrow();
    expect(fmtMinutes(NaN)).toBe("0"); // !NaN === true → rơi vào nhánh "0"
    expect(() => fmtMinutes(Infinity)).not.toThrow();
  });
});

describe("QC — giới hạn đã biết của cách cộng +7 giờ cố định", () => {
  it("mốc TRƯỚC 13/06/1975 lệch 1 giờ so với luxon (Sài Gòn dùng UTC+8) — ngoài phạm vi dữ liệu của ứng dụng", () => {
    for (const s of ["1970-01-01T17:00:00.000Z", "1974-06-01T17:00:00.000Z"]) {
      expect(fmtDateTime(s), s).not.toBe(lux(s).toFormat("HH:mm dd/MM/yyyy"));
      // Lệch đúng 1 giờ: bản không luxon cho ra giờ của khoảnh khắc sớm hơn 1 tiếng.
      const earlier = new Date(new Date(s).getTime() - 3_600_000).toISOString();
      expect(fmtDateTime(s), s).toBe(lux(earlier).toFormat("HH:mm dd/MM/yyyy"));
    }
    // Từ 13/06/1975 trở đi (toàn bộ dữ liệu chấm công / đơn từ) thì khớp tuyệt đối.
    for (const s of ["1975-06-13T17:00:00.000Z", "2026-09-24T01:30:00.000Z"]) {
      expect(fmtDateTime(s), s).toBe(lux(s).toFormat("HH:mm dd/MM/yyyy"));
    }
  });
});
