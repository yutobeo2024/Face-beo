// QC v1.11.0 — ca đối kháng cho phần đọc HTML / so sánh / tra cứu medinet (không gọi mạng: fetch được thay bằng __setMedinetFetch).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { __setMedinetFetch, compareMedinet, htmlText, lookupMedinet, norm, parseDetail, parseSearch, statusFromText } from "@/lib/medinet";
import { medinetIssues } from "@/lib/credentials";

const fx = (f: string) => readFileSync(join(process.cwd(), "tests", "fixtures", f), "utf8");
const LOCAL = { employeeName: "Nguyễn Văn An", number: "0012345/BYT-CCHN", issuedAt: "2015-03-15", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám bệnh, chữa bệnh chuyên khoa Nội tổng hợp", status: "ACTIVE" };
const TODAY = "2026-09-22";

// ---------- HTML tổng hợp từ mẫu
const card = (id: string, name: string, num: string, date = "15/03/2015", status = "Hoạt động") =>
  `<div class="col-md-6 mb-4"><div class="card hospital-card coso coso-hanhnghey" data-class=${id}><div class="card-body"><h5 class="card-title card-title-custom"><i class="fas fa-user-tie logo-list" style="font-size: 40px"></i>${name}<br /><span>${num}&nbsp;-&nbsp;[${date}]</span></h5><p class="card-text"><i class="fa fa-info-circle me-1"></i><span class="font-weight-bold">${status}</span></p></div></div></div>`;
const searchHtml = (cards: string[]) => `<div class="row">${cards.join("")}</div>\n<ul class="pagination pagination-right" id="paginationContainer"></ul>`;
const row = (lic: string, start: string, end: string, sched = "T2: 07:00 -> 17:00") =>
  `<tr class=table-light><td>1</td><td><div class="text-success">Số giấy phép: ${lic}</div><div class="text-primary"> Vị trí: Bác sĩ</div><div class="text-info">Khoa: Nội</div></td><td class="text-dark">${start}</td><td class="text-dark">${end}</td><td class="text-dark">${sched}</td><td class="text-dark">12 Đường Mẫu</td></tr>`;
function detailHtml(o: { name?: string; scope?: string; status?: string; tbody?: string | null } = {}) {
  let h = fx("medinet-detail.html");
  if (o.name !== undefined) h = h.replace(`for="hovaten">Họ và tên:</label><p class="form-control">Nguyễn Văn An</p>`, () => `for="hovaten">Họ và tên:</label><p class="form-control">${o.name}</p>`);
  if (o.scope !== undefined) h = h.replace(/(for="phamvi_hanhnghe">[^<]*<\/label><p class="form-control">)[^<]*(<\/p>)/, (_, a, b) => a + o.scope + b);
  if (o.status !== undefined) h = h.replace(/(for="active">[^<]*<\/label><p class="form-control">)[^<]*(<\/p>)/, (_, a, b) => a + o.status + b);
  if (o.tbody === null) h = h.replace(/<div class="form-group table-responsive">[\s\S]*?<\/table><\/div>/, () => "");
  else if (o.tbody !== undefined) h = h.replace(/<tbody>[\s\S]*?<\/tbody>/, () => `<tbody>${o.tbody}</tbody>`);
  return h;
}
const rec = (o: Parameters<typeof detailHtml>[0] = {}) => parseDetail("id-1", detailHtml(o))!;

// ---------- fetch giả
type Call = { path: string; body: Record<string, unknown> };
let calls: Call[] = [];
function stub(handler: (path: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  calls = [];
  __setMedinetFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(/^https:\/\/[^/]+/, "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, body });
    return handler(path, body);
  }) as typeof fetch);
}
afterEach(() => __setMedinetFetch(null));
afterAll(() => __setMedinetFetch(null));

const ID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ID_B = "bbbbbbbb-0000-0000-0000-000000000002";
const ID_C = "cccccccc-0000-0000-0000-000000000003";
const THREE = searchHtml([card(ID_A, "TRẦN THỊ B", "00123456/BYT-CCHN"), card(ID_B, "NGUYỄN VĂN AN", "0012345/BYT-CCHN"), card(ID_C, "LÊ C", "10012345/BYT-CCHN")]);

