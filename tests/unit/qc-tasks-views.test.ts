// QC v1.24.0 — Lịch / Gantt / Dashboard: hàm thuần phía trình duyệt + schema khoảng ngày + computeStats ở các biên.
// Chạy được với TZ=UTC và TZ=Asia/Ho_Chi_Minh (`npx cross-env SKIP_DB_SETUP=1 TZ=… vitest run tests/unit/qc-tasks-views.test.ts`).
import { describe, expect, it } from "vitest";
import { vnDateTime } from "@/lib/attendance";
import { daysBetween, vnDateOf, weekdayOf } from "@/lib/client/format";
import { calendarRange, dragChange, dueOnDay, shiftAnchor } from "@/lib/tasks/view-dates";
import { MAX_RANGE_DAYS, statsQuerySchema, tasksQuerySchema } from "@/lib/tasks/schemas";
import { computeStats, type StatTask } from "@/lib/tasks/task-stats";

const at = (d: string, t: string) => vnDateTime(d, t);

describe("calendarRange — lưới tháng 6 × 7 từ thứ Hai", () => {
  const cases: [string, string, string][] = [
    // [anchor, from, to]
    ["2026-06-17", "2026-06-01", "2026-07-12"], // tháng bắt đầu đúng thứ Hai
    ["2026-03-31", "2026-02-23", "2026-04-05"], // tháng 31 ngày bắt đầu Chủ nhật — cần đủ 6 hàng
    ["2032-02-29", "2032-01-26", "2032-03-07"], // tháng 2 năm nhuận, bắt đầu Chủ nhật
    ["2027-02-01", "2027-02-01", "2027-03-14"], // tháng 2 thường bắt đầu thứ Hai (28 ngày gọn 4 hàng)
    ["2031-12-31", "2031-12-01", "2032-01-11"], // qua năm mới
  ];
  for (const [anchor, from, to] of cases) {
    it(`tháng chứa ${anchor}`, () => {
      const r = calendarRange("month", anchor);
      expect(r).toEqual({ from, to });
      expect(weekdayOf(r.from)).toBe(1);
      expect(weekdayOf(r.to)).toBe(7);
      expect(daysBetween(r.from, r.to) + 1).toBe(42);
      // ngày đầu và ngày cuối tháng đều nằm trong lưới
      const first = `${anchor.slice(0, 7)}-01`;
      expect(r.from <= first).toBe(true);
      const [y, m] = anchor.slice(0, 7).split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      expect(last <= r.to).toBe(true);
      expect(daysBetween(r.from, r.to) + 1).toBeLessThanOrEqual(MAX_RANGE_DAYS);
    });
  }
  it("mọi tháng 2026–2033: lưới luôn 42 ngày, bắt đầu thứ Hai, chứa trọn tháng", () => {
    for (let y = 2026; y <= 2033; y++) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        const r = calendarRange("month", `${ym}-15`);
        const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        expect(weekdayOf(r.from), ym).toBe(1);
        expect(daysBetween(r.from, r.to), ym).toBe(41);
        expect(r.from <= `${ym}-01` && last <= r.to, ym).toBe(true);
      }
    }
  });
  it("tuần: thứ Hai → Chủ nhật kể cả khi anchor là Chủ nhật; ngày: from = to = anchor", () => {
    expect(calendarRange("week", "2026-03-01")).toEqual({ from: "2026-02-23", to: "2026-03-01" });
    expect(calendarRange("week", "2026-06-01")).toEqual({ from: "2026-06-01", to: "2026-06-07" });
    expect(calendarRange("week", "2032-03-01")).toEqual({ from: "2032-03-01", to: "2032-03-07" });
    expect(calendarRange("week", "2032-02-29")).toEqual({ from: "2032-02-23", to: "2032-02-29" });
    expect(calendarRange("day", "2032-02-29")).toEqual({ from: "2032-02-29", to: "2032-02-29" });
  });
});

