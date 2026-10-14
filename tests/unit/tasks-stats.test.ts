// v1.24.0: số liệu Dashboard dự án — giờ cố định, mốc ngày VN; chạy được với TZ=UTC và TZ=Asia/Ho_Chi_Minh (npm run test:tz).
import { describe, expect, it } from "vitest";
import { vnDateTime } from "@/lib/attendance";
import { computeStats, type StatTask } from "@/lib/tasks/task-stats";

const at = (d: string, t: string) => vnDateTime(d, t);
const A = { id: 1, name: "Lan" };
const B = { id: 2, name: "Minh" };
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

describe("đếm theo trạng thái", () => {
  it("tổng, từng trạng thái, quá hạn (chỉ việc chưa xong có hạn trước bây giờ)", () => {
    const s = computeStats(
      [
        task({ status: "TODO", dueAt: at("2031-03-09", "17:00") }), // quá hạn
        task({ status: "DOING", dueAt: at("2031-03-10", "11:59") }), // quá hạn (trước 12:00)
        task({ status: "REVIEW", dueAt: at("2031-03-10", "12:01") }), // chưa
        task({ status: "DONE", dueAt: at("2031-03-01", "17:00"), completedAt: at("2031-03-02", "08:00") }), // xong thì không quá hạn
      ],
      NOW,
      RANGE,
    );
    expect(s).toMatchObject({ total: 4, todo: 1, doing: 1, review: 1, done: 1, overdue: 2 });
  });
  it("dự án trống", () => {
    const s = computeStats([], NOW, RANGE);
    expect(s).toMatchObject({ total: 0, overdue: 0, avgCompletionHours: null, completedInRange: 0 });
    expect(s.burnup).toHaveLength(10);
    expect(s.byAssignee).toEqual([]);
  });
});

describe("thời gian hoàn thành", () => {
  it("trung bình giờ tạo → xong, chỉ tính việc xong trong khoảng", () => {
    const s = computeStats(
      [
        task({ status: "DONE", createdAt: at("2031-03-02", "08:00"), completedAt: at("2031-03-02", "18:00") }), // 10 giờ
        task({ status: "DONE", createdAt: at("2031-03-03", "08:00"), completedAt: at("2031-03-04", "14:00") }), // 30 giờ
        task({ status: "DONE", createdAt: at("2031-02-01", "08:00"), completedAt: at("2031-02-02", "08:00") }), // ngoài khoảng
      ],
      NOW,
      RANGE,
    );
    expect(s.avgCompletionHours).toBe(20);
    expect(s.completedInRange).toBe(2);
  });
});

describe("đường tiến độ theo ngày VN", () => {
  it("việc xong 23:30 giờ VN tính cho đúng ngày đó (16:30 UTC — dễ lệch ngày nếu tính theo UTC)", () => {
    const s = computeStats(
      [
        task({ createdAt: at("2031-03-01", "08:00"), status: "DONE", completedAt: at("2031-03-03", "23:30") }),
        task({ createdAt: at("2031-03-05", "00:10") }),
      ],
      NOW,
      RANGE,
    );
    const day = (d: string) => s.burnup.find((b) => b.date === d)!;
    expect(day("2031-03-02")).toEqual({ date: "2031-03-02", scope: 1, done: 0 });
    expect(day("2031-03-03")).toEqual({ date: "2031-03-03", scope: 1, done: 1 });
    expect(day("2031-03-04")).toEqual({ date: "2031-03-04", scope: 1, done: 1 });
    expect(day("2031-03-05")).toEqual({ date: "2031-03-05", scope: 2, done: 1 });
    expect(s.burnup.map((b) => b.date)).toEqual(["2031-03-01", "2031-03-02", "2031-03-03", "2031-03-04", "2031-03-05", "2031-03-06", "2031-03-07", "2031-03-08", "2031-03-09", "2031-03-10"]);
  });
});

describe("theo người và ưu tiên", () => {
  it("việc nhiều người làm tính cho từng người; việc chưa giao vào mục 'Chưa giao' xếp cuối", () => {
    const s = computeStats(
      [
        task({ assignees: [A, B], status: "DONE", completedAt: at("2031-03-05", "10:00") }),
        task({ assignees: [A], dueAt: at("2031-03-01", "17:00") }),
        task({ assignees: [] }),
      ],
      NOW,
      RANGE,
    );
    expect(s.byAssignee).toEqual([
      { id: 1, name: "Lan", total: 2, done: 1, overdue: 1 },
      { id: 2, name: "Minh", total: 1, done: 1, overdue: 0 },
      { id: 0, name: "Chưa giao", total: 1, done: 0, overdue: 0 },
    ]);
  });
  it("ưu tiên: tổng và số còn mở; mức lạ bị bỏ qua", () => {
    const s = computeStats([task({ priority: "URGENT" }), task({ priority: "URGENT", status: "DONE" }), task({ priority: "LOW" }), task({ priority: "???" })], NOW, RANGE);
    expect(s.byPriority).toEqual({ LOW: { total: 1, open: 1 }, MEDIUM: { total: 0, open: 0 }, HIGH: { total: 0, open: 0 }, URGENT: { total: 2, open: 1 } });
  });
});
