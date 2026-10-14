/** QC v1.24.0 — Lịch / Gantt / Dashboard qua route handler: biên khoảng ngày, biên giờ VN, gantt + lọc, quyền, số liệu đúng. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayVN, vnDateTime } from "@/lib/attendance";
import { saveMatrix } from "@/lib/permissions";
import { defaults, setupTasksFixture, type Who } from "./tasks-fixture";

const f = setupTasksFixture("QV");
const P = (id: number) => ({ id: String(id) });
const at = (d: string, t: string) => vnDateTime(d, t);
const TASKS = "tasks/projects/[id]/tasks";
const STATS = "tasks/projects/[id]/stats";

type Dto = { id: number };
type ListResp = { tasks: Dto[]; unscheduled?: Dto[] };
type Stats = {
  from: string;
  to: string;
  total: number;
  todo: number;
  doing: number;
  review: number;
  done: number;
  overdue: number;
  avgCompletionHours: number | null;
  completedInRange: number;
  byPriority: Record<string, { total: number; open: number }>;
  byAssignee: { id: number; name: string; total: number; done: number; overdue: number }[];
  burnup: { date: string; scope: number; done: number }[];
};
const ids = (l: Dto[] | undefined) => (l ?? []).map((t) => t.id).sort((a, b) => a - b);
const sorted = (...n: number[]) => [...n].sort((a, b) => a - b);
const list = (who: Who, pid: number, q: Record<string, string>) => f.ok<ListResp>(f.as(who, TASKS, "GET", q, P(pid)));
const stats = async (who: Who, pid: number, q?: Record<string, string>) => (await f.ok<{ stats: Stats }>(f.as(who, STATS, "GET", q, P(pid)))).stats;
const status = (who: Who, path: string, pid: number, q?: Record<string, string>) => f.as(who, path, "GET", q, P(pid)).then((r) => r.status);
const setStatus = (who: Who, id: number, s: string) => f.ok(f.as(who, "tasks/[id]/status", "POST", { status: s }, P(id)));

// ───────────────────────── Dự án lịch / Gantt ─────────────────────────
const D = "2033-05-10";
let pR = 0;
let tA: Dto, tB: Dto, tC: Dto, tD: Dto, tE: Dto;

beforeAll(async () => {
  pR = await f.project("MGR", { E1: "MEMBER", E3: "CONTRIBUTOR" });
  tA = await f.task("MGR", pR, { title: `${f.tag} A 00:00`, dueAt: at(D, "00:00").toISOString(), startDate: "2033-05-01" }); // = 2033-05-09T17:00Z
  tB = await f.task("MGR", pR, { title: `${f.tag} B 23:59`, dueAt: at(D, "23:59").toISOString() });
  tC = await f.task("MGR", pR, { title: `${f.tag} C hôm sau 00:00`, dueAt: "2033-05-10T17:00:00.000Z", startDate: "2033-05-02", assigneeIds: [f.users.E3] });
  tD = await f.task("MGR", pR, { title: `${f.tag} D 23:59:59.999`, dueAt: "2033-05-10T16:59:59.999Z" });
  tE = await f.task("MGR", pR, { title: `${f.tag} E hôm trước 23:59`, dueAt: "2033-05-09T16:59:00.000Z" });
  await setStatus("MGR", tB.id, "DOING");
  await setStatus("MGR", tD.id, "DONE");
});

describe("Lịch: biên giờ VN (00:00 / 23:59 VN = 17:00 / 16:59 UTC)", () => {
  it("from = to = ngày D: đúng 00:00, 23:59, 23:59:59.999 của D; không có 00:00 hôm sau, 23:59 hôm trước", async () => {
    expect(ids((await list("MGR", pR, { from: D, to: D })).tasks)).toEqual(sorted(tA.id, tB.id, tD.id));
  });
  it("ngày trước / ngày sau", async () => {
    expect(ids((await list("MGR", pR, { from: "2033-05-09", to: "2033-05-09" })).tasks)).toEqual([tE.id]);
    expect(ids((await list("MGR", pR, { from: "2033-05-11", to: "2033-05-11" })).tasks)).toEqual([tC.id]);
    expect(ids((await list("MGR", pR, { from: "2033-05-09", to: "2033-05-11" })).tasks)).toEqual(sorted(tA.id, tB.id, tC.id, tD.id, tE.id));
  });
  it("lọc khoảng ngày kết hợp status / done=0 / assignee", async () => {
    expect(ids((await list("MGR", pR, { from: D, to: D, status: "DOING" })).tasks)).toEqual([tB.id]);
    expect(ids((await list("MGR", pR, { from: D, to: D, done: "0" })).tasks)).toEqual(sorted(tA.id, tB.id));
    expect(ids((await list("MGR", pR, { from: "2033-05-09", to: "2033-05-11", assignee: String(f.users.E3) })).tasks)).toEqual([tC.id]);
  });
  it("không có khoảng ngày ⇒ trả mọi việc, không có khóa unscheduled", async () => {
    const r = await list("MGR", pR, {});
    expect(ids(r.tasks)).toEqual(sorted(tA.id, tB.id, tC.id, tD.id, tE.id));
    expect(r.unscheduled).toBeUndefined();
    const r0 = await list("MGR", pR, { gantt: "0" });
    expect(r0.unscheduled).toBeUndefined();
    expect(r0.tasks).toHaveLength(5);
  });
});

describe("Gantt kết hợp khoảng ngày + lọc", () => {
  type GanttResp = ListResp & { unscheduledTotal?: number };
  const gantt = (who: Who, pid: number, q: Record<string, string>) => f.ok<GanttResp>(f.as(who, TASKS, "GET", { gantt: "1", ...q }, P(pid)));
  it("gantt=1 + from/to: thanh = [ngày bắt đầu, hạn] GIAO cửa sổ; chưa có ngày bắt đầu = việc CHƯA XONG, không theo cửa sổ", async () => {
    const r = await gantt("MGR", pR, { from: D, to: D });
    expect(ids(r.tasks)).toEqual(sorted(tA.id, tC.id)); // A: 01/05 → 10/05 00:00; C: 02/05 → 11/05 00:00
    expect(ids(r.unscheduled)).toEqual(sorted(tB.id, tE.id)); // D đã xong ⇒ không liệt kê
    expect(r.unscheduledTotal).toBe(2);
  });
  it("biên giao cửa sổ: hạn đúng 00:00 VN ngày from vẫn giao; hạn 23:59 hôm trước thì không; ngày bắt đầu = to vẫn giao", async () => {
    const pG = await f.project("MGR", {});
    const g1 = await f.task("MGR", pG, { startDate: "2033-07-10", dueAt: at("2033-07-10", "00:00").toISOString() });
    const g2 = await f.task("MGR", pG, { startDate: "2033-07-12", dueAt: at("2033-07-15", "17:00").toISOString() });
    const g3 = await f.task("MGR", pG, { startDate: "2033-07-01", dueAt: at("2033-07-31", "17:00").toISOString() }); // trùm cả cửa sổ
    const g4 = await f.task("MGR", pG, { startDate: "2033-07-05", dueAt: at("2033-07-09", "23:59").toISOString() });
    expect(ids((await gantt("MGR", pG, { from: "2033-07-10", to: "2033-07-10" })).tasks)).toEqual(sorted(g1.id, g3.id));
    expect(ids((await gantt("MGR", pG, { from: "2033-07-11", to: "2033-07-11" })).tasks)).toEqual([g3.id]);
    expect(ids((await gantt("MGR", pG, { from: "2033-07-01", to: "2033-07-11" })).tasks)).toEqual(sorted(g1.id, g3.id, g4.id));
    expect(ids((await gantt("MGR", pG, { from: "2033-07-01", to: "2033-07-12" })).tasks)).toEqual(sorted(g1.id, g2.id, g3.id, g4.id));
    expect(ids((await gantt("MGR", pG, { from: "2033-08-01", to: "2033-08-31" })).tasks)).toEqual([]);
    expect(ids((await gantt("MGR", pG, { from: "2033-06-01", to: "2033-06-30" })).tasks)).toEqual([]);
    // không có cửa sổ ⇒ mọi việc có ngày bắt đầu
    expect(ids((await gantt("MGR", pG, {})).tasks)).toEqual(sorted(g1.id, g2.id, g3.id, g4.id));
  });
  it("gantt=1 + status / done=0", async () => {
    const doing = await gantt("MGR", pR, { status: "DOING" });
    expect(ids(doing.tasks)).toEqual([]);
    expect(ids(doing.unscheduled)).toEqual([tB.id]);
    expect(doing.unscheduledTotal).toBe(1);
    const open = await gantt("MGR", pR, { done: "0" });
    expect(ids(open.tasks)).toEqual(sorted(tA.id, tC.id));
    expect(ids(open.unscheduled)).toEqual(sorted(tB.id, tE.id));
    const done = await gantt("MGR", pR, { status: "DONE" });
    expect(ids(done.tasks)).toEqual([]);
    expect(ids(done.unscheduled)).toEqual([]);
    expect(done.unscheduledTotal).toBe(0);
  });
  it("gantt=1, Cộng tác: chỉ việc của mình ở cả hai danh sách và trong unscheduledTotal", async () => {
    const r = await gantt("E3", pR, {});
    expect(ids(r.tasks)).toEqual([tC.id]);
    expect(ids(r.unscheduled)).toEqual([]);
    expect(r.unscheduledTotal).toBe(0);
  });
  it("gantt lạ / khoảng sai cùng gantt=1 ⇒ 400", async () => {
    expect(await status("MGR", TASKS, pR, { gantt: "yes" })).toBe(400);
    expect(await status("MGR", TASKS, pR, { gantt: "1", from: D })).toBe(400);
    expect(await status("MGR", TASKS, pR, { gantt: "1", from: "2033-01-01", to: "2033-04-03" })).toBe(400);
  });
});

describe("Biên khoảng ngày trên cả hai route", () => {
  const good: Record<string, string>[] = [
    { from: D, to: D },
    { from: "2033-01-01", to: "2033-04-02" }, // đúng 92 ngày
    { from: "2032-01-01", to: "2032-04-01" }, // 92 ngày qua 29/02
    { from: "2032-02-29", to: "2032-02-29" },
    { from: "2100-10-01", to: "2100-12-31" },
  ];
  const bad: Record<string, string>[] = [
    { from: "2033-01-01", to: "2033-04-03" }, // 93
    { from: "2032-01-01", to: "2032-04-02" }, // 93 qua 29/02
    { from: "2033-02-29", to: "2033-03-01" },
    { from: "2033-05-01", to: "2033-04-31" },
    { from: "2033-13-01", to: "2033-13-02" },
    { from: "abc", to: "def" },
    { from: "2033-05-01T00:00:00Z", to: "2033-05-02" },
    { from: D },
    { to: D },
    { from: "2033-05-11", to: D },
    { from: "2000-01-01", to: "2100-12-31" },
    { from: "1999-12-31", to: "2000-01-01" },
    { from: "99999-01-01", to: "99999-01-02" },
  ];
  for (const path of [TASKS, STATS]) {
    it(`${path}: khoảng hợp lệ ⇒ 200`, async () => {
      for (const q of good) expect(await status("MGR", path, pR, q), JSON.stringify(q)).toBe(200);
    });
    it(`${path}: khoảng sai ⇒ 400`, async () => {
      for (const q of bad) expect(await status("MGR", path, pR, q), JSON.stringify(q)).toBe(400);
    });
    it(`${path}: id dự án hỏng ⇒ 400, không tồn tại ⇒ 404`, async () => {
      expect(await f.as("MGR", path, "GET", undefined, { id: "abc" }).then((r) => r.status)).toBe(400);
      expect(await f.as("MGR", path, "GET", undefined, { id: "0" }).then((r) => r.status)).toBe(400);
      expect(await f.as("MGR", path, "GET", undefined, { id: "999999999" }).then((r) => r.status)).toBe(404);
    });
  }
  it("stats: khoảng 92 ngày ⇒ burnup đủ 92 điểm, có 29/02, from/to trả lại đúng", async () => {
    const s = await stats("MGR", pR, { from: "2032-01-01", to: "2032-04-01" });
    expect(s.from).toBe("2032-01-01");
    expect(s.to).toBe("2032-04-01");
    expect(s.burnup).toHaveLength(92);
    expect(s.burnup.map((b) => b.date)).toContain("2032-02-29");
    expect(s.burnup.at(-1)!.date).toBe("2032-04-01");
  });
});

// ───────────────────────── Quyền ─────────────────────────
describe("Quyền trên stats + lịch + gantt", () => {
  let pX = 0;
  let mine: Dto, other: Dto, byE4: Dto;
  beforeAll(async () => {
    pX = await f.project("MGR", { E1: "MEMBER", E2: "MEMBER", E3: "CONTRIBUTOR", E4: "MEMBER" });
    mine = await f.task("MGR", pX, { dueAt: at("2033-06-10", "09:00").toISOString(), assigneeIds: [f.users.E3, f.users.E1] });
    other = await f.task("MGR", pX, { dueAt: at("2033-06-11", "09:00").toISOString(), assigneeIds: [f.users.E4], startDate: "2033-06-01" });
    byE4 = await f.task("E4", pX, { dueAt: at("2033-06-12", "09:00").toISOString() });
  });
  const routes = (q: Record<string, string> | undefined) => [
    [STATS, q],
    [TASKS, { from: "2033-06-01", to: "2033-06-30" }],
    [TASKS, { gantt: "1" }],
  ] as const;

  it("Cộng tác: stats chỉ đếm việc mình được giao; byAssignee có cả người cùng việc", async () => {
    const s = await stats("E3", pX, { from: "2033-06-01", to: "2033-06-30" });
    expect(s.total).toBe(1);
    expect(s.byAssignee.map((a) => a.id).sort()).toEqual(sorted(f.users.E1, f.users.E3));
    expect(ids((await list("E3", pX, { from: "2033-06-01", to: "2033-06-30" })).tasks)).toEqual([mine.id]);
  });
  it("Thành viên / HR (xem mọi dự án, không là thành viên) thấy đủ 3 việc", async () => {
    expect((await stats("E1", pX)).total).toBe(3);
    expect((await stats("HR", pX)).total).toBe(3);
    expect(ids((await list("HR", pX, { from: "2033-06-01", to: "2033-06-30" })).tasks)).toEqual(sorted(mine.id, other.id, byE4.id));
  });
  it("người ngoài dự án ⇒ 404 ở mọi route", async () => {
    const pY = await f.project("MGR", {});
    for (const [path, q] of routes(undefined)) expect(await status("E2", path, pY, q), path).toBe(404);
  });
  it("cựu thành viên ⇒ 404; bị gỡ thì biến khỏi byAssignee, việc của họ thành 'Chưa giao'", async () => {
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, { id: String(pX), employeeId: String(f.users.E4) }));
    for (const [path, q] of routes(undefined)) expect(await status("E4", path, pX, q), path).toBe(404);
    const s = await stats("MGR", pX);
    expect(s.total).toBe(3); // việc do cựu thành viên tạo vẫn còn
    expect(s.byAssignee.find((a) => a.id === f.users.E4)).toBeUndefined();
    expect(s.byAssignee.find((a) => a.id === 0)).toMatchObject({ total: 2 }); // `other` + `byE4`
    expect(s.byAssignee.at(-1)!.id).toBe(0);
  });
  it("người đã nghỉ (active=false) nhưng còn là thành viên: vẫn hiện trong byAssignee với số liệu của họ", async () => {
    await prisma.employee.update({ where: { id: f.users.E1 }, data: { active: false } });
    try {
      const s = await stats("MGR", pX);
      expect(s.byAssignee.find((a) => a.id === f.users.E1)).toMatchObject({ name: `${f.tag} E1`, total: 1, done: 0 });
    } finally {
      await prisma.employee.update({ where: { id: f.users.E1 }, data: { active: true } });
    }
  });
  it("không có quyền tasks.use ⇒ 403 trước cả khi kiểm dự án", async () => {
    const m = defaults();
    await saveMatrix({ ...m, EMPLOYEE: m.EMPLOYEE.filter((c) => c !== "tasks.use") });
    try {
      for (const [path, q] of routes(undefined)) expect(await status("E1", path, pX, q), path).toBe(403);
      expect(await status("E1", STATS, 999999999)).toBe(403);
    } finally {
      await saveMatrix(defaults());
    }
    expect(await status("E1", STATS, pX)).toBe(200);
  });
  it("dự án đã xóa mềm ⇒ 404 cho cả chủ dự án và HR; khôi phục thì xem lại được", async () => {
    const pD = await f.project("MGR", { E1: "MEMBER" });
    await f.task("MGR", pD, { startDate: "2029-12-01" });
    await f.ok(f.as("MGR", "tasks/projects/[id]", "DELETE", undefined, P(pD)));
    for (const who of ["MGR", "HR", "E1", "ADMIN"] as Who[]) {
      for (const [path, q] of routes(undefined)) expect(await status(who, path, pD, q), `${who} ${path}`).toBe(404);
    }
    await f.ok(f.as("MGR", "tasks/projects/[id]/restore", "POST", undefined, P(pD)));
    expect((await stats("MGR", pD)).total).toBe(1);
    expect((await list("E1", pD, { gantt: "1" })).tasks).toHaveLength(1);
  });
});

// ───────────────────────── Số liệu đúng với dữ liệu ─────────────────────────
describe("Dashboard: số liệu khớp từng việc", () => {
  let pS = 0;
  const RANGE = { from: "2033-03-01", to: "2033-03-10" };
  beforeAll(async () => {
    pS = await f.project("MGR", { E1: "MEMBER", E2: "MEMBER", E3: "CONTRIBUTOR" });
    const mk = async (body: Record<string, unknown>, data: Record<string, unknown>) => {
      const t = await f.task("MGR", pS, { dueAt: at("2033-04-30", "17:00").toISOString(), ...body });
      await prisma.task.update({ where: { id: t.id }, data });
      return t;
    };
    // t1: E1, URGENT, xong sau 10 giờ
    await mk({ assigneeIds: [f.users.E1], priority: "URGENT" }, { status: "DONE", createdAt: at("2033-03-01", "08:00"), completedAt: at("2033-03-01", "18:00") });
    // t2: E1 + E2, HIGH, đang làm, QUÁ HẠN (hạn 2025)
    await mk({ assigneeIds: [f.users.E1, f.users.E2], priority: "HIGH" }, { status: "DOING", createdAt: at("2033-03-02", "00:00"), dueAt: at("2025-01-01", "17:00") });
    // t3: chưa giao, LOW, chờ duyệt — tạo 23:59 VN
    await mk({ priority: "LOW" }, { status: "REVIEW", createdAt: at("2033-03-03", "23:59") });
    // t4: E2, MEDIUM, cần làm
    await mk({ assigneeIds: [f.users.E2] }, { status: "TODO", createdAt: at("2033-03-04", "00:00") });
    // t5: E3, MEDIUM, xong sau 25 giờ 20 phút
    await mk({ assigneeIds: [f.users.E3] }, { status: "DONE", createdAt: at("2033-03-05", "08:00"), completedAt: at("2033-03-06", "09:20") });
    // t6: E2, MEDIUM, xong đúng 00:00 VN ngày SAU khoảng ⇒ không tính vào khoảng
    await mk({ assigneeIds: [f.users.E2] }, { status: "DONE", createdAt: at("2033-03-10", "12:00"), completedAt: at("2033-03-11", "00:00") });
  });

  it("tổng / trạng thái / quá hạn / ưu tiên", async () => {
    const r = await f.ok<{ stats: Stats; truncated: boolean }>(f.as("MGR", STATS, "GET", RANGE, P(pS)));
    expect(r.truncated).toBe(false);
    const s = r.stats;
    expect(s).toMatchObject({ from: RANGE.from, to: RANGE.to, total: 6, todo: 1, doing: 1, review: 1, done: 3, overdue: 1 });
    expect(s.byPriority).toEqual({ LOW: { total: 1, open: 1 }, MEDIUM: { total: 3, open: 1 }, HIGH: { total: 1, open: 1 }, URGENT: { total: 1, open: 0 } });
  });
  it("trung bình giờ hoàn thành chỉ gồm việc xong trong khoảng: (10 + 25,33) / 2 = 17,7", async () => {
    const s = await stats("MGR", pS, RANGE);
    expect(s.completedInRange).toBe(2);
    expect(s.avgCompletionHours).toBe(17.7);
    const wide = await stats("MGR", pS, { from: "2033-03-01", to: "2033-03-11" });
    expect(wide.completedInRange).toBe(3);
  });
  it("theo người: việc nhiều người tính cho từng người; 'Chưa giao' cuối", async () => {
    const s = await stats("MGR", pS, RANGE);
    expect(s.byAssignee.map((a) => [a.id, a.total, a.done, a.overdue])).toEqual([
      [f.users.E2, 3, 1, 1],
      [f.users.E1, 2, 1, 1],
      [f.users.E3, 1, 1, 0],
      [0, 1, 0, 0],
    ]);
  });
  it("burnup theo ngày VN", async () => {
    const s = await stats("MGR", pS, RANGE);
    const day = (d: string) => s.burnup.find((b) => b.date === d);
    expect(s.burnup).toHaveLength(10);
    expect(day("2033-03-01")).toEqual({ date: "2033-03-01", scope: 1, done: 1 });
    expect(day("2033-03-02")).toEqual({ date: "2033-03-02", scope: 2, done: 1 });
    expect(day("2033-03-03")).toEqual({ date: "2033-03-03", scope: 3, done: 1 });
    expect(day("2033-03-04")).toEqual({ date: "2033-03-04", scope: 4, done: 1 });
    expect(day("2033-03-05")).toEqual({ date: "2033-03-05", scope: 5, done: 1 });
    expect(day("2033-03-06")).toEqual({ date: "2033-03-06", scope: 5, done: 2 });
    expect(day("2033-03-10")).toEqual({ date: "2033-03-10", scope: 6, done: 2 });
  });
  it("tổng các mục khớp với danh sách việc thật của API", async () => {
    const s = await stats("MGR", pS, RANGE);
    const all = await list("MGR", pS, {});
    expect(s.total).toBe(all.tasks.length);
    expect(Object.values(s.byPriority).reduce((a, b) => a + b.total, 0)).toBe(s.total);
    expect(s.todo + s.doing + s.review + s.done).toBe(s.total);
  });
  it("Cộng tác E3: chỉ việc của mình", async () => {
    const s = await stats("E3", pS, RANGE);
    expect(s).toMatchObject({ total: 1, done: 1, completedInRange: 1, avgCompletionHours: 25.3 });
    expect(s.burnup.at(-1)).toEqual({ date: "2033-03-10", scope: 1, done: 1 });
  });
});

describe("Dashboard: mặc định 30 ngày tới hôm nay (giờ VN) + việc bị mở lại", () => {
  it("không tham số ⇒ from = hôm nay − 29, to = hôm nay; burnup kết thúc hôm nay", async () => {
    const pT = await f.project("MGR", {});
    const today = todayVN();
    const s = await stats("MGR", pT);
    expect(s.to).toBe(today);
    expect(s.from).toBe(addDays(today, -29));
    expect(s.burnup).toHaveLength(30);
    expect(s.burnup[0].date).toBe(s.from);
    expect(s.burnup.at(-1)!.date).toBe(today);
  });
  it("xong rồi mở lại qua API: burnup hôm nay done 1 → 0, trung bình về null", async () => {
    const pB = await f.project("MGR", {});
    const t = await f.task("MGR", pB, {});
    const last = async () => {
      const s = await stats("MGR", pB);
      return { b: s.burnup.at(-1)!, n: s.completedInRange, avg: s.avgCompletionHours };
    };
    expect(await last()).toMatchObject({ b: { scope: 1, done: 0 }, n: 0, avg: null });
    await setStatus("MGR", t.id, "DONE");
    const done = await last();
    expect(done).toMatchObject({ b: { scope: 1, done: 1 }, n: 1 });
    expect(done.avg).toBeGreaterThanOrEqual(0);
    expect(done.avg).toBeLessThan(1);
    await setStatus("MGR", t.id, "DOING");
    expect(await last()).toMatchObject({ b: { scope: 1, done: 0 }, n: 0, avg: null });
  });
});