describe("shiftAnchor — nút ‹ ›", () => {
  it("tháng: từ ngày 31 không nhảy cóc tháng (31/01 + 1 tháng = 01/02, không phải 03/03)", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-03-31", -1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2032-01-31", 1)).toBe("2032-02-01");
    expect(shiftAnchor("month", "2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
    // lưới của tháng sau phải là tháng 2, không phải tháng 3
    expect(calendarRange("month", shiftAnchor("month", "2032-01-31", 1))).toEqual({ from: "2032-01-26", to: "2032-03-07" });
  });
  it("tuần ± 7 ngày, ngày ± 1 qua năm nhuận / năm mới", () => {
    expect(shiftAnchor("week", "2032-02-26", 1)).toBe("2032-03-04");
    expect(shiftAnchor("day", "2032-02-28", 1)).toBe("2032-02-29");
    expect(shiftAnchor("day", "2032-03-01", -1)).toBe("2032-02-29");
    expect(shiftAnchor("day", "2031-12-31", 1)).toBe("2032-01-01");
    expect(shiftAnchor("week", "2026-01-01", -1)).toBe("2025-12-25");
  });
});

describe("dueOnDay — kéo thanh Gantt giữ nguyên giờ hạn theo giờ VN", () => {
  it("23:30 VN (16:30 UTC) sang ngày khác vẫn 23:30 VN", () => {
    expect(dueOnDay("2031-05-10T16:30:00.000Z", "2031-05-20")).toBe("2031-05-20T16:30:00.000Z");
  });
  it("00:10 VN (17:10 UTC hôm trước) — không lệch một ngày", () => {
    const iso = dueOnDay("2031-05-10T17:10:00.000Z", "2031-05-20");
    expect(iso).toBe("2031-05-19T17:10:00.000Z");
    expect(vnDateOf(iso)).toBe("2031-05-20");
  });
  it("00:00 và 23:59 VN, qua ngày nhuận", () => {
    expect(dueOnDay(at("2031-01-01", "00:00").toISOString(), "2032-02-29")).toBe(at("2032-02-29", "00:00").toISOString());
    expect(dueOnDay(at("2031-01-01", "23:59").toISOString(), "2032-02-29")).toBe(at("2032-02-29", "23:59").toISOString());
    expect(vnDateOf(dueOnDay(at("2031-01-01", "23:59").toISOString(), "2032-02-29"))).toBe("2032-02-29");
  });
  it("kéo về đúng ngày cũ thì hạn không đổi (tới phút)", () => {
    const due = at("2031-07-04", "08:45").toISOString();
    expect(dueOnDay(due, vnDateOf(due))).toBe(due);
  });
});

describe("dragChange — thả một lần kéo trên Gantt", () => {
  const t = { startDate: "2031-05-05", dueAt: at("2031-05-10", "23:30").toISOString() }; // 23:30 VN = 16:30 UTC
  it("không dời / chưa có ngày bắt đầu ⇒ không gửi gì", () => {
    expect(dragChange(t, "move", 0)).toBeNull();
    expect(dragChange({ ...t, startDate: null }, "move", 3)).toBeNull();
  });
  it("dời cả thanh: hai ngày cùng dời, hạn giữ 23:30 VN", () => {
    expect(dragChange(t, "move", 3)).toEqual({ startDate: "2031-05-08", dueAt: at("2031-05-13", "23:30").toISOString() });
    expect(dragChange(t, "move", -5)).toEqual({ startDate: "2031-04-30", dueAt: at("2031-05-05", "23:30").toISOString() });
  });
  it("mép trái chỉ đổi ngày bắt đầu; kéo quá hạn thì dừng ở ngày của hạn", () => {
    expect(dragChange(t, "start", -2)).toEqual({ startDate: "2031-05-03" });
    expect(dragChange(t, "start", 99)).toEqual({ startDate: "2031-05-10" });
  });
  it("mép phải chỉ đổi hạn; kéo lùi quá ngày bắt đầu thì dừng ở ngày bắt đầu (giờ cũ)", () => {
    expect(dragChange(t, "end", 1)).toEqual({ dueAt: at("2031-05-11", "23:30").toISOString() });
    expect(dragChange(t, "end", -99)).toEqual({ dueAt: at("2031-05-05", "23:30").toISOString() });
  });
  it("hạn 00:10 VN (17:10 UTC hôm trước): ngày của hạn tính theo VN, không lệch", () => {
    const n = { startDate: "2031-05-11", dueAt: at("2031-05-11", "00:10").toISOString() };
    expect(dragChange(n, "start", 1)).toBeNull(); // bắt đầu đã bằng ngày của hạn ⇒ không đổi được
    expect(dragChange(n, "end", 1)).toEqual({ dueAt: at("2031-05-12", "00:10").toISOString() });
    expect(dragChange(n, "move", 18)).toEqual({ startDate: "2031-05-29", dueAt: at("2031-05-29", "00:10").toISOString() });
  });
  it("qua ngày nhuận", () => {
    const n = { startDate: "2032-02-27", dueAt: at("2032-02-28", "17:00").toISOString() };
    expect(dragChange(n, "move", 1)).toEqual({ startDate: "2032-02-28", dueAt: at("2032-02-29", "17:00").toISOString() });
    expect(dragChange(n, "end", 2)).toEqual({ dueAt: at("2032-03-01", "17:00").toISOString() });
  });
});

