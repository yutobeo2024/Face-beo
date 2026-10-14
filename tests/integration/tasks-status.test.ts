/** v1.23.0 — đổi trạng thái (kéo thẻ): việc con chưa xong, completedAt, xung đột 409, phụ thuộc vòng lặp. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setupTasksFixture } from "./tasks-fixture";

const f = setupTasksFixture("TS");
const P = (id: number) => ({ id: String(id) });
let pid = 0;

beforeAll(async () => {
  pid = await f.project("MGR", { E1: "MEMBER" });
});

const status = (id: number, s: string, fromStatus?: string) => f.as("MGR", "tasks/[id]/status", "POST", { status: s, fromStatus }, P(id));

describe("trạng thái", () => {
  it("sang Hoàn thành khi còn việc con chưa xong → 400 SUBTASKS_PENDING kèm danh sách", async () => {
    const t = await f.task("MGR", pid, { subtasks: ["gọi khách", "gửi báo giá"] });
    const r = await status(t.id, "DONE");
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.code).toBe("SUBTASKS_PENDING");
    expect(body.pending.map((p: { text: string }) => p.text)).toEqual(["gọi khách", "gửi báo giá"]);
    const { task } = await f.ok<{ task: { subtasks: { id: number; text: string; done: boolean }[] } }>(
      f.as("MGR", "tasks/[id]/subtasks", "PUT", { subtasks: [{ text: "gọi khách", done: true }, { text: "gửi báo giá", done: true }] }, P(t.id)),
    );
    expect(task.subtasks.every((s) => s.done)).toBe(true);
    await f.ok(status(t.id, "DONE"));
  });
  it("completedAt đặt khi sang Hoàn thành, xóa khi kéo ngược lại", async () => {
    const t = await f.task("MGR", pid);
    await f.ok(status(t.id, "DONE"));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).completedAt).not.toBeNull();
    await f.ok(status(t.id, "REVIEW"));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).completedAt).toBeNull();
  });
  it("fromStatus lệch (người khác vừa kéo) → 409 kèm trạng thái hiện tại", async () => {
    const t = await f.task("MGR", pid);
    await f.ok(status(t.id, "DOING", "TODO"));
    const r = await status(t.id, "REVIEW", "TODO");
    expect(r.status).toBe(409);
    expect((await r.json()).status).toBe("DOING");
  });
  it("hai người kéo cùng lúc từ cùng trạng thái: đúng một lượt thành công", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1] });
    const [a, b] = await Promise.all([status(t.id, "DOING", "TODO"), f.as("E1", "tasks/[id]/status", "POST", { status: "REVIEW", fromStatus: "TODO" }, P(t.id))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { action: "TASK_STATUS", entityId: String(t.id) } })).toBe(1);
  });
  it("kéo về đúng trạng thái đang có: không ghi gì", async () => {
    const t = await f.task("MGR", pid);
    await f.ok(status(t.id, "TODO"));
    expect(await prisma.auditLog.count({ where: { action: "TASK_STATUS", entityId: String(t.id) } })).toBe(0);
  });
  it("việc con: tối đa 50", async () => {
    const t = await f.task("MGR", pid);
    const many = Array.from({ length: 51 }, (_, i) => ({ text: `v${i}`, done: false }));
    expect((await f.as("MGR", "tasks/[id]/subtasks", "PUT", { subtasks: many }, P(t.id))).status).toBe(400);
  });
});

describe("phụ thuộc", () => {
  it("cùng dự án, không tự trỏ, không vòng lặp", async () => {
    const a = await f.task("MGR", pid, { title: "A" });
    const b = await f.task("MGR", pid, { title: "B" });
    const c = await f.task("MGR", pid, { title: "C" });
    const other = await f.task("MGR", await f.project("MGR"), { title: "khác dự án" });
    const deps = (id: number, dependsOn: number[]) => f.as("MGR", "tasks/[id]/dependencies", "PUT", { dependsOn }, P(id));
    expect((await deps(a.id, [a.id])).status).toBe(400);
    expect((await deps(a.id, [other.id])).status).toBe(400);
    await f.ok(deps(b.id, [a.id])); // B chờ A
    await f.ok(deps(c.id, [b.id])); // C chờ B
    expect((await deps(a.id, [c.id])).status).toBe(400); // A chờ C ⇒ vòng A→C→B→A
    const { task } = await f.ok<{ task: { dependsOn: number[] } }>(f.as("MGR", "tasks/[id]", "GET", undefined, P(c.id)));
    expect(task.dependsOn).toEqual([b.id]);
  });
});
