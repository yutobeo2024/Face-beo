// v1.22.1: cách XẾP HẠNG ngưỡng của `npm run uniform:eval`. Bản cũ bỏ quên "bỏ sót" nên đề xuất hạ ngưỡng
// cho áo sai lọt thành ĐẠT chỉ để bớt việc xem lại — dữ liệu ở đây dựng theo số đo thật 03–12/10/2026.
import { describe, expect, it } from "vitest";
import { DEFAULT_UNIFORM_THRESHOLDS } from "@/lib/uniform-score";
import { enoughEvalData, evaluateThresholds, MIN_EVAL_CASES, rankSafe, sweepThresholds, type EvalCase, type EvalResult } from "@/lib/uniform-eval";

const kase = (truth: "PASS" | "FAIL", embed: number, color: number): EvalCase => ({
  truth,
  quality: { brightness: 0.4, contrast: 0.2, skin: 0.1 },
  pattern: null,
  scores: [{ templateId: 5, name: "Áo polo navy", embedScore: embed, colorScore: color, sampleCount: 7, versionOk: true, templatePattern: null }],
});

// 36 lượt mặc đúng: hình dáng 0,819–0,924 · màu 0,916–0,996 (đúng khoảng đo được ở phòng Kế toán).
const PASS_CASES = Array.from({ length: 36 }, (_, i) => kase("PASS", 0.819 + (0.105 * i) / 35, 0.916 + (0.08 * ((i * 7) % 36)) / 35));
// 3 lượt mặc sai: một áo be (màu 0,189), hai áo sẫm gần giống navy (màu vẫn 0,90–0,94).
const FAIL_CASES = [kase("FAIL", 0.587, 0.189), kase("FAIL", 0.717, 0.937), kase("FAIL", 0.775, 0.9)];
const CASES = [...PASS_CASES, ...FAIL_CASES];

const r = (o: Partial<EvalResult>): EvalResult => ({ th: DEFAULT_UNIFORM_THRESHOLDS, falseAccuse: 0, caught: 0, review: 0, missed: 0, ...o });

describe("xếp hạng ngưỡng đồng phục", () => {
  it("cùng số bắt được thì BỎ SÓT ít hơn đứng trước, dù phải xem lại nhiều hơn", () => {
    const boSot = r({ caught: 1, missed: 2, review: 0 });
    const xemLai = r({ caught: 1, missed: 0, review: 8 });
    expect(rankSafe([boSot, xemLai], 36)[0]).toBe(xemLai);
  });

  it("không đổi một lượt bỏ sót lấy thêm lượt bắt được", () => {
    const batIt = r({ caught: 1, missed: 0, review: 2 });
    const batNhieu = r({ caught: 2, missed: 1, review: 0 });
    expect(rankSafe([batNhieu, batIt], 36)[0]).toBe(batIt);
  });

  it("cùng số bỏ sót thì bắt được nhiều hơn đứng trước", () => {
    const batIt = r({ caught: 1, missed: 0, review: 2 });
    const batNhieu = r({ caught: 3, missed: 0, review: 5 });
    expect(rankSafe([batIt, batNhieu], 36)[0]).toBe(batNhieu);
  });

  it("hòa cả bốn tiêu chí thì chọn tổ hợp CHẶT nhất", () => {
    const th = (passColor: number, passEmbed: number, failScore: number) => ({ passColor, passEmbed, failScore, colorWeight: 0.5 });
    const long = r({ th: th(0.3, 0.8, 0.6) });
    const chat = r({ th: th(0.85, 0.8, 0.35) });
    const chatDang = r({ th: th(0.85, 0.85, 0.35) });
    expect(rankSafe([long, chat, chatDang], 36)[0]).toBe(chatDang);
  });

  it("loại tổ hợp vượt trần báo oan 2 %", () => {
    const oan = r({ caught: 3, falseAccuse: 1 }); // 1/36 = 2,8 %
    const sach = r({ caught: 1 });
    expect(rankSafe([oan, sach], 36)).toEqual([sach]);
  });

  it("trên dữ liệu thật, đề xuất tốt nhất không để lọt áo sai nào thành ĐẠT", () => {
    const ranked = rankSafe(sweepThresholds(CASES), PASS_CASES.length);
    expect(ranked.length).toBeGreaterThan(0);
    // Có tổ hợp không bỏ sót ⇒ tổ hợp đứng đầu phải không bỏ sót (bản cũ chọn tổ hợp sót 2/3).
    expect(ranked.some((x) => x.missed === 0)).toBe(true);
    expect(ranked[0].missed).toBe(0);
    expect(ranked[0].falseAccuse).toBe(0);
    // Không "tắt" tầng màu: áo be (màu 0,19) phải bị chặn bởi màu chứ không chỉ nhờ hình dáng.
    expect(ranked[0].th.passColor).toBeGreaterThan(0.19);
  });

  it("ngưỡng mặc định: bắt áo be, đưa hai áo sẫm sang xem lại, không báo oan ai", () => {
    const now = evaluateThresholds(CASES, DEFAULT_UNIFORM_THRESHOLDS);
    expect(now).toMatchObject({ caught: 1, missed: 0, falseAccuse: 0 });
  });

  it("chưa đủ dữ liệu thì không được ghi vào Cấu hình", () => {
    expect(enoughEvalData(36, 3)).toBe(false);
    expect(enoughEvalData(MIN_EVAL_CASES.pass - 1, MIN_EVAL_CASES.fail)).toBe(false);
    expect(enoughEvalData(MIN_EVAL_CASES.pass, MIN_EVAL_CASES.fail)).toBe(true);
  });
});
