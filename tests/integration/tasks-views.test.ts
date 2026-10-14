/** v1.24.0 — Gantt / Lịch / Dashboard: lọc theo khoảng ngày, tách việc chưa có ngày bắt đầu, số liệu theo quyền, kéo thanh. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { vnDateTime } from "@/lib/attendance";
import { setupTasksFixture } from "./tasks-fixture";

const f = setupTasksFixture("TV");
const P = (id: number) => ({ id: String(id) });
const at = (d: string, t: string) => vnDateTime(d, t).toISOString();
let pid = 0;
let early: { id: number }, mid: { id: number }, late: { id: number }, forE3: { id: number };

beforeAll(async () => {
  pid = await f.project("MGR", { E1: "MEMBER", E3: "CONTRIBUTOR" });
  early = await f.task("MGR", pid, { title: `${f.tag} sớm`, dueAt: at("2031-05-01", "17:00"), startDate: "2031-04-28" });
  mid = await f.task("MGR", pid, { title: `${f.tag} giữa`, dueAt: at("2031-05-10", "23:30") }); // 23:30 VN = 16:30 UTC cùng ngày
  late = await f.task("MGR", pid, { title: `${f.tag} muộn`, dueAt: at("2031-05-11", "00:10"), startDate: "2031-05-05" });
  forE3 = await f.task("MGR", pid, { title: `${f.tag} của E3`, dueAt: at("2031-05-03", "09:00"), assigneeIds: [f.users.E3] });
});

const tasksOf = async (who: "MGR" | "E3", q: Record<string, string>) =>
  f.ok<{ tasks: { id: number }[]; unscheduled?: { id: number }[] }>(f.as(who, "tasks/projects/[id]/tasks", "GET", q, P(pid)));

describe("Lịch: lọc theo khoảng ngày VN", () => {
  it("chỉ trả việc có hạn trong [from, to]; biên ngày theo giờ VN", async () => {
    const r = await tasksOf("MGR", { from: "2031-05-02", to: "2031-05-10" });
    expect(r.tasks.map((t) => t.id).sort()).toEqual([forE3.id, mid.id].sort());
    const r2 = await tasksOf("MGR", { from: "2031-05-11", to: "2031-05-11" });
    expect(r2.tasks.map((t) => t.id)).toEqual([late.id]);
  });
  it("Cộng tác: lịch chỉ có việc của mình", async () => {
    const r = await tasksOf("E3", { from: "2031-04-01", to: "2031-06-30" });
    expect(r.tasks.map((t) => t.id)).toEqual([forE3.id]);
  });
  it("khoảng sai: thiếu một đầu, đến < từ, quá 92 ngày, ngày không có thật ⇒ 400", async () => {
    for (const q of [{ from: "2031-05-01" }, { from: "2031-05-10", to: "2031-05-01" }, { from: "2031-01-01", to: "2031-04-30" }, { from: "2031-02-30", to: "2031-03-01" }]) {
      expect((await f.as("MGR", "tasks/projects/[id]/tasks", "GET", q, P(pid))).status, JSON.stringify(q)).toBe(400);
    }
    expect((await tasksOf("MGR", { from: "2031-01-01", to: "2031-04-02" })).tasks).toBeDefined(); // đúng 92 ngày
  });
});

describe("Gantt", () => {
  it("gantt=1: thanh chỉ gồm việc có ngày bắt đầu, việc chưa có nằm ở unscheduled", async () => {
    const r = await tasksOf("MGR", { gantt: "1" });
    expect(r.tasks.map((t) => t.id).sort()).toEqual([early.id, late.id].sort());
    expect(r.unscheduled!.map((t) => t.id).sort()).toEqual([mid.id, forE3.id].sort());
  });
  it("kéo thanh = PATCH { startDate, dueAt }: các trường khác giữ nguyên", async () => {
    const t = await f.task("MGR", pid, { title: `${f.tag} kéo`, description: "giữ", priority: "HIGH", reminder: "D1", dueAt: at("2031-06-10", "16:00"), startDate: "2031-06-05", assigneeIds: [f.users.E1] });
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { startDate: "2031-06-08", dueAt: at("2031-06-13", "16:00") }, P(t.id)));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { assignees: true } });
    expect(row).toMatchObject({ startDate: "2031-06-08", description: "giữ", priority: "HIGH", reminder: "D1", status: "TODO" });
    expect(row.dueAt.toISOString()).toBe(at("2031-06-13", "16:00"));
    expect(row.assignees.map((a) => a.employeeId)).toEqual([f.users.E1]);
  });
  it("Thành viên kéo việc người khác ⇒ 403; Cộng tác kéo việc không thấy ⇒ 404; ngày bắt đầu sau hạn ⇒ 400", async () => {
    expect((await f.as("E1", "tasks/[id]", "PATCH", { startDate: "2031-04-29" }, P(early.id))).status).toBe(403);
    expect((await f.as("E3", "tasks/[id]", "PATCH", { startDate: "2031-04-29" }, P(early.id))).status).toBe(404);
    expect((await f.as("MGR", "tasks/[id]", "PATCH", { startDate: "2031-05-02" }, P(early.id))).status).toBe(400);
  });
});

describe("Dashboard", () => {
  it("số liệu đếm theo quyền: Cộng tác chỉ thấy việc của mình; người ngoài 404", async () => {
    const all = await f.ok<{ stats: { total: number; byAssignee: { id: number }[]; burnup: unknown[] } }>(
      f.as("MGR", "tasks/projects/[id]/stats", "GET", { from: "2031-05-01", to: "2031-05-31" }, P(pid)),
    );
    expect(all.stats.total).toBeGreaterThanOrEqual(4);
    expect(all.stats.burnup).toHaveLength(31);
    const mine = await f.ok<{ stats: { total: number; byAssignee: { id: number }[] } }>(f.as("E3", "tasks/projects/[id]/stats", "GET", undefined, P(pid)));
    expect(mine.stats.total).toBe(1);
    expect(mine.stats.byAssignee.map((a) => a.id)).toEqual([f.users.E3]);
    expect((await f.as("E4", "tasks/projects/[id]/stats", "GET", undefined, P(pid))).status).toBe(404);
  });
  it("mặc định 30 ngày; khoảng quá 92 ngày ⇒ 400", async () => {
    const r = await f.ok<{ stats: { burnup: unknown[] } }>(f.as("MGR", "tasks/projects/[id]/stats", "GET", undefined, P(pid)));
    expect(r.stats.burnup).toHaveLength(30);
    expect((await f.as("MGR", "tasks/projects/[id]/stats", "GET", { from: "2031-01-01", to: "2031-06-01" }, P(pid))).status).toBe(400);
  });
});