describe("vnDateOf / daysBetween", () => {
  it("biên 16:59:59.999 / 17:00 UTC", () => {
    expect(vnDateOf("2031-05-10T16:59:59.999Z")).toBe("2031-05-10");
    expect(vnDateOf("2031-05-10T17:00:00.000Z")).toBe("2031-05-11");
    expect(vnDateOf(new Date("2031-05-10T17:00:00.000Z"))).toBe("2031-05-11");
    expect(vnDateOf("2031-12-31T17:00:00.000Z")).toBe("2032-01-01");
    expect(vnDateOf("2032-02-28T17:00:00.000Z")).toBe("2032-02-29");
    expect(vnDateOf("2032-02-29T17:00:00.000Z")).toBe("2032-03-01");
    expect(vnDateOf("2031-05-11T00:00:00+07:00")).toBe("2031-05-11");
  });
  it("đếm ngày qua tháng 2 nhuận / không nhuận, qua năm, âm", () => {
    expect(daysBetween("2032-02-28", "2032-03-01")).toBe(2);
    expect(daysBetween("2031-02-28", "2031-03-01")).toBe(1);
    expect(daysBetween("2032-01-01", "2033-01-01")).toBe(366);
    expect(daysBetween("2031-01-01", "2032-01-01")).toBe(365);
    expect(daysBetween("2031-05-10", "2031-05-10")).toBe(0);
    expect(daysBetween("2031-05-10", "2031-05-01")).toBe(-9);
    // các tháng mà nơi khác có giờ mùa hè (3/10, 11/3) — VN không có, vẫn đúng 1 ngày
    expect(daysBetween("2031-03-29", "2031-03-30")).toBe(1);
    expect(daysBetween("2031-10-25", "2031-10-26")).toBe(1);
    expect(daysBetween("2031-03-08", "2031-03-09")).toBe(1);
  });
});

