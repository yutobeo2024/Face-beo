/**
 * Dò ngưỡng kiểm đồng phục trên dữ liệu đã được Nhân sự gắn nhãn (dùng cho `npm run uniform:eval`).
 * Tách khỏi script để test được cách XẾP HẠNG — chỗ này sai là đề xuất ngưỡng sai mà vẫn trông "đẹp".
 */
import { decideUniform, type TemplateScore, type UniformQuality, type UniformThresholds } from "./uniform-score";

export type EvalCase = {
  truth: "PASS" | "FAIL";
  scores: Omit<TemplateScore, "score">[];
  quality: UniformQuality | null;
  pattern: number | null;
};

export type EvalResult = { th: UniformThresholds; falseAccuse: number; caught: number; review: number; missed: number };

/** Trần báo oan mà chủ dự án đã chốt. */
export const MAX_FALSE_ACCUSE = 0.02;
/** Dưới mức này đề xuất chỉ để tham khảo và KHÔNG được ghi vào Cấu hình (`--apply`). */
export const MIN_EVAL_CASES = { pass: 30, fail: 10 };

export const EVAL_GRID = { pass: range(0.3, 0.85, 0.025), fail: range(0.25, 0.7, 0.025), colorWeight: [0.3, 0.4, 0.5, 0.6] };

function range(a: number, b: number, step: number) {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Điểm gộp phụ thuộc trọng số màu nên phải tính lại cho từng tổ hợp. */
function withCombined(scores: Omit<TemplateScore, "score">[], th: UniformThresholds): TemplateScore[] {
  return scores
    .map((s) => ({ ...s, score: s.embedScore === null ? s.colorScore : (1 - th.colorWeight) * s.embedScore + th.colorWeight * s.colorScore }))
    .sort((a, b) => b.score - a.score);
}

export function evaluateThresholds(cases: EvalCase[], th: UniformThresholds): EvalResult {
  let falseAccuse = 0;
  let caught = 0;
  let review = 0;
  let missed = 0;
  for (const c of cases) {
    const v = decideUniform({ scores: withCombined(c.scores, th), quality: c.quality, pattern: c.pattern, th });
    if (v.status === "REVIEW") review++;
    if (c.truth === "PASS" && v.status === "FAIL") falseAccuse++;
    if (c.truth === "FAIL") {
      if (v.status === "FAIL") caught++;
      else if (v.status === "PASS") missed++;
    }
  }
  return { th, falseAccuse, caught, review, missed };
}

export function sweepThresholds(cases: EvalCase[], grid = EVAL_GRID): EvalResult[] {
  const out: EvalResult[] = [];
  for (const colorWeight of grid.colorWeight)
    for (const passColor of grid.pass)
      for (const passEmbed of grid.pass)
        for (const failScore of grid.fail) out.push(evaluateThresholds(cases, { passColor, passEmbed, failScore, colorWeight }));
  return out;
}

/**
 * Lọc tổ hợp dưới trần báo oan rồi xếp hạng: BỎ SÓT ít nhất → bắt được nhiều nhất → ít phải xem lại → ít báo oan;
 * còn hòa thì chọn tổ hợp CHẶT nhất (màu, hình dáng cao nhất; mốc "trượt" thấp nhất).
 *
 * "Bỏ sót" (mặc sai mà máy cho ĐẠT) đứng đầu: lượt xem lại còn có người nhìn, lượt bỏ sót thì không ai biết — nên không
 * đổi một lượt bỏ sót lấy thêm lượt "bắt được". Bản đầu thiếu tiêu chí này nên trên dữ liệu thật 12/10/2026 đã đề xuất
 * hạ "hình dáng" 0,85 → 0,6: 2/3 lượt mặc áo sẫm gần giống navy thành ĐẠT, chỉ để bớt việc xem lại.
 *
 * Hòa thì chọn chặt vì lưới dò có hàng nghìn tổ hợp cho cùng kết quả trên vài chục lượt; lấy bản lỏng nhất (thứ tự
 * lưới) sẽ ra kiểu "màu ≥ 0,30" — coi như tắt tầng màu, áo khác màu mà dáng giống là lọt.
 */
export function rankSafe(results: EvalResult[], truthPass: number): EvalResult[] {
  return results
    .filter((r) => r.falseAccuse / Math.max(1, truthPass) <= MAX_FALSE_ACCUSE)
    .sort(
      (a, b) =>
        a.missed - b.missed ||
        b.caught - a.caught ||
        a.review - b.review ||
        a.falseAccuse - b.falseAccuse ||
        b.th.passColor - a.th.passColor ||
        b.th.passEmbed - a.th.passEmbed ||
        a.th.failScore - b.th.failScore,
    );
}

export function enoughEvalData(truthPass: number, truthFail: number) {
  return truthPass >= MIN_EVAL_CASES.pass && truthFail >= MIN_EVAL_CASES.fail;
}
