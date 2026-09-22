/**
 * Tra cứu GPHN trên trang công khai của Sở Y tế TP.HCM (tracuu.medinet.org.vn) — v1.11.0, đợt 2 của hồ sơ hành nghề.
 * Không có API chính thức: dùng đúng 2 yêu cầu mà chính trang web gọi khi người dùng tìm kiếm:
 *   POST /chungchihanhnghey        {key_word, checked: 1 (chính xác), page, results_per_page} → HTML danh sách thẻ kết quả
 *   POST /chungchihanhngheydetail  {check: <id thẻ>}                                           → HTML chi tiết + bảng nơi công tác
 * Nguyên tắc: tra thưa (≥ 4 giây giữa 2 lần gọi trong cả tiến trình), có hạn chờ, lỗi / đổi giao diện thì trả "không tra được"
 * — KHÔNG bao giờ kết luận "sai" khi không đọc được. Phần đọc HTML và so sánh là hàm thuần để kiểm thử bằng HTML mẫu.
 */
export const MEDINET_BASE = "https://tracuu.medinet.org.vn";
const MIN_GAP_MS = 4000;
const TIMEOUT_MS = 20_000;

export type MedinetWorkplace = {
  facilityLicense: string | null; // số GPHĐ của cơ sở, vd. 06410/HCM-GPHĐ
  facility: string; // tên cơ sở
  position: string | null;
  department: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  schedule: string | null;
};
export type MedinetRecord = {
  id: string;
  name: string;
  number: string;
  issuedAt: string | null;
  issuer: string | null;
  subject: string | null;
  scope: string | null;
  statusText: string | null;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED" | "UNKNOWN";
  workplaces: MedinetWorkplace[];
};
export type MedinetDiff = { field: "name" | "issuedAt" | "issuer" | "subject" | "scope" | "status"; local: string | null; remote: string | null; severity: "danger" | "warn" };
export type MedinetResult =
  | { ok: true; found: true; record: MedinetRecord; diffs: MedinetDiff[]; elsewhere: MedinetWorkplace[]; atClinic: boolean | null; candidates: number }
  | { ok: true; found: false; candidates: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------- đọc HTML (hàm thuần)
const ENT: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };
export function htmlText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    // Giải mã thực thể MỘT lượt (không giải mã chồng "&amp;#39;" thành "'").
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[m] ?? m),
    )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