describe("schema khoảng ngày (tasksQuerySchema / statsQuerySchema)", () => {
  const ok = (v: Record<string, string>) => tasksQuerySchema.safeParse(v).success && statsQuerySchema.safeParse(v).success;
  const bad = (v: Record<string, string>) => !tasksQuerySchema.safeParse(v).success && !statsQuerySchema.safeParse(v).success;
  it("from == to; đúng 92 ngày; 93 ngày", () => {
    expect(ok({ from: "2031-05-10", to: "2031-05-10" })).toBe(true);
    expect(ok({ from: "2031-01-01", to: "2031-04-02" })).toBe(true); // 31+28+31+2 = 92
    expect(bad({ from: "2031-01-01", to: "2031-04-03" })).toBe(true); // 93
    expect(ok({ from: "2032-01-01", to: "2032-04-01" })).toBe(true); // 31+29+31+1 = 92 (năm nhuận)
    expect(bad({ from: "2032-01-01", to: "2032-04-02" })).toBe(true); // 93
  });
  it("ngày nhuận có thật / không có thật; ngày rác", () => {
    expect(ok({ from: "2032-02-29", to: "2032-02-29" })).toBe(true);
    for (const v of ["2031-02-29", "2031-13-01", "2031-00-10", "2031-04-31", "abc", "2031-5-1", "20310501", "2031-05-01T00:00", "", " 2031-05-01"]) {
      expect(bad({ from: v, to: "2031-05-10" }), v).toBe(true);
      expect(bad({ from: "2031-05-01", to: v }), v).toBe(true);
    }
  });
  it("năm ngoài 2000–2100, giá trị khổng lồ ⇒ lỗi", () => {
    expect(bad({ from: "1999-12-31", to: "2000-01-01" })).toBe(true);
    expect(bad({ from: "2100-12-31", to: "2101-01-01" })).toBe(true);
    expect(bad({ from: "2000-01-01", to: "2100-12-31" })).toBe(true);
    expect(bad({ from: "9999-01-01", to: "9999-01-02" })).toBe(true);
    expect(ok({ from: "2100-12-31", to: "2100-12-31" })).toBe(true);
  });
  it("chỉ một đầu; đến < từ", () => {
    expect(bad({ from: "2031-05-01" })).toBe(true);
    expect(bad({ to: "2031-05-01" })).toBe(true);
    expect(bad({ from: "2031-05-10", to: "2031-05-09" })).toBe(true);
    expect(ok({})).toBe(true);
  });
  it("gantt chỉ nhận 0 / 1", () => {
    expect(tasksQuerySchema.safeParse({ gantt: "1" }).success).toBe(true);
    expect(tasksQuerySchema.safeParse({ gantt: "true" }).success).toBe(false);
    expect(tasksQuerySchema.safeParse({ gantt: "2" }).success).toBe(false);
  });
});

const task = (o: Partial<StatTask>): StatTask => ({
  status: "TODO",
  priority: "MEDIUM",
  dueAt: at("2031-03-20", "17:00"),
  createdAt: at("2031-03-01", "08:00"),
  completedAt: null,
  assignees: [],
  ...o,
});
const NOW = at("2031-03-10", "12:00");
const RANGE = { from: "2031-03-01", to: "2031-03-10" };

