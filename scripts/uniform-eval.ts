/**
 * Đo ngưỡng kiểm đồng phục từ dữ liệu CHẠY THỬ đã được Nhân sự gắn nhãn (v1.20.0).
 *
 *   npm run uniform:eval -- --from=2026-10-01 --to=2026-10-14 [--dept=3] [--apply]
 *
 * Cách làm: chỉ lấy những bản ghi CÓ NGƯỜI XÁC NHẬN (đó là sự thật), dò toàn bộ tổ hợp ngưỡng trên chính số điểm
 * đã lưu, rồi đề xuất tổ hợp có **tỉ lệ báo oan ≤ 2 %** và bắt được nhiều vi phạm nhất.
 *
 * "Báo oan" = người MẶC ĐÚNG áo mà máy kết luận KHÔNG ĐẠT. Đây là sai lầm nặng nhất nên ràng buộc trước, rồi mới
 * tối ưu phần còn lại — chứ không tối ưu "độ chính xác" chung chung.
 *
 * Script chỉ ĐỌC; có `--apply` mới ghi ngưỡng vào Cấu hình.
 */
import { prisma } from "../src/lib/db";
import { decideUniform, type TemplateScore, type UniformQuality, type UniformThresholds } from "../src/lib/uniform-score";
import { saveSettings } from "../src/lib/settings";

type Detail = {
  scores?: { id: number; name: string; embed: number | null; color: number; score: number }[];
  quality?: UniformQuality;
  pattern?: number | null;
};

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name: string) => process.argv.includes(`--${name}`);
const pct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : "—");

/** Trần báo oan mà chủ dự án đã chốt. */
const MAX_FALSE_ACCUSE = 0.02;
const GRID = { pass: range(0.3, 0.85, 0.025), fail: range(0.25, 0.7, 0.025), colorWeight: [0.3, 0.4, 0.5, 0.6] };