describe("QC: chọn đúng thẻ khi số gần giống", () => {
  it("3 thẻ số gần giống → chọn đúng thẻ khớp chính xác, mở chi tiết của thẻ đó", async () => {
    stub((p) => new Response(p.endsWith("detail") ? fx("medinet-detail.html") : THREE));
    const r = await lookupMedinet("0012345/BYT-CCHN");
    expect(r).toMatchObject({ ok: true, candidates: 3 });
    expect(calls[1]).toEqual({ path: "/chungchihanhngheydetail", body: { check: ID_B } });
    expect(parseSearch(THREE).map((c) => c.number)).toEqual(["00123456/BYT-CCHN", "0012345/BYT-CCHN", "10012345/BYT-CCHN"]);
  });

  it("không thẻ nào khớp chính xác (chỉ có số chứa số cần tra) → record null, không mở chi tiết", async () => {
    stub(() => new Response(searchHtml([card(ID_A, "A", "00123456/BYT-CCHN"), card(ID_C, "C", "10012345/BYT-CCHN")])));
    const r = await lookupMedinet("0012345/BYT-CCHN");
    expect(r).toEqual({ ok: true, record: null, candidates: 2 });
    expect(calls.map((c) => c.path)).toEqual(["/chungchihanhnghey"]);
  });

  it("biến thể cách viết số: khoảng trắng, chữ thường, Đ/D, đ thường", async () => {
    const S = searchHtml([card(ID_A, "X", "000123/HCM-GPHĐ"), card(ID_B, "Y", "0012345/BYT-CCHN")]);
    stub((p) => new Response(p.endsWith("detail") ? fx("medinet-detail.html") : S));
    for (const [key, id] of [
      ["  0012345/byt-cchn  ", ID_B],
      ["0012345 / BYT - CCHN", ID_B],
      ["000123/HCM-GPHD", ID_A],
      ["000123/hcm-gphđ", ID_A],
    ] as const) {
      const r = await lookupMedinet(key);
      expect(r.ok && r.record, key).toBeTruthy();
      expect(calls.at(-1)!.body, key).toEqual({ check: id });
    }
  });

  it("số có khoảng trắng bên trong: key_word gửi lên medinet (tìm chính xác) nên bỏ khoảng trắng", async () => {
    stub(() => new Response("<div>0 kết quả</div>"));
    await lookupMedinet("0012345 / BYT-CCHN");
    expect(calls[0].body.key_word).toBe("0012345/BYT-CCHN");
  });

  it("số quá ngắn → không gọi mạng", async () => {
    stub(() => new Response(""));
    expect(await lookupMedinet("  ab ")).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe("QC: nhiều thẻ cùng số, hàng chờ", () => {
  const DUP = (s1 = "Hoạt động", s2 = "Hoạt động") => searchHtml([card(ID_A, "NGUYỄN VĂN AN", "0012345/BYT-CCHN", "15/03/2015", s1), card(ID_B, "TRẦN THỊ B", "0012345/BYT-CCHN", "15/03/2015", s2)]);
  it("2 thẻ cùng số: ưu tiên đúng tên; rồi thẻ Hoạt động; không phân định → ambiguous, không mở chi tiết", async () => {
    stub((p) => new Response(p.endsWith("detail") ? fx("medinet-detail.html") : DUP()));
    await lookupMedinet("0012345/BYT-CCHN", "Trần Thị B");
    expect(calls.at(-1)!.body).toEqual({ check: ID_B });
    stub((p) => new Response(p.endsWith("detail") ? fx("medinet-detail.html") : DUP("Thu hồi", "Hoạt động")));
    await lookupMedinet("0012345/BYT-CCHN");
    expect(calls.at(-1)!.body).toEqual({ check: ID_B });
    stub((p) => new Response(p.endsWith("detail") ? fx("medinet-detail.html") : DUP()));
    expect(await lookupMedinet("0012345/BYT-CCHN", "Ai Khác")).toMatchObject({ ok: true, record: null, ambiguous: true });
    expect(calls.map((c) => c.path)).toEqual(["/chungchihanhnghey"]);
  });

  it("trang tìm kiếm lạ (không thẻ, không ghi 'N kết quả') → ok:false, không phải 'không tìm thấy'", async () => {
    stub(() => new Response("<html>Access denied</html>"));
    expect((await lookupMedinet("0012345/BYT-CCHN")).ok).toBe(false);
  });

  it("5 lượt cùng lúc → tối đa 3 vào hàng chờ, số còn lại bị từ chối 'bận'; hàng chờ trống lại sau đó", async () => {
    let inFlight = 0, maxInFlight = 0;
    stub(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return new Response("<div>0 kết quả</div>");
    });
    const rs = await Promise.all(Array.from({ length: 5 }, () => lookupMedinet("0012345/BYT-CCHN")));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.error.includes("bận"))).toBe(true);
    expect(maxInFlight).toBe(1); // nối tiếp
    expect((await lookupMedinet("0012345/BYT-CCHN")).ok).toBe(true);
  });
});

describe("QC: lỗi mạng / trang lạ", () => {
  it("HTTP 500 ở trang tìm kiếm hoặc chi tiết → ok:false", async () => {
    stub(() => new Response("oops", { status: 500 }));
    const r = await lookupMedinet("0012345/BYT-CCHN");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("500");
    stub((p) => (p.endsWith("detail") ? new Response("", { status: 503 }) : new Response(fx("medinet-search.html"))));
    expect((await lookupMedinet("0012345/BYT-CCHN")).ok).toBe(false);
  });

  it("hết thời gian chờ → thông báo 'quá 20 giây'; chi tiết đổi giao diện → ok:false", async () => {
    stub(() => {
      throw new DOMException("timeout", "TimeoutError");
    });
    const r = await lookupMedinet("0012345/BYT-CCHN");
    expect(!r.ok && r.error).toContain("20 giây");
    stub((p) => new Response(p.endsWith("detail") ? "<html>đổi giao diện</html>" : fx("medinet-search.html")));
    expect((await lookupMedinet("0012345/BYT-CCHN")).ok).toBe(false);
  });
});

describe("QC: bảng nơi công tác", () => {
  it("không có bảng / bảng rỗng → 0 nơi công tác; có GPHĐ phòng khám → không kết luận (atClinic null), không 'nơi khác'", () => {
    for (const tbody of [null, ""]) {
      const d = rec({ tbody });
      expect(d.workplaces).toEqual([]);
      const c = compareMedinet(LOCAL, d, ["02222/HCM-GPHĐ"], TODAY);
      expect(c).toMatchObject({ diffs: [], elsewhere: [], atClinic: null });
      expect(medinetIssues(JSON.stringify({ ok: true, found: true, record: d, ...c }))).toEqual([]);
    }
  });

  it("đã nghỉ (ngày nghỉ trong quá khứ) → không tính 'nơi khác'; ngày nghỉ trước ngày làm → còn hiệu lực; nghỉ hôm nay / tương lai → còn", () => {
    const d = rec({
      tbody:
        row("02222/HCM-GPHĐ - Phòng khám mình", "01/06/2017", "") +
        row("03333/HCM-GPHĐ - Đã nghỉ", "01/01/2018", "01/01/2020") +
        row("04444/HCM-GPHĐ - Ghi ngược", "01/01/2019", "01/06/2018") +
        row("05555/HCM-GPHĐ - Nghỉ hôm nay", "01/01/2019", "22/09/2026") +
        row("06666/HCM-GPHĐ - Nghỉ năm sau", "01/01/2019", "31/12/2030"),
    });
    expect(d.workplaces).toHaveLength(5);
    const c = compareMedinet(LOCAL, d, ["02222/HCM-GPHĐ"], TODAY);
    expect(c.atClinic).toBe(true);
    expect(c.elsewhere.map((w) => w.facilityLicense)).toEqual(["04444/HCM-GPHĐ", "05555/HCM-GPHĐ", "06666/HCM-GPHĐ"]);
  });

  it("nơi mình đã nghỉ (hết hạn) → atClinic false", () => {
    const d = rec({ tbody: row("02222/HCM-GPHĐ - Phòng khám mình", "01/06/2017", "01/01/2020") });
    expect(compareMedinet(LOCAL, d, ["02222/HCM-GPHĐ"], TODAY).atClinic).toBe(false);
  });

  it("cấu hình GPHĐ phòng khám chỉ ghi phần số ('02222') → vẫn nhận ra '02222/HCM-GPHĐ' là của mình", () => {
    const c = compareMedinet(LOCAL, rec(), ["02222"], TODAY);
    expect(c.atClinic).toBe(true);
    expect(c.elsewhere.map((w) => w.facilityLicense)).toEqual(["01111/HCM-GPHĐ"]);
  });

  it("cấu hình GPHĐ viết thường / GPHD không dấu → vẫn nhận ra", () => {
    for (const cfg of ["02222/hcm-gphđ", "02222/HCM-GPHD", " 02222 / HCM-GPHĐ "]) {
      expect(compareMedinet(LOCAL, rec(), [cfg], TODAY).atClinic, cfg).toBe(true);
    }
  });
});

describe("QC: so sánh phạm vi & tình trạng", () => {
  it("phạm vi chỉ khác dấu câu cuối / khoảng trắng thừa / hoa-thường → không khác", () => {
    for (const scope of ["Khám bệnh, chữa bệnh chuyên khoa Nội tổng hợp", "Khám bệnh,  chữa bệnh chuyên khoa   Nội tổng hợp ;", "  KHÁM BỆNH, CHỮA BỆNH CHUYÊN KHOA NỘI TỔNG HỢP.  ", "Khám bệnh, chữa bệnh\nchuyên khoa Nội tổng hợp:"]) {
      expect(compareMedinet(LOCAL, rec({ scope }), [], TODAY).diffs, JSON.stringify(scope)).toEqual([]);
    }
  });

  it("phạm vi khác nội dung thật → diff 'scope' mức warn → medinetIssues 'medinet-diff-scope'", () => {
    const d = rec({ scope: "Khám bệnh, chữa bệnh chuyên khoa Ngoại tổng hợp" });
    const c = compareMedinet(LOCAL, d, [], TODAY);
    expect(c.diffs).toEqual([{ field: "scope", local: LOCAL.scope, remote: "Khám bệnh, chữa bệnh chuyên khoa Ngoại tổng hợp", severity: "warn" }]);
    expect(medinetIssues(JSON.stringify({ ok: true, found: true, record: d, ...c })).map((i) => i.kind)).toEqual(["medinet-diff-scope"]);
  });

  it("Đình chỉ / Tạm dừng → SUSPENDED (danger); Thu hồi → REVOKED (danger); chữ lạ → UNKNOWN, không có diff tình trạng", () => {
    expect(statusFromText("Đình chỉ")).toBe("SUSPENDED");
    expect(statusFromText("Tạm dừng hành nghề")).toBe("SUSPENDED");
    expect(statusFromText("THU HỒI")).toBe("REVOKED");
    expect(statusFromText("Hết hiệu lực")).toBe("REVOKED");
    for (const [text, st] of [["Đình chỉ", "SUSPENDED"], ["Thu hồi", "REVOKED"]] as const) {
      const d = rec({ status: text });
      expect(d.status).toBe(st);
      const c = compareMedinet(LOCAL, d, [], TODAY);
      expect(c.diffs).toEqual([{ field: "status", local: "ACTIVE", remote: text, severity: "danger" }]);
      expect(medinetIssues(JSON.stringify({ ok: true, found: true, record: d, ...c }))[0]).toMatchObject({ kind: `medinet-status-${st}`, severity: "danger" });
    }
    const u = rec({ status: "Đang cập nhật" });
    expect(u.status).toBe("UNKNOWN");
    expect(compareMedinet({ ...LOCAL, status: "SUSPENDED" }, u, [], TODAY).diffs).toEqual([]);
  });

  it("medinet Hoạt động nhưng hồ sơ ghi đình chỉ → diff status mức warn (không phải danger)", () => {
    const c = compareMedinet({ ...LOCAL, status: "SUSPENDED" }, rec(), [], TODAY);
    expect(c.diffs).toEqual([{ field: "status", local: "SUSPENDED", remote: "Hoạt động", severity: "warn" }]);
  });

  it("'Không hoạt động' / 'Ngừng hoạt động' không được hiểu là ACTIVE", () => {
    expect(statusFromText("Không hoạt động")).not.toBe("ACTIVE");
    expect(statusFromText("Ngừng hoạt động")).not.toBe("ACTIVE");
  });
});

describe("QC: thực thể HTML & thẻ script ra chữ thuần", () => {
  it("&amp; &quot; &#39; &nbsp; &#number; được giải mã; thẻ (kể cả <script>) bị bỏ", () => {
    const d = rec({ name: `Nguy&#7877;n <b>V&#259;n</b> An<script>alert(1)</script>`, scope: `Kh&aacute;m &amp; chữa &quot;Nội&quot; O&#39;Brien&nbsp;x` });
    expect(d.name).toBe("Nguyễn Văn An alert(1)");
    expect(d.name).not.toMatch(/[<>]/);
    expect(d.scope).toContain(`& chữa "Nội" O'Brien x`);
    const s = parseSearch(searchHtml([card(ID_A, `<script>x()</script>TRẦN &amp; LÊ`, "0012345/BYT-CCHN")]));
    expect(s[0].name).not.toMatch(/[<>]/);
    expect(s[0].name).toContain("TRẦN & LÊ");
  });

  it("&lt;script&gt; mã hóa ra chữ thuần (không bị giải mã 2 lần thành thẻ thật khi render — chỉ là ký tự)", () => {
    expect(htmlText("&lt;script&gt;x&lt;/script&gt;")).toBe("<script>x</script>");
    // mã hóa kép: &amp;lt; phải ra '&lt;' chứ không phải '<'
    expect(htmlText("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });

  it("thực thể số hệ 16 (&#x1EC5;) được giải mã", () => {
    expect(htmlText("Nguy&#x1EC5;n")).toBe("Nguyễn");
  });

  it("&amp;#39; không bị giải mã 2 lần", () => {
    expect(htmlText("&amp;#39;")).toBe("&#39;");
  });

  it("norm: ký tự đ/Đ và dấu", () => {
    expect(norm("ĐỖ ĐĂNG")).toBe(norm("Đỗ Đăng"));
    expect(norm("Đỗ")).toBe("do");
  });
});