describe("computeStats — biên", () => {
  it("quá hạn: hạn đúng bằng bây giờ thì CHƯA quá hạn; 1 ms trước thì quá hạn", () => {
    const s = computeStats([task({ dueAt: new Date(NOW.getTime()) }), task({ dueAt: new Date(NOW.getTime() - 1) })], NOW, RANGE);
    expect(s.overdue).toBe(1);
  });
  it("hoàn thành đúng 00:00 VN ngày đầu khoảng: tính; đúng 00:00 VN ngày sau ngày cuối: không tính", () => {
    const s = computeStats(
      [
        task({ status: "DONE", createdAt: at("2031-02-28", "00:00"), completedAt: at("2031-03-01", "00:00") }), // 24 giờ, trong khoảng
        task({ status: "DONE", createdAt: at("2031-03-10", "00:00"), completedAt: at("2031-03-11", "00:00") }), // ngoài khoảng
        task({ status: "DONE", createdAt: at("2031-02-27", "00:00"), completedAt: new Date(at("2031-03-01", "00:00").getTime() - 1) }), // ngoài
      ],
      NOW,
      RANGE,
    );
    expect(s.completedInRange).toBe(1);
    expect(s.avgCompletionHours).toBe(24);
  });
  it("trung bình làm tròn 1 chữ số: 80 phút ⇒ 1.3 giờ; 3 việc 1/2/2 giờ ⇒ 1.7", () => {
    expect(computeStats([task({ status: "DONE", createdAt: at("2031-03-05", "08:00"), completedAt: at("2031-03-05", "09:20") })], NOW, RANGE).avgCompletionHours).toBe(1.3);
    const s = computeStats(
      [
        task({ status: "DONE", createdAt: at("2031-03-05", "08:00"), completedAt: at("2031-03-05", "09:00") }),
        task({ status: "DONE", createdAt: at("2031-03-05", "08:00"), completedAt: at("2031-03-05", "10:00") }),
        task({ status: "DONE", createdAt: at("2031-03-05", "08:00"), completedAt: at("2031-03-05", "10:00") }),
      ],
      NOW,
      RANGE,
    );
    expect(s.avgCompletionHours).toBe(1.7);
  });
  it("burnup: việc tạo đúng 00:00 VN ngày sau không vào phạm vi ngày trước; việc xong trước khoảng tính dồn từ ngày đầu", () => {
    const s = computeStats(
      [
        task({ createdAt: at("2031-03-05", "00:00") }),
        task({ createdAt: at("2031-02-01", "08:00"), status: "DONE", completedAt: at("2031-02-10", "08:00") }),
      ],
      NOW,
      RANGE,
    );
    const day = (d: string) => s.burnup.find((b) => b.date === d)!;
    expect(day("2031-03-01")).toEqual({ date: "2031-03-01", scope: 1, done: 1 });
    expect(day("2031-03-04")).toEqual({ date: "2031-03-04", scope: 1, done: 1 });
    expect(day("2031-03-05")).toEqual({ date: "2031-03-05", scope: 2, done: 1 });
  });
  it("burnup: việc bị mở lại (completedAt = null) không còn tính là xong ở các ngày cũ", () => {
    const s = computeStats([task({ status: "TODO", completedAt: null, createdAt: at("2031-03-01", "08:00") })], NOW, RANGE);
    expect(s.burnup.every((b) => b.done === 0 && b.scope === 1)).toBe(true);
  });
  it("burnup một ngày (from = to) và 92 ngày qua 29/02", () => {
    expect(computeStats([], NOW, { from: "2031-03-10", to: "2031-03-10" }).burnup).toEqual([{ date: "2031-03-10", scope: 0, done: 0 }]);
    const b = computeStats([], NOW, { from: "2032-01-01", to: "2032-04-01" }).burnup.map((x) => x.date);
    expect(b).toHaveLength(92);
    expect(b).toContain("2032-02-29");
    expect(new Set(b).size).toBe(92);
    expect(b.at(-1)).toBe("2032-04-01");
  });
  it("burnup luôn không giảm khi không có việc mở lại; done ≤ scope", () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      task({ createdAt: at(`2031-03-${String((i % 9) + 1).padStart(2, "0")}`, "08:00"), status: i % 3 ? "TODO" : "DONE", completedAt: i % 3 ? null : at("2031-03-09", "23:59") }),
    );
    const s = computeStats(tasks, NOW, RANGE);
    for (let i = 1; i < s.burnup.length; i++) {
      expect(s.burnup[i].scope).toBeGreaterThanOrEqual(s.burnup[i - 1].scope);
      expect(s.burnup[i].done).toBeGreaterThanOrEqual(s.burnup[i - 1].done);
    }
    for (const b of s.burnup) expect(b.done).toBeLessThanOrEqual(b.scope);
    expect(s.burnup.at(-1)).toEqual({ date: "2031-03-10", scope: 20, done: 7 });
  });
  it("theo người: hòa số việc thì xếp theo tên; 'Chưa giao' luôn cuối dù nhiều việc nhất", () => {
    const X = { id: 7, name: "Bình" };
    const Y = { id: 3, name: "An" };
    const s = computeStats([task({ assignees: [X] }), task({ assignees: [Y] }), task({}), task({}), task({})], NOW, RANGE);
    expect(s.byAssignee.map((a) => a.id)).toEqual([3, 7, 0]);
    expect(s.byAssignee.at(-1)).toMatchObject({ id: 0, total: 3 });
  });
  it("đếm trạng thái cộng lại đúng tổng; trạng thái lạ không vào cột nào", () => {
    const s = computeStats([task({ status: "TODO" }), task({ status: "DOING" }), task({ status: "REVIEW" }), task({ status: "DONE", completedAt: at("2031-03-02", "08:00") }), task({ status: "WEIRD" })], NOW, RANGE);
    expect(s.total).toBe(5);
    expect(s.todo + s.doing + s.review + s.done).toBe(4);
  });
});