function range(a: number, b: number, step: number) {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  if (!from || !to) {
    console.error("Thiếu khoảng ngày. Ví dụ: npm run uniform:eval -- --from=2026-10-01 --to=2026-10-14");
    process.exit(1);
  }
  const departmentId = arg("dept") ? Number(arg("dept")) : undefined;

  const rows = await prisma.uniformCheck.findMany({
    where: { workDate: { gte: from, lte: to }, decidedById: { not: null }, status: { in: ["PASS", "FAIL"] }, ...(departmentId ? { departmentId } : {}) },
    select: { id: true, status: true, detail: true, templateId: true, departmentId: true },
  });
  if (!rows.length) {
    console.error(`Không có bản ghi nào đã được xác nhận trong ${from} … ${to}. Hãy cho Nhân sự bấm Đạt / Không đạt trên bảng theo dõi trước.`);
    process.exit(1);
  }

  // sampleCount và độ có logo của mẫu áo lấy theo hiện trạng (ngưỡng dò không đụng tới hai thứ này).
  const templates = new Map(
    (await prisma.uniformTemplate.findMany({ select: { id: true, sampleCount: true, colorHist: true, embedVersion: true } })).map((t) => [
      t.id,
      { sampleCount: t.sampleCount, pattern: patternOf(t.colorHist), hasEmbed: !!t.embedVersion },
    ]),
  );

  type Case = { truth: "PASS" | "FAIL"; scores: Omit<TemplateScore, "score">[]; quality: UniformQuality | null; pattern: number | null };
  const cases: Case[] = [];
  let skipped = 0;
  for (const r of rows) {
    const d = safe<Detail>(r.detail);
    if (!d?.scores?.length) {
      skipped++;
      continue;
    }
    cases.push({
      truth: r.status as "PASS" | "FAIL",
      quality: d.quality ?? null,
      pattern: d.pattern ?? null,
      scores: d.scores.map((s) => {
        const t = templates.get(s.id);
        return {
          templateId: s.id,
          name: s.name,
          embedScore: s.embed,
          colorScore: s.color,
          sampleCount: t?.sampleCount ?? 3,
          versionOk: s.embed != null,
          templatePattern: t?.pattern ?? null,
        };
      }),
    });
  }

  const truthPass = cases.filter((c) => c.truth === "PASS").length;
  const truthFail = cases.length - truthPass;
  console.log(`\nDữ liệu: ${cases.length} bản ghi đã xác nhận (${truthPass} mặc đúng, ${truthFail} mặc sai)${skipped ? `, bỏ ${skipped} bản thiếu điểm` : ""}.`);
  if (truthFail < 10 || truthPass < 30) {
    console.log("⚠  Còn ít dữ liệu — ngưỡng đề xuất chỉ nên tham khảo. Nên chạy thử đủ 2 tuần rồi đo lại.");
  }

  type Result = { th: UniformThresholds; falseAccuse: number; caught: number; review: number; missed: number };
  const results: Result[] = [];
  for (const colorWeight of GRID.colorWeight) {
    for (const passColor of GRID.pass) {
      for (const passEmbed of GRID.pass) {
        for (const failScore of GRID.fail) {
          const th: UniformThresholds = { passColor, passEmbed, failScore, colorWeight };
          let falseAccuse = 0;
          let caught = 0;
          let review = 0;
          let missed = 0;
          for (const c of cases) {
            const scores = withCombined(c.scores, th);
            const v = decideUniform({ scores, quality: c.quality, pattern: c.pattern, th });
            if (v.status === "REVIEW") review++;
            if (c.truth === "PASS" && v.status === "FAIL") falseAccuse++;
            if (c.truth === "FAIL") {
              if (v.status === "FAIL") caught++;
              else if (v.status === "PASS") missed++;
            }
          }
          results.push({ th, falseAccuse, caught, review, missed });
        }
      }
    }
  }

  const ok = results.filter((r) => r.falseAccuse / Math.max(1, truthPass) <= MAX_FALSE_ACCUSE);
  console.log(`Đã thử ${results.length} tổ hợp; ${ok.length} tổ hợp đạt trần báo oan ${MAX_FALSE_ACCUSE * 100} %.\n`);
  if (!ok.length) {
    console.log("Không tổ hợp nào đủ an toàn. Thường là do ảnh mẫu chưa đúng điều kiện — hãy chụp lại ảnh mẫu NGAY TẠI KIOSK rồi đo lại.");
    return;
  }

  // Ưu tiên: bắt được nhiều vi phạm nhất → ít phải xem lại bằng tay nhất → báo oan ít nhất.
  ok.sort((a, b) => b.caught - a.caught || a.review - b.review || a.falseAccuse - b.falseAccuse);
  console.log("Năm tổ hợp tốt nhất (báo oan · bắt được · phải xem lại · bỏ sót):");
  for (const r of ok.slice(0, 5)) {
    console.log(
      `  màu ≥ ${r.th.passColor.toFixed(3)} · hình dáng ≥ ${r.th.passEmbed.toFixed(3)} · trượt ≤ ${r.th.failScore.toFixed(3)} · trọng số màu ${r.th.colorWeight}` +
        `   →  oan ${pct(r.falseAccuse, truthPass)} · bắt ${pct(r.caught, truthFail)} · xem lại ${pct(r.review, cases.length)} · sót ${pct(r.missed, truthFail)}`,
    );
  }

  const best = ok[0];
  console.log("\nĐề xuất đặt trong Cấu hình → Chấm công:");
  console.log(`  uniformPassColor  = ${best.th.passColor}`);
  console.log(`  uniformPassEmbed  = ${best.th.passEmbed}`);
  console.log(`  uniformFailScore  = ${best.th.failScore}`);
  console.log(`  uniformColorWeight= ${best.th.colorWeight}`);

  if (has("apply")) {
    await saveSettings({
      uniformPassColor: best.th.passColor,
      uniformPassEmbed: best.th.passEmbed,
      uniformFailScore: best.th.failScore,
      uniformColorWeight: best.th.colorWeight,
    });
    console.log("\nĐã ghi vào Cấu hình. Ngưỡng mới áp dụng cho những lượt kiểm SAU, bản ghi cũ giữ nguyên.");
  } else {
    console.log("\n(Chạy lại kèm --apply để ghi thẳng vào Cấu hình.)");
  }
}

/** Điểm gộp phụ thuộc trọng số màu nên phải tính lại cho từng tổ hợp. */
function withCombined(scores: Omit<TemplateScore, "score">[], th: UniformThresholds): TemplateScore[] {
  return scores
    .map((s) => ({ ...s, score: s.embedScore === null ? s.colorScore : (1 - th.colorWeight) * s.embedScore + th.colorWeight * s.colorScore }))
    .sort((a, b) => b.score - a.score);
}

function patternOf(raw: string | null): number | null {
  const v = safe<{ pattern?: number }>(raw);
  return typeof v?.pattern === "number" ? v.pattern : null;
}

function safe<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
