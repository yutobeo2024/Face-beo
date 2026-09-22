// v1.11.0: đọc HTML medinet (mẫu ẩn danh) + so sánh với hồ sơ — hàm thuần, không gọi mạng.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareMedinet, norm, parseDetail, parseSearch, statusFromText, type MedinetRecord } from "@/lib/medinet";
import { medinetIssues } from "@/lib/credentials";

const fx = (f: string) => readFileSync(join(process.cwd(), "tests", "fixtures", f), "utf8");
const LOCAL = { employeeName: "Nguyễn Văn An", number: "0012345/BYT-CCHN", issuedAt: "2015-03-15", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám bệnh, chữa bệnh chuyên khoa Nội tổng hợp", status: "ACTIVE" };
const TODAY = "2026-09-22";
const detail = () => parseDetail("id-1", fx("medinet-detail.html"))!;

describe("đọc HTML medinet", () => {
  it("trang tìm kiếm: id, tên, số GPHN, ngày cấp, tình trạng", () => {
    expect(parseSearch(fx("medinet-search.html"))).toEqual([
      { id: "11111111-2222-3333-4444-555555555555", name: "NGUYỄN VĂN AN", number: "0012345/BYT-CCHN", issuedAt: "2015-03-15", statusText: "Hoạt động" },
    ]);
    expect(parseSearch("<div>không có kết quả</div>")).toEqual([]);
  });

  it("trang chi tiết: đủ trường + 3 nơi công tác, GPHĐ có dấu '-' tách đúng", () => {
    const d = detail();
    expect(d).toMatchObject({ name: "Nguyễn Văn An", number: "0012345/BYT-CCHN", issuedAt: "2015-03-15", issuer: "Bộ Y tế", subject: "BÁC SĨ", status: "ACTIVE", statusText: "Hoạt động" });
    expect(d.workplaces).toHaveLength(3);
    expect(d.workplaces[2]).toMatchObject({ facilityLicense: "02222/HCM-GPHĐ", facility: "Công ty Cổ phần Bệnh viện Mẫu B", department: "Nội tổng hợp", startDate: "2017-06-01", endDate: null });
    expect(parseDetail("x", "<p>trang đổi giao diện</p>")).toBeNull();
  });

  it("tình trạng từ chữ", () => {
    expect(statusFromText("Hoạt động")).toBe("ACTIVE");
    expect(statusFromText("Đình chỉ hành nghề")).toBe("SUSPENDED");
    expect(statusFromText("Thu hồi")).toBe("REVOKED");
    expect(statusFromText("Không còn hoạt động")).toBe("REVOKED");
    expect(statusFromText("")).toBe("UNKNOWN");
    expect(statusFromText("Không hoạt động")).toBe("REVOKED");
    expect(statusFromText("Đã chuyển nơi hành nghề")).toBe("UNKNOWN"); // "chuyển" không bị hiểu nhầm là "hủy"
    expect(norm("  BÁC SĨ. ")).toBe(norm("Bác sĩ"));
  });
});

describe("so sánh với hồ sơ", () => {
  it("khớp hoàn toàn (hoa/thường, dấu chấm cuối) → không khác; cơ sở của mình được nhận ra, nơi khác gộp trùng", () => {
    const c = compareMedinet(LOCAL, detail(), ["02222/HCM-GPHĐ"], TODAY);
    expect(c.diffs).toEqual([]);
    expect(c.atClinic).toBe(true);
    expect(c.elsewhere.map((w) => w.facilityLicense)).toEqual(["01111/HCM-GPHĐ"]); // "01111" và "01111/HCM-GPHĐ" là một
  });

  it("chưa cấu hình GPHĐ phòng khám → không xét nơi khác", () => {
    const c = compareMedinet(LOCAL, detail(), [], TODAY);
    expect(c.elsewhere).toEqual([]);
    expect(c.atClinic).toBeNull();
  });

  it("tên, ngày cấp, tình trạng khác → liệt kê; medinet bị thu hồi là nghiêm trọng", () => {
    const rec: MedinetRecord = { ...detail(), status: "REVOKED", statusText: "Thu hồi" };
    const c = compareMedinet({ ...LOCAL, employeeName: "Nguyễn Văn Bình", issuedAt: "2015-03-16" }, rec, ["99999/HCM-GPHĐ"], TODAY);
    expect(c.diffs.map((d) => [d.field, d.severity])).toEqual([["name", "danger"], ["issuedAt", "warn"], ["status", "danger"]]);
    expect(c.atClinic).toBe(false);
    const issues = medinetIssues(JSON.stringify({ ok: true, found: true, record: rec, ...c }));
    expect(issues.map((i) => i.kind)).toEqual(["medinet-status-REVOKED", "medinet-name", "medinet-diff-issuedAt", "medinet-not-at-clinic", "medinet-elsewhere-01111+02222"]);
    expect(issues[0].severity).toBe("danger");
    // Tin nhóm Zalo không nêu tên cơ sở khác / giờ làm (chỉ số nơi).
    expect(issues.find((i) => i.kind.startsWith("medinet-elsewhere"))!.text).toBe("medinet ghi đang đăng ký hành nghề thêm 2 nơi khác — xem Hồ sơ hành nghề");
  });

  it("medinetIssues: không tìm thấy → cảnh báo; lỗi tra / JSON hỏng / trống → không cảnh báo", () => {
    expect(medinetIssues(JSON.stringify({ ok: true, found: false })).map((i) => i.kind)).toEqual(["medinet-notfound"]);
    expect(medinetIssues(JSON.stringify({ ok: false, error: "timeout" }))).toEqual([]);
    expect(medinetIssues("{hỏng")).toEqual([]);
    expect(medinetIssues(null)).toEqual([]);
  });
});
