// QC v1.22.1: biên đối kháng cho bộ dò ngưỡng đồng phục (`src/lib/uniform-eval.ts`).
import { describe, expect, it } from "vitest";
import { DEFAULT_UNIFORM_THRESHOLDS, QUALITY_LIMITS, decideUniform, type UniformThresholds } from "@/lib/uniform-score";
import { EVAL_GRID, MAX_FALSE_ACCUSE, evaluateThresholds, rankSafe, sweepThresholds, type EvalCase, type EvalResult } from "@/lib/uniform-eval";

const GOOD_Q = { brightness: 0.4, contrast: 0.2, skin: 0.1 };
type S = EvalCase["scores"][number];
const sc = (id: number, embed: number | null, color: number, extra: Partial<S> = {}): S => ({
  templateId: id,
  name: `Mẫu ${id}`,
  embedScore: embed,
  colorScore: color,
  sampleCount: 7,
  versionOk: embed !== null,
  templatePattern: null,
  ...extra,
});
const kase = (truth: "PASS" | "FAIL", scores: S[], quality: EvalCase["quality"] = GOOD_Q, pattern: number | null = null): EvalCase => ({ truth, scores, quality, pattern });
const r = (o: Partial<EvalResult>): EvalResult => ({ th: DEFAULT_UNIFORM_THRESHOLDS, falseAccuse: 0, caught: 0, review: 0, missed: 0, ...o });
const SMALL_GRID = { pass: [0.6, 0.8], fail: [0.5, 0.7, 0.9], colorWeight: [0.3, 0.6] };

describe("QC: rankSafe khi không có ca mặc đúng (truthPass = 0)", () => {
  it("không chia cho 0, không NaN — chỉ có ca mặc sai thì mọi tổ hợp đều qua trần (falseAccuse luôn 0)", () => {
    const cases = [kase("FAIL", [sc(1, 0.5, 0.2)]), kase("FAIL", [sc(1, 0.7, 0.9)])];
    const all = sweepThresholds(cases, SMALL_GRID);
    expect(all.every((x) => x.falseAccuse === 0)).toBe(true);
    const ranked = rankSafe(all, 0);
    expect(ranked).toHaveLength(all.length);
    expect(ranked[0].caught).toBe(Math.max(...all.map((x) => x.caught)));
  });

  it("truthPass = 0 mà vẫn có báo oan (gọi sai) ⇒ coi mẫu số là 1, bị loại chứ không lọt nhờ Infinity/NaN", () => {
    expect(rankSafe([r({ falseAccuse: 1, caught: 5 })], 0)).toEqual([]);
  });

  it("đúng mốc trần 2 % (1/50) vẫn được giữ, vượt một chút (1/49) bị loại", () => {
    expect(1 / 50).toBe(MAX_FALSE_ACCUSE);
    expect(rankSafe([r({ falseAccuse: 1 })], 50)).toHaveLength(1);
    expect(rankSafe([r({ falseAccuse: 1 })], 49)).toHaveLength(0);
    expect(rankSafe([r({ falseAccuse: 3 })], 150)).toHaveLength(1);
  });
});

describe("QC: ảnh xấu luôn là XEM LẠI", () => {
  const bad = [
    { brightness: QUALITY_LIMITS.minBrightness - 0.001, contrast: 0.2, skin: 0.1 },
    { brightness: QUALITY_LIMITS.maxBrightness + 0.001, contrast: 0.2, skin: 0.1 },
    { brightness: 0.4, contrast: QUALITY_LIMITS.minContrast - 0.001, skin: 0.1 },
    { brightness: 0.4, contrast: 0.2, skin: QUALITY_LIMITS.maxSkin + 0.001 },
  ];
  it("điểm cực thấp hay cực cao đều không thành caught / falseAccuse / missed, ở MỌI tổ hợp lưới", () => {
    const cases = bad.flatMap((q) => [kase("PASS", [sc(1, 0.01, 0.01)], q), kase("FAIL", [sc(1, 0.01, 0.01)], q), kase("FAIL", [sc(1, 0.99, 0.99)], q)]);
    for (const res of sweepThresholds(cases, SMALL_GRID)) {
      expect(res).toMatchObject({ falseAccuse: 0, caught: 0, missed: 0, review: cases.length });
    }
  });

  it("quality = null (bản ghi cũ không lưu chất lượng) thì không chặn — chấm theo điểm", () => {
    const res = evaluateThresholds([kase("FAIL", [sc(1, 0.1, 0.1)], null)], DEFAULT_UNIFORM_THRESHOLDS);
    expect(res.caught).toBe(1);
  });
});