const dmy = (s: string | null | undefined) => {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

/** Danh sách thẻ kết quả tìm kiếm: id + tên + số GPHN + ngày cấp (đủ để chọn đúng người trước khi mở chi tiết). */
export function parseSearch(html: string): { id: string; name: string; number: string; issuedAt: string | null; statusText: string | null }[] {
  const out: { id: string; name: string; number: string; issuedAt: string | null; statusText: string | null }[] = [];
  const re = /data-class=["']?([0-9a-fA-F-]{8,64})["']?[^>]*>([\s\S]*?)(?=data-class=|<ul class="pagination|$)/g;
  for (const m of html.matchAll(re)) {
    const body = m[2];
    const title = body.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "";
    const titleText = htmlText(title).split("\n").map((s) => s.trim()).filter(Boolean);
    const name = titleText[0] ?? "";
    const numLine = titleText.slice(1).join(" ");
    const number = numLine.split(/\s-\s|\s*\[/)[0]?.trim() ?? "";
    const status = body.match(/font-weight-bold[^>]*>([^<]+)</)?.[1]?.trim() ?? null;
    if (name && number) out.push({ id: m[1], name, number, issuedAt: dmy(numLine.match(/\[([^\]]+)\]/)?.[1]), statusText: status });
  }
  return out;
}

const field = (html: string, forId: string) => {
  const m = html.match(new RegExp(`for=["']${forId}["'][^>]*>[\\s\\S]*?<p[^>]*>([\\s\\S]*?)</p>`));
  return m ? htmlText(m[1]) : null;
};

export function statusFromText(t: string | null | undefined): MedinetRecord["status"] {
  const s = norm(t ?? "");
  if (!s) return "UNKNOWN";
  if (/\b(dinh chi|tam dung|tam dinh chi)\b/.test(s)) return "SUSPENDED";
  // "không hoạt động" / "không còn…" phải xét TRƯỚC "hoạt động"; "hủy" theo từ nguyên vẹn (không bắt nhầm "chuyển" → "chuyen").
  if (/\b(thu hoi|khong con|khong hoat dong|ngung hoat dong|het hieu luc|bi huy|huy)\b/.test(s)) return "REVOKED";
  if (/\b(hoat dong|con hieu luc)\b/.test(s)) return "ACTIVE";
  return "UNKNOWN";
}

/** Trang chi tiết: thông tin GPHN + bảng nơi công tác. */
export function parseDetail(id: string, html: string): MedinetRecord | null {
  const name = field(html, "hovaten");
  const numLine = field(html, "so_cchn");
  if (!name || !numLine) return null;
  const issuerLine = field(html, "noicap_cchn") ?? "";
  const statusText = field(html, "active");
  const [issuer, subject] = issuerLine.split(/\s*-\s*Đối tượng cấp:\s*/);
  const workplaces: MedinetWorkplace[] = [];
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  for (const row of tbody.split(/<tr\b/).slice(1)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 6) continue; // dòng phụ (colspan) mô tả thêm
    const unit = cells[1];
    const lic = htmlText(unit.match(/text-success[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "");
    if (!lic) continue;
    const m = lic.match(/Số giấy phép:\s*(.+?)\s+-\s+([\s\S]+)/); // số GPHĐ có thể chứa '-' (06410/HCM-GPHĐ): tách theo ' - '
    workplaces.push({
      facilityLicense: m ? m[1].trim() : null,
      facility: (m ? m[2] : lic).trim(),
      position: htmlText(unit.match(/Vị trí:([\s\S]*?)<\/div>/)?.[1] ?? "") || null,
      department: htmlText(unit.match(/Khoa:([\s\S]*?)<\/div>/)?.[1] ?? "") || null,
      startDate: dmy(htmlText(cells[2])),
      endDate: dmy(htmlText(cells[3])),
      schedule: htmlText(cells[4]) || null,
    });
  }
  return {
    id,
    name,
    number: numLine.split(/\s*-\s*Ngày cấp:/)[0].trim(),
    issuedAt: dmy(numLine.match(/Ngày cấp:\s*([\d/]+)/)?.[1]),
    issuer: issuer?.trim() || null,
    subject: subject?.trim() || null,
    scope: field(html, "phamvi_hanhnghe"),
    statusText,
    status: statusFromText(statusText),
    workplaces,
  };
}

// ---------------------------------------------------------------- so sánh (hàm thuần)
/** Bỏ dấu, chữ thường, gộp khoảng trắng, bỏ dấu câu cuối — so "Bác sĩ" với "BÁC SĨ", "Nội tổng hợp." với "Nội tổng hợp". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[.,;:]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const loose = (s: string | null) => norm(s ?? "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const normLicense = (s: string) => s.toUpperCase().replace(/\s+/g, "").replace(/Đ/g, "D");

/** Nơi công tác còn hiệu lực: chưa có ngày nghỉ, hoặc ngày nghỉ trước ngày làm (dữ liệu medinet đôi khi ghi ngược). */
export const activeWorkplace = (w: MedinetWorkplace, today: string) => !w.endDate || (w.startDate != null && w.endDate < w.startDate) || w.endDate >= today;

export function compareMedinet(
  local: { employeeName: string; number: string; issuedAt: string; issuer: string; subject: string; scope: string; status: string },
  record: MedinetRecord,
  clinicLicenses: string[],
  today: string,
) {
  const diffs: MedinetDiff[] = [];
  const cmp = (f: MedinetDiff["field"], l: string | null, r: string | null, severity: MedinetDiff["severity"]) => {
    if (r == null || r === "") return; // medinet không ghi → không kết luận
    if (norm(l ?? "") !== norm(r)) diffs.push({ field: f, local: l, remote: r, severity });
  };
  cmp("name", local.employeeName, record.name, "danger");
  if (record.issuedAt && local.issuedAt !== record.issuedAt) diffs.push({ field: "issuedAt", local: local.issuedAt, remote: record.issuedAt, severity: "warn" });
  cmp("issuer", local.issuer, record.issuer, "warn");
  cmp("subject", local.subject, record.subject, "warn");
  // Phạm vi hay khác dấu câu / cách viết: so sau khi bỏ hết dấu câu.
  if (record.scope && loose(local.scope) !== loose(record.scope)) diffs.push({ field: "scope", local: local.scope, remote: record.scope, severity: "warn" });
  if (record.status !== "UNKNOWN" && record.status !== local.status) {
    diffs.push({ field: "status", local: local.status, remote: record.statusText, severity: record.status === "ACTIVE" ? "warn" : "danger" });
  }
  const mine = new Set(clinicLicenses.map(normLicense).filter(Boolean));
  const current = record.workplaces.filter((w) => activeWorkplace(w, today));
  // Cùng số GPHĐ; medinet đôi khi chỉ ghi phần số (vd. "04135" thay cho "04135/HCM-GPHĐ") → so phần số.
  const isMine = (w: MedinetWorkplace) => {
    const l = normLicense(w.facilityLicense ?? "");
    // Một bên chỉ ghi phần số (medinet "04135", hoặc Cấu hình nhập "02222") → so phần số.
    return !!l && [...mine].some((c) => l === c || ((!l.includes("/") || !c.includes("/")) && l.split("/")[0] === c.split("/")[0]));
  };
  // medinet hay ghi một cơ sở 2 lần ("01111/HCM-GPHĐ" và "01111"): gộp theo phần số của GPHĐ (hoặc tên khi thiếu số).
  const seen = new Set<string>();
  const known = mine.size > 0 && record.workplaces.length > 0; // không đọc được bảng nơi công tác → không kết luận
  const elsewhere = (known ? current.filter((w) => !isMine(w)) : []).filter((w) => {
    const k = w.facilityLicense ? normLicense(w.facilityLicense).split("/")[0] : norm(w.facility);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const atClinic = known ? current.some(isMine) : null;
  return { diffs, elsewhere, atClinic };
}

// ---------------------------------------------------------------- gọi mạng
const g = globalThis as unknown as { __medinetQueue?: Promise<unknown>; __medinetDepth?: number; __medinetLastEnd?: number; __medinetFetch?: typeof fetch };
const MAX_QUEUE = 3;
/** Cho test thay fetch (không gọi mạng thật). */
export function __setMedinetFetch(f: typeof fetch | null) {
  g.__medinetFetch = f ?? undefined;
  g.__medinetLastEnd = 0;
}

/** Mọi lượt gọi medinet trong cả máy chủ chạy NỐI TIẾP, lượt sau bắt đầu ≥ 4 giây sau khi lượt trước XONG; hàng chờ > 3 thì từ chối ngay. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  if ((g.__medinetDepth ?? 0) >= MAX_QUEUE) return Promise.reject(new Error("medinet đang bận (nhiều lượt tra cùng lúc), thử lại sau ít phút"));
  g.__medinetDepth = (g.__medinetDepth ?? 0) + 1;
  const run = (g.__medinetQueue ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const wait = (g.__medinetLastEnd ?? 0) + MIN_GAP_MS - Date.now();
      if (wait > 0 && !g.__medinetFetch) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        g.__medinetLastEnd = Date.now();
      }
    })
    .finally(() => {
      g.__medinetDepth = Math.max(0, (g.__medinetDepth ?? 1) - 1);
    });
  g.__medinetQueue = run;
  return run;
}

async function post(path: string, body: unknown, contentType: string): Promise<string> {
  const res = await (g.__medinetFetch ?? fetch)(`${MEDINET_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Requested-With": "XMLHttpRequest", Referer: `${MEDINET_BASE}/`, "User-Agent": "Mozilla/5.0 (FaceBeo HR; tra cứu GPHN nhân viên)" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`medinet trả HTTP ${res.status}`);
  return res.text();
}

/** Số kết quả trang tìm kiếm tự ghi ("… (1 kết quả, …)"); null = không nhận ra trang (bị chặn / đổi giao diện). */
export function searchCount(html: string): number | null {
  const m = htmlText(html).match(/(\d+)\s*kết\s*quả/i);
  return m ? Number(m[1]) : null;
}

export type LookupResult =
  | { ok: true; record: MedinetRecord | null; candidates: number; ambiguous?: boolean }
  | { ok: false; error: string };

/**
 * Tra theo số GPHN (khớp chính xác). Nhiều thẻ cùng số (cấp lại, trùng dữ liệu): ưu tiên đúng tên nhân viên, rồi "Hoạt động";
 * vẫn không phân định được thì trả ambiguous (không kết luận). Trang không nhận ra được (bị chặn / đổi giao diện) → ok:false, không phải "không tìm thấy".
 */
export async function lookupMedinet(number: string, preferName?: string): Promise<LookupResult> {
  const key = number.replace(/\s+/g, ""); // medinet so chính xác: bỏ mọi khoảng trắng ("0012345 / BYT-CCHN")
  if (key.length < 3) return { ok: false, error: "Số GPHN quá ngắn" };
  try {
    return await enqueue(async () => {
      const html = await post("/chungchihanhnghey", { key_word: key, checked: 1, page: 1, results_per_page: 10 }, "application/json");
      const list = parseSearch(html);
      const count = searchCount(html);
      if (!list.length) {
        if (count === 0) return { ok: true as const, record: null, candidates: 0 };
        return { ok: false as const, error: "Không đọc được trang kết quả medinet (có thể bị chặn hoặc trang đã đổi giao diện)" };
      }
      let hits = list.filter((c) => normLicense(c.number) === normLicense(key));
      if (!hits.length) return { ok: true as const, record: null, candidates: list.length };
      if (hits.length > 1 && preferName) {
        const byName = hits.filter((c) => norm(c.name) === norm(preferName));
        if (byName.length) hits = byName;
      }
      if (hits.length > 1) {
        const active = hits.filter((c) => statusFromText(c.statusText) === "ACTIVE");
        if (active.length) hits = active;
      }
      if (hits.length > 1) return { ok: true as const, record: null, candidates: list.length, ambiguous: true };
      const record = parseDetail(hits[0].id, await post("/chungchihanhngheydetail", { check: hits[0].id }, "application/html"));
      if (!record) return { ok: false as const, error: "Không đọc được trang chi tiết medinet (có thể trang đã đổi giao diện)" };
      return { ok: true as const, record, candidates: list.length };
    });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "medinet không phản hồi (quá 20 giây)" : (e as Error).message;
    return { ok: false, error: `Không tra được medinet: ${msg}` };
  }
}
