/**
 * Đo tầng chống giả mạo L2 trên ảnh chấm công THẬT (v1.22.0).
 *
 *   npm run liveness:eval -- --from=2026-09-21 --to=2026-10-07 [--gia=2026-10-08T14:00,2026-10-08T15:00]
 *
 * Vì sao có script này: 61/205 lượt quét bị từ chối "nghi giả mạo" trong khi tầng L1 trên tablet chấm trung vị 0,826
 * (tức "người thật"), và mô hình L2 trả trung bình lớp "ảnh in" = 0,594. Nghi vấn: khung mặt của BlazeFace là hình
 * VUÔNG và rộng hơn khung của bộ dò trong mã tham chiếu, nên vùng cắt 2,7 lần bị rộng quá, mặt chiếm phần nhỏ trong ô
 * 80×80 và mô hình đọc ra "ảnh chụp một tấm ảnh".
 *
 * Script chạy lại ONNX trên chính những ảnh đã lưu, quét qua các hệ số cắt và cách chuẩn hóa, rồi báo biến thể nào
 * tách được NGƯỜI THẬT khỏi MẪU GIẢ. Chỉ ĐỌC, không sửa gì.
 *
 * Mẫu giả lấy bằng `--gia`: các khoảng thời gian chủ dự án cố ý giơ ảnh in / màn hình điện thoại trước kiosk.
 * Không có nhóm này thì chỉ biết "không từ chối oan", chưa biết còn chặn được ảnh hay không.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { miniFasnetScore, MINIFASNET_SCALE, type FaceBox } from "../src/lib/liveness-l2";
import { dataDir } from "../src/lib/storage";

const SCALES = [1.2, 1.6, 2.0, 2.4, MINIFASNET_SCALE, 3.5];
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

type Mau = { nhan: "thật" | "giả"; jpeg: Buffer; box: FaceBox; moTa: string };

/** Khoảng thời gian có mẫu giả: "2026-10-08T14:00,2026-10-08T15:00" (nhiều khoảng cách nhau bằng dấu chấm phẩy). */
function parseKhoang(raw: string | undefined) {
  if (!raw) return [];
  return raw.split(";").map((k) => {
    const [a, b] = k.split(",");
    return { tu: new Date(a), den: new Date(b) };
  });
}

async function main() {
  const from = arg("from") ?? "2026-01-01";
  const to = arg("to") ?? "2030-01-01";
  const khoangGia = parseKhoang(arg("gia"));

  const logs = await prisma.attendanceLog.findMany({
    where: { source: "KIOSK", workDate: { gte: from, lte: to }, faceBox: { not: null }, snapshotUrl: { not: null } },
    select: { id: true, checkTime: true, faceBox: true, snapshotUrl: true },
    orderBy: { checkTime: "asc" },
  });

  const mau: Mau[] = [];
  let thieuAnh = 0;
  for (const l of logs) {
    const parts = l.snapshotUrl!.replace("/api/snapshots/", "").split("/");
    let jpeg: Buffer;
    try {
      jpeg = readFileSync(join(dataDir(), "snapshots", ...parts));
    } catch {
      thieuAnh++;
      continue;
    }
    const box = JSON.parse(l.faceBox!) as FaceBox;
    const gia = khoangGia.some((k) => l.checkTime >= k.tu && l.checkTime <= k.den);
    mau.push({ nhan: gia ? "giả" : "thật", jpeg, box, moTa: `#${l.id} ${l.checkTime.toISOString().slice(0, 16)}` });
  }

  const that = mau.filter((m) => m.nhan === "thật");
  const gia = mau.filter((m) => m.nhan === "giả");
  console.log(`\nMẫu: ${that.length} lượt NGƯỜI THẬT · ${gia.length} lượt GIẢ${thieuAnh ? ` (bỏ ${thieuAnh} lượt mất ảnh)` : ""}`);
  if (!that.length) {
    console.error("Không có lượt nào đã lưu khung mặt — khung mặt chỉ được ghi từ v1.20.0 trở đi.");
    process.exit(1);
  }
  if (!gia.length) {
    console.log("⚠  CHƯA CÓ MẪU GIẢ. Script chỉ cho biết biến thể nào không từ chối oan, KHÔNG biết có còn chặn được");
    console.log("   ảnh in / màn hình hay không. Hãy giơ ảnh in và điện thoại trước kiosk vài lượt rồi chạy lại kèm --gia=…");
  }

  console.log("\nchuẩn hóa  hệ số cắt   NGƯỜI THẬT (nhỏ nhất · trung vị)   GIẢ (lớn nhất · trung vị)   khoảng cách");
  type KetQua = { normalize: boolean; scale: number; thatMin: number; thatMed: number; giaMax: number; giaMed: number; cach: number };
  const ketQua: KetQua[] = [];

  for (const normalize of [false, true]) {
    for (const scale of SCALES) {
      const diem = async (list: Mau[]) => {
        const out: number[] = [];
        for (const m of list) out.push((await miniFasnetScore(m.jpeg, m.box, { scale, normalize })).real);
        return out.sort((a, b) => a - b);
      };
      const t = await diem(that);
      const g = gia.length ? await diem(gia) : [];
      const med = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : NaN);
      const r: KetQua = {
        normalize,
        scale,
        thatMin: t[0],
        thatMed: med(t),
        giaMax: g.length ? g[g.length - 1] : NaN,
        giaMed: med(g),
        cach: g.length ? t[0] - g[g.length - 1] : NaN,
      };
      ketQua.push(r);
      const f = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "  -  ");
      console.log(
        `${normalize ? "0–1  " : "0–255"}      ${scale.toFixed(1).padStart(4)}       ${f(r.thatMin)} · ${f(r.thatMed)}              ${f(r.giaMax)} · ${f(r.giaMed)}        ${f(r.cach)}`,
      );
    }
  }

  console.log("\n— Đề xuất —");
  if (gia.length) {
    const tot = ketQua.filter((r) => r.cach > 0).sort((a, b) => b.cach - a.cach);
    if (!tot.length) {
      console.log("KHÔNG biến thể nào tách được hai nhóm ⇒ phải đổi mô hình L2, hoặc chỉ dùng L1 cho mức an toàn đã chốt.");
    } else {
      const b = tot[0];
      console.log(`Dùng hệ số cắt ${b.scale}, giá trị ${b.normalize ? "0–1" : "0–255"}.`);
      console.log(`Người thật thấp nhất ${b.thatMin.toFixed(3)} · mẫu giả cao nhất ${b.giaMax.toFixed(3)} · cách nhau ${b.cach.toFixed(3)}.`);
      console.log(`⇒ Đặt livenessServerThreshold = ${((b.thatMin + b.giaMax) / 2).toFixed(2)} (giữa hai nhóm).`);
    }
  } else {
    const b = [...ketQua].sort((a, b2) => b2.thatMin - a.thatMin)[0];
    console.log(`Ít từ chối oan nhất: hệ số cắt ${b.scale}, giá trị ${b.normalize ? "0–1" : "0–255"} — người thật thấp nhất ${b.thatMin.toFixed(3)}.`);
    console.log("CHƯA kết luận được: thiếu mẫu giả để biết ngưỡng đặt ở đâu thì vẫn chặn được ảnh in / màn hình.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