describe("QC: embedScore null (lệch phiên bản mô hình)", () => {
  it("chỉ còn tầng màu: điểm gộp = màu, không phụ thuộc trọng số màu", () => {
    const c = [kase("FAIL", [sc(1, null, 0.6)])];
    const a = evaluateThresholds(c, { ...DEFAULT_UNIFORM_THRESHOLDS, colorWeight: 0.3 });
    const b = evaluateThresholds(c, { ...DEFAULT_UNIFORM_THRESHOLDS, colorWeight: 0.6 });
    expect([a.caught, a.review, a.missed]).toEqual([b.caught, b.review, b.missed]);
  });

  it("màu ≥ passColor + 0,1 ⇒ ĐẠT (ca mặc sai thành bỏ sót); màu ≤ 0,35 ⇒ KHÔNG ĐẠT; giữa ⇒ xem lại", () => {
    const th: UniformThresholds = { passColor: 0.8, passEmbed: 0.85, failScore: 0.7, colorWeight: 0.5 };
    expect(evaluateThresholds([kase("FAIL", [sc(1, null, 0.9)])], th)).toMatchObject({ missed: 1, caught: 0, review: 0 });
    expect(evaluateThresholds([kase("FAIL", [sc(1, null, 0.35)])], th)).toMatchObject({ caught: 1 });
    expect(evaluateThresholds([kase("PASS", [sc(1, null, 0.6)])], th)).toMatchObject({ review: 1, falseAccuse: 0 });
  });

  it("ca mặc đúng lệch phiên bản mà màu ≤ 0,35 bị báo oan ở MỌI tổ hợp (mốc 0,35 viết cứng, lưới không dò được)", () => {
    const cases = [kase("PASS", [sc(1, null, 0.3)])];
    const all = sweepThresholds(cases, SMALL_GRID);
    expect(all.every((x) => x.falseAccuse === 1)).toBe(true);
    expect(rankSafe(all, 1)).toEqual([]);
  });
});

describe("QC: nhiều mẫu áo — mẫu tốt nhất đổi theo trọng số màu", () => {
  // A: hình dáng cao, màu thấp; B: ngược lại. Không tín hiệu nào qua ngưỡng 0,99 ⇒ chỉ còn so điểm gộp với failScore.
  const A = sc(1, 0.9, 0.3);
  const B = sc(2, 0.3, 0.9);
  const th = (colorWeight: number): UniformThresholds => ({ passColor: 0.99, passEmbed: 0.99, failScore: 0.7, colorWeight });

  it("cw 0,3: A = 0,72 > 0,7 ⇒ xem lại; cw 0,6: B = 0,66 ≤ 0,7 ⇒ bắt được", () => {
    expect(evaluateThresholds([kase("FAIL", [A, B])], th(0.3))).toMatchObject({ caught: 0, review: 1 });
    expect(evaluateThresholds([kase("FAIL", [A, B])], th(0.6))).toMatchObject({ caught: 1, review: 0 });
  });

  it("thứ tự mẫu trong đầu vào không ảnh hưởng (được sắp lại theo điểm gộp của từng tổ hợp)", () => {
    for (const cw of EVAL_GRID.colorWeight) {
      const t = { ...DEFAULT_UNIFORM_THRESHOLDS, colorWeight: cw };
      const ab = evaluateThresholds([kase("FAIL", [A, B]), kase("PASS", [sc(3, 0.95, 0.5), sc(4, 0.5, 0.95)])], t);
      const ba = evaluateThresholds([kase("FAIL", [B, A]), kase("PASS", [sc(4, 0.5, 0.95), sc(3, 0.95, 0.5)])], t);
      expect({ ...ba, th: null }).toEqual({ ...ab, th: null });
    }
  });

  it("khớp với decideUniform trên điểm gộp tính tay; không sửa mảng scores đầu vào", () => {
    const scores = [A, B, sc(5, 0.82, 0.81, { sampleCount: 2 })];
    const snapshot = JSON.parse(JSON.stringify(scores));
    const t = th(0.4);
    const manual = scores
      .map((s) => ({ ...s, score: (1 - t.colorWeight) * (s.embedScore as number) + t.colorWeight * s.colorScore }))
      .sort((a, b) => b.score - a.score);
    const v = decideUniform({ scores: manual, quality: GOOD_Q, th: t });
    const res = evaluateThresholds([kase("FAIL", scores)], t);
    expect(res.review).toBe(v.status === "REVIEW" ? 1 : 0);
    expect(res.caught).toBe(v.status === "FAIL" ? 1 : 0);
    expect(scores).toEqual(snapshot);
  });

  it("mẫu tốt nhất còn ít ảnh (< 3) ⇒ luôn xem lại dù mẫu thứ hai đủ ảnh và rõ ràng", () => {
    const few = sc(1, 0.2, 0.2, { sampleCount: 2 });
    const enough = sc(2, 0.1, 0.1);
    // few có điểm gộp cao hơn ⇒ đứng đầu ⇒ LOW_CONFIDENCE_TEMPLATE.
    expect(evaluateThresholds([kase("FAIL", [enough, few])], DEFAULT_UNIFORM_THRESHOLDS)).toMatchObject({ caught: 0, review: 1 });
  });
});

