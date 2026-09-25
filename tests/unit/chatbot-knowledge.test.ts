// v1.19.0: bảng gợi ý câu hỏi ở trang Chat bot chia làm 4 mục lớn theo đúng các mảng tài liệu đã nạp bên chat bot.
// Test thuần dữ liệu — canh cho danh mục không bị lệch khi có người thêm/sửa câu hỏi.
import { describe, expect, it } from "vitest";
import { ICD_GROUPS, JOB_GROUPS, REGULATION_GROUPS, SPECIALTIES, TOPICS } from "@/app/me/chatbot/knowledge";

describe("danh mục câu hỏi gợi ý của Chat bot", () => {
  it("đúng 4 mục lớn, đúng thứ tự hiển thị", () => {
    expect(TOPICS.map((t) => t.key)).toEqual(["icd", "chuyen-mon", "quy-che", "mo-ta-cong-viec"]);
    expect(TOPICS.map((t) => t.label)).toEqual(["TRA CỨU MÃ ICD", "CHUYÊN MÔN Y TẾ", "QUY CHẾ – QUY ĐỊNH", "MÔ TẢ CÔNG VIỆC"]);
  });

  it("chỉ mục đã nạp tài liệu mới bấm hỏi được", () => {
    const ready = TOPICS.filter((t) => t.ready).map((t) => t.key);
    expect(ready).toEqual(["icd", "chuyen-mon"]); // quy chế & mô tả công việc: chờ nạp bên chat bot
  });

  it("mỗi mục đều có nhóm, mỗi nhóm đều có câu hỏi, không có chuỗi rỗng", () => {
    for (const t of TOPICS) {
      expect(t.hint.trim().length, `mục ${t.key} thiếu mô tả`).toBeGreaterThan(0);
      expect(t.groups.length, `mục ${t.key} chưa có nhóm nào`).toBeGreaterThan(0);
      for (const g of t.groups) {
        expect(g.name.trim().length, `nhóm rỗng trong ${t.key}`).toBeGreaterThan(0);
        expect(g.questions.length, `nhóm "${g.name}" chưa có câu hỏi`).toBeGreaterThan(0);
        for (const q of g.questions) expect(q.trim().length, `câu hỏi rỗng trong "${g.name}"`).toBeGreaterThan(0);
      }
    }
  });

  it("không trùng tên nhóm và không trùng câu hỏi trong cùng một mục", () => {
    for (const t of TOPICS) {
      const names = t.groups.map((g) => g.name);
      expect(new Set(names).size, `mục ${t.key} có nhóm trùng tên`).toBe(names.length);
      const questions = t.groups.flatMap((g) => g.questions);
      expect(new Set(questions).size, `mục ${t.key} có câu hỏi trùng`).toBe(questions.length);
    }
  });

  it("giữ nguyên danh mục chuyên khoa cũ, gắn vào mục Chuyên môn y tế", () => {
    expect(SPECIALTIES.length).toBeGreaterThanOrEqual(28);
    expect(TOPICS.find((t) => t.key === "chuyen-mon")?.groups).toBe(SPECIALTIES);
  });

  it("các mảng rời được gắn đúng mục", () => {
    expect(TOPICS.find((t) => t.key === "icd")?.groups).toBe(ICD_GROUPS);
    expect(TOPICS.find((t) => t.key === "quy-che")?.groups).toBe(REGULATION_GROUPS);
    expect(TOPICS.find((t) => t.key === "mo-ta-cong-viec")?.groups).toBe(JOB_GROUPS);
  });

  it("câu hỏi mẫu của mục ICD hỏi đúng về mã ICD", () => {
    const questions = ICD_GROUPS.flatMap((g) => g.questions);
    expect(questions.length).toBeGreaterThanOrEqual(20);
    // Mỗi nhóm phải có ít nhất một câu nhắc tới ICD/mã, tránh viết lạc sang câu hỏi chuyên môn thuần túy.
    for (const g of ICD_GROUPS) {
      expect(g.questions.some((q) => /ICD|mã/i.test(q)), `nhóm "${g.name}" chưa có câu hỏi nào về mã`).toBe(true);
    }
  });
});
