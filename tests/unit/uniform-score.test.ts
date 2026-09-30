// v1.20.0: bảng quyết định ĐẠT / KHÔNG ĐẠT / CẦN XEM LẠI — luật khóa cứng là ảnh xấu không bao giờ thành "không đạt".
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIFORM_THRESHOLDS as TH,
  MIN_SAMPLES_TRUSTED,
  UNIFORM_REASON_LABEL,
  UNIFORM_STATUS_LABEL,
  cosine,
  decideUniform,
  scoreTemplates,
  type TemplateScore,
  type UniformTemplateRef,
} from "@/lib/uniform-score";

const VER = "test-model@1";
/** Một điểm số dựng sẵn để nạp thẳng vào decideUniform. */
const sc = (o: Partial<TemplateScore> = {}): TemplateScore => ({
  templateId: 1,
  name: "Áo navy",
  embedScore: 0.8,
  colorScore: 0.8,
  score: 0.8,
  sampleCount: 5,
  versionOk: true,
  ...o,
});

describe("chấm điểm với các mẫu áo của phòng", () => {
  const tpl = (id: number, name: string, hue: number, sampleCount = 5): UniformTemplateRef => ({
    id,
    name,
    colorHist: hist(hue),
    embedding: vec(hue),
    embedVersion: VER,
    sampleCount,
  });
  /** Biểu đồ giả: dồn hết khối lượng vào một ô ứng với "màu" hue. */
  function hist(hue: number): number[] {
    const h = new Array(99).fill(0);
    h[hue % 96] = 1;
    return h;
  }
  /** Vector giả: hai hue gần nhau thì cosine cao, xa nhau thì thấp. */
  function vec(hue: number): number[] {
    return Array.from({ length: 16 }, (_, i) => Math.cos((hue + i * 7) * 0.3));
  }

  it("chọn đúng mẫu khớp nhất trong 3 mẫu và trả điểm của cả 3", () => {
    const list = scoreTemplates({ colorHist: hist(10), embedding: vec(10), embedVersion: VER }, [tpl(1, "Navy", 10), tpl(2, "Trắng", 40), tpl(3, "Hồng", 70)]);
    expect(list).toHaveLength(3);
    expect(list[0].templateId).toBe(1);
    expect(list[0].colorScore).toBeCloseTo(1, 6);
    expect(list[0].embedScore).toBeCloseTo(1, 6);
    expect(list[1].score).toBeLessThan(list[0].score);
  });

  it("mẫu tính bằng phiên bản mô hình khác → bỏ tín hiệu mô hình, chỉ còn màu", () => {
    const cu: UniformTemplateRef = { ...tpl(1, "Navy", 10), embedVersion: "cu@0" };
    const [r] = scoreTemplates({ colorHist: hist(10), embedding: vec(10), embedVersion: VER }, [cu]);
    expect(r.versionOk).toBe(false);
    expect(r.embedScore).toBeNull();
    expect(r.score).toBeCloseTo(r.colorScore, 6);
  });

  it("trọng số màu đổi thì điểm gộp đổi theo", () => {
    const f = { colorHist: hist(10), embedding: vec(40), embedVersion: VER }; // màu khớp, hình dáng lệch
    const nhieuMau = scoreTemplates(f, [tpl(1, "Navy", 10)], { ...TH, colorWeight: 0.9 })[0].score;
    const itMau = scoreTemplates(f, [tpl(1, "Navy", 10)], { ...TH, colorWeight: 0.1 })[0].score;
    expect(nhieuMau).toBeGreaterThan(itMau);
  });

  it("cosine: trùng nhau = 1, ngược nhau = −1, vector rỗng = 0", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("kết luận", () => {
  it("cả hai tín hiệu đều đạt → ĐẠT, kèm tên mẫu áo", () => {
    const d = decideUniform({ scores: [sc({ embedScore: 0.8, colorScore: 0.9 })] });
    expect(d.status).toBe("PASS");
    expect(d.reason).toBeNull();
    expect(d.templateName).toBe("Áo navy");
  });

  it("cả hai đều thấp và điểm gộp dưới ngưỡng → KHÔNG ĐẠT", () => {
    const d = decideUniform({ scores: [sc({ embedScore: 0.2, colorScore: 0.18, score: 0.19 })] });
    expect(d.status).toBe("FAIL");
    expect(d.reason).toBe("LOW_SCORE");
  });

  it("hai tín hiệu lệch nhau → CẦN XEM LẠI, không kết luận bừa", () => {
    expect(decideUniform({ scores: [sc({ embedScore: 0.8, colorScore: 0.2, score: 0.56 })] })).toMatchObject({ status: "REVIEW", reason: "AMBIGUOUS" });
    expect(decideUniform({ scores: [sc({ embedScore: 0.2, colorScore: 0.8, score: 0.44 })] })).toMatchObject({ status: "REVIEW", reason: "AMBIGUOUS" });
  });

  it("ảnh xấu thắng mọi điểm số: điểm cao vẫn CẦN XEM LẠI", () => {
    const cao = [sc({ embedScore: 0.95, colorScore: 0.95, score: 0.95 })];
    expect(decideUniform({ scores: cao, quality: { brightness: 0.05, contrast: 0.2, skin: 0 } })).toMatchObject({ status: "REVIEW", reason: "TOO_DARK" });
    expect(decideUniform({ scores: cao, quality: { brightness: 0.97, contrast: 0.2, skin: 0 } })).toMatchObject({ status: "REVIEW", reason: "TOO_BRIGHT" });
    expect(decideUniform({ scores: cao, quality: { brightness: 0.5, contrast: 0.001, skin: 0 } })).toMatchObject({ status: "REVIEW", reason: "LOW_CONTRAST" });
    expect(decideUniform({ scores: cao, quality: { brightness: 0.5, contrast: 0.2, skin: 0.8 } })).toMatchObject({ status: "REVIEW", reason: "SKIN_DOMINANT" });
  });

  it("không cắt được vùng áo → CẦN XEM LẠI, ưu tiên cao nhất", () => {
    const d = decideUniform({ cropReason: "CROP_OUT_OF_FRAME", scores: [sc({ embedScore: 0.9, colorScore: 0.9 })] });
    expect(d).toMatchObject({ status: "REVIEW", reason: "CROP_OUT_OF_FRAME", templateId: null });
  });

  it("phòng chưa khai mẫu áo → BỎ QUA", () => {
    expect(decideUniform({ scores: [] })).toMatchObject({ status: "SKIPPED", reason: "NO_TEMPLATE" });
  });

  it("mẫu áo còn ít ảnh → luôn CẦN XEM LẠI dù điểm cao", () => {
    const d = decideUniform({ scores: [sc({ sampleCount: MIN_SAMPLES_TRUSTED - 1, embedScore: 0.95, colorScore: 0.95 })] });
    expect(d).toMatchObject({ status: "REVIEW", reason: "LOW_CONFIDENCE_TEMPLATE", templateId: 1 });
  });

  it("mô hình lỗi → chỉ dùng màu, đòi chắc chắn hơn mới kết luận", () => {
    const only = (colorScore: number) => decideUniform({ modelFailed: true, scores: [sc({ embedScore: null, colorScore, score: colorScore })] });
    expect(only(0.7)).toMatchObject({ status: "PASS" }); // ≥ 0,55 + 0,10
    expect(only(0.3)).toMatchObject({ status: "FAIL", reason: "LOW_SCORE" });
    expect(only(0.5)).toMatchObject({ status: "REVIEW", reason: "MODEL_ERROR" });
  });

  it("mẫu áo tính bằng mô hình cũ → CẦN XEM LẠI, nhắc tính lại", () => {
    const d = decideUniform({ scores: [sc({ embedScore: null, colorScore: 0.5, score: 0.5, versionOk: false })] });
    expect(d).toMatchObject({ status: "REVIEW", reason: "MODEL_VERSION_MISMATCH" });
  });

  it("nới ngưỡng thì một ca đang CẦN XEM LẠI thành ĐẠT (ngưỡng hiệu chỉnh được)", () => {
    const s = [sc({ embedScore: 0.5, colorScore: 0.6, score: 0.54 })];
    expect(decideUniform({ scores: s })).toMatchObject({ status: "REVIEW" });
    expect(decideUniform({ scores: s, th: { ...TH, passEmbed: 0.45 } })).toMatchObject({ status: "PASS" });
  });

  it("mọi trạng thái và lý do đều có nhãn tiếng Việt", () => {
    expect(Object.values(UNIFORM_STATUS_LABEL).every((v) => v.length > 0)).toBe(true);
    expect(Object.values(UNIFORM_REASON_LABEL).every((v) => v.length > 0)).toBe(true);
    expect(UNIFORM_STATUS_LABEL.FAIL).toBe("Không đạt");
  });
});