describe("QC: lưới dò", () => {
  it("EVAL_GRID: 23 mốc đạt (0,3…0,85), 19 mốc trượt (0,25…0,7), không lỗi số thực", () => {
    expect(EVAL_GRID.pass).toHaveLength(23);
    expect(EVAL_GRID.fail).toHaveLength(19);
    expect([EVAL_GRID.pass[0], EVAL_GRID.pass.at(-1), EVAL_GRID.fail[0], EVAL_GRID.fail.at(-1)]).toEqual([0.3, 0.85, 0.25, 0.7]);
    for (const v of [...EVAL_GRID.pass, ...EVAL_GRID.fail]) expect(Math.round(v * 1000) / 1000).toBe(v);
    expect(new Set(EVAL_GRID.pass).size).toBe(23);
  });

  it("số tổ hợp = |colorWeight| · |pass|² · |fail| (mặc định 40 204), mỗi tổ hợp một lần", () => {
    const g = EVAL_GRID;
    const all = sweepThresholds([], g);
    expect(all).toHaveLength(g.colorWeight.length * g.pass.length ** 2 * g.fail.length);
    expect(all).toHaveLength(40204);
    const keys = new Set(all.map((x) => `${x.th.colorWeight}|${x.th.passColor}|${x.th.passEmbed}|${x.th.failScore}`));
    expect(keys.size).toBe(all.length);
    expect(sweepThresholds([], SMALL_GRID)).toHaveLength(2 * 4 * 3);
  });

  it("lưới rỗng ⇒ mảng rỗng, rankSafe rỗng không ném lỗi", () => {
    expect(sweepThresholds([kase("PASS", [sc(1, 0.9, 0.9)])], { pass: [], fail: [0.5], colorWeight: [0.5] })).toEqual([]);
    expect(rankSafe([], 10)).toEqual([]);
  });

  it("ca không có mẫu áo nào (SKIPPED) không được đếm vào đâu cả", () => {
    expect(evaluateThresholds([kase("FAIL", []), kase("PASS", [])], DEFAULT_UNIFORM_THRESHOLDS)).toMatchObject({ caught: 0, missed: 0, review: 0, falseAccuse: 0 });
  });
});

describe("QC: rankSafe — bất biến đầu vào và ổn định", () => {
  it("không sửa mảng đầu vào (filter tạo mảng mới trước khi sort)", () => {
    const input = [r({ caught: 0 }), r({ caught: 2 }), r({ caught: 1 })];
    const before = [...input];
    const out = rankSafe(input, 36);
    expect(input).toEqual(before);
    expect(input.every((x, i) => x === before[i])).toBe(true);
    expect(out).not.toBe(input);
    expect(out.map((x) => x.caught)).toEqual([2, 1, 0]);
  });

  it("tất cả bằng nhau ⇒ giữ nguyên thứ tự đầu vào (sort ổn định)", () => {
    const input = Array.from({ length: 50 }, (_, i) => r({ th: { ...DEFAULT_UNIFORM_THRESHOLDS, failScore: i }, caught: 1, review: 2 }));
    expect(rankSafe(input, 36).map((x) => x.th.failScore)).toEqual(input.map((x) => x.th.failScore));
  });

  it("đủ bốn tầng xếp hạng: sót → bắt → xem lại → báo oan", () => {
    const a = r({ caught: 1, missed: 0, review: 3, falseAccuse: 0 });
    const b = r({ caught: 1, missed: 0, review: 3, falseAccuse: 1 });
    const c = r({ caught: 1, missed: 0, review: 2, falseAccuse: 1 });
    const d = r({ caught: 1, missed: 1, review: 0, falseAccuse: 0 });
    const e = r({ caught: 2, missed: 5, review: 9, falseAccuse: 1 });
    expect(rankSafe([d, b, a, c, e], 100)).toEqual([c, a, b, d, e]);
  });
});
