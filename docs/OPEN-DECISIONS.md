# Các quyết định còn mở

Ghi lại những điểm đã phát hiện trong quá trình làm và test, cần chủ dự án quyết định sau. Khi đã chốt, chuyển mục sang phần "Đã chốt" và cập nhật PRD.

## Đang mở

### D4. Tin nhắn Zalo cá nhân tới nhân viên (báo vắng, duyệt đơn, nhắc ca…)

- **Ghi nhận:** 19/09/2026, khi nối Zalo OA thật.
- **Ràng buộc Zalo:** OA chỉ gửi *tin tư vấn* miễn phí trong 48 giờ sau khi nhân viên nhắn cho OA; qua OpenAPI tối đa 7 ngày (có phí); quá 7 ngày
  không gửi được. Nhân viên ít nhắn OA nên phần lớn tin sẽ không tới.
- **Phương án:**
  - **ZNS** (tin theo mẫu, gửi theo số điện thoại, không cần liên kết): ổn định, ~200–800đ/tin, phải đăng ký ~6 mẫu và được Zalo duyệt, nạp tiền ZBS.
  - **Tin tư vấn + quy ước nhân viên nhắn OA hằng ngày**: miễn phí, không đảm bảo tới.
  - **Kết hợp**: tư vấn khi còn trong 48 giờ, không thì ZNS.
- **Trạng thái:** chờ quyết định. Giai đoạn 1 (v1.4) chỉ gửi tin vào nhóm minh bạch; tin cá nhân vẫn ở chế độ hiện có (gửi tin tư vấn nếu nhân viên
  đã liên kết, không thì ghi `SKIPPED_NO_ZALO`).

### D7. Đổi các bí mật đã lộ khi triển khai

- Token Cloudflare Tunnel và `ZALO_WEBHOOK_SECRET` từng hiện trong ảnh chụp màn hình lúc cài đặt (21/09/2026). Cần **Refresh token** tunnel và
  tạo lại OA Secret Key webhook (nếu Zalo cho), dán lại vào `/opt/facebeo/.env`, `up -d --force-recreate`.
- **Trạng thái:** chờ chủ dự án thao tác.

## Đã chốt v1.11.0 (22/09/2026)

- **D5 tự tra cứu GPHN trên medinet (đợt 2)**: làm được — trang tracuu.medinet.org.vn tra bằng 2 yêu cầu dữ liệu (`/chungchihanhnghey`,
  `/chungchihanhngheydetail`), không captcha. Nút "Tra" điền sẵn form GPHN, nút "Tra cứu tự động", job 06:30 (30 ngày / người, ≤ 30 người /
  ngày, cách ≥ 4 giây). Không tự sửa dữ liệu Nhân sự — chỉ cảnh báo khi khác, tự ghi "đã đối chiếu" khi khớp. "Đăng ký nơi khác" xét theo
  **số GPHĐ của phòng khám** (Cấu hình). Hạn chế: chỉ dữ liệu Sở Y tế TP.HCM; trang đổi giao diện phải sửa bộ đọc. Xem PRD v2.1 mục 24.

## Đã chốt v1.10.4 (22/09/2026)

- **D6 sao lưu ra ngoài VPS → Cloudflare R2**: mỗi ngày 03:30, bản DB mới nhất + file scan + ảnh đại diện, mã hóa rclone crypt, giữ 30 ngày;
  `.env` không lên R2 (chủ dự án tự cất ngoài máy). Khôi phục thử bằng `deploy/restore-offsite.sh`. Xem `docs/DEPLOY-VPS.md`.

## Đã chốt v1.10.1–v1.10.2 (21/09/2026)

- **Máy chủ thật = VPS `103.142.27.210` qua Cloudflare Tunnel**, địa chỉ **https://face.ydsg.website**; Docker compose riêng (`facebeo`), không mở
  cổng host, không đụng các dự án khác trên VPS. Chuyển nguyên dữ liệu máy cũ (giữ `BIOMETRIC_KEY`, token Zalo). Máy local chỉ để phát triển.
- **Webhook Zalo**: xác thực domain bằng tệp HTML; chưa có khóa ký thì trả 200 và bỏ qua sự kiện; có khóa thì chữ ký sai → 401.
  Xem PRD v2.1 mục 23, `docs/DEPLOY-VPS.md`.

## Đã chốt v1.10.0 (21/09/2026)

- **Ảnh đại diện = ảnh nhìn thẳng lúc enroll** (cắt khuôn mặt 256×256, không lưu 4 góc còn lại). Xem: chính chủ, Nhân sự, Quản trị, quản lý
  phòng mình (theo quyền xem snapshot). Người enroll trước đây phải enroll lại mới có ảnh. Đổi cam kết "không lưu ảnh enroll" — nội dung
  đồng ý đã cập nhật. Xem PRD v2.1 mục 22.

## Đã chốt v1.9.0 (21/09/2026)

- **Hồ sơ hành nghề** (GPHN, văn bằng / chứng chỉ / CME kèm file scan) do Nhân sự nhập; có số GPHN thì bắt buộc đủ trường. Chu kỳ CME 5 năm tính
  từ ngày cấp / gia hạn GPHN (sửa được). Cảnh báo gửi **nhóm Zalo minh bạch**, mỗi vấn đề tối đa 1 lần / tháng. Làm 2 đợt (D5). Xem PRD v2.1 mục 21.

## Đã chốt (19/09/2026, xem `PRD-v2.1-HR.md`)

- **Vai trò Nhân sự (HR):**
  - Được: xem toàn công ty, quản lý nhân viên, enroll/xóa khuôn mặt, xem snapshot, xuất bảng công.
  - Không được: cấu hình hệ thống, thiết bị, phòng ban/quản lý, ngày lễ, định nghĩa ca.
- **Ma trận phân quyền:** lưu trong DB, chỉ ADMIN chỉnh trên web (phương án B). Các quyền lõi khóa cứng cho ADMIN.
- **Tuyến duyệt:** nhân viên → quản lý; quản lý → HR; HR → ADMIN.
- **Đơn bổ sung công hai bước:** duyệt, sau đó HR chấm tay; đơn của HR do ADMIN chấm tay. Chỉ ADMIN chấm tay trực tiếp.
- **Đăng ký ca tuần:**
  - Quản lý đăng ký trước 00:00 thứ Hai.
  - Sau khi đăng ký, chỉ HR sửa được, bắt buộc có lý do và có tin nhóm Zalo.
  - Bản nháp không được tính công.
- **Nhóm cố định theo mẫu tuần:** hai mẫu T2–T6 + T7 nửa ngày và T2–T7 cả ngày.
  - Nhân viên xoay ca mà tuần chưa đăng ký: trạng thái "Chưa có lịch", không báo vắng, báo HR.
  - Quyết định này thay quyết định cũ "chấm theo ca mặc định".
- **OT ngày không có ca:** tính theo đơn tăng ca đã duyệt.
- **Minh bạch:** thao tác duyệt/sửa của HR và ADMIN được gửi vào nhóm Zalo OA. Không gửi lần quét chấm công, cũng như thao tác ngang quyền nhân viên.

## Đã chốt v1.8.0 (21/09/2026)

- **Hồ sơ nhân viên có CCCD, ngày sinh, giới tính, địa chỉ; SĐT không bắt buộc.** Chỉ Nhân sự, Quản trị và chính chủ xem.
- **Nhập Excel**: chỉ Mã NV + Họ tên bắt buộc; mã đã có → cập nhật ô có điền; phòng trống → "Chưa phân phòng"; ca / mẫu tuần mặc định chọn khi
  nhập; còn lỗi thì không nhập dòng nào. Xem PRD v2.1 mục 20.

## Đã chốt v1.7.0 (21/09/2026)

- **Phòng ban = đơn vị quản lý** (ai duyệt, ai xếp ca); chuyên môn là **Chức danh / Chuyên khoa** của nhân viên (không ảnh hưởng quyền).
- **Cách duyệt đơn cấu hình theo phòng**: Trưởng phòng hoặc Nhân sự (mặc định) / Trưởng phòng → Nhân sự (2 bước) / Chỉ trưởng phòng.
- **Chỉ Nhân sự xếp ca**: bỏ quyền "Xếp ca" của vai trò Quản lý trong Phân quyền. Xem PRD v2.1 mục 19.

## Đã chốt v1.6.0 (21/09/2026)

- **Nhiều nhóm Zalo, mỗi nhóm chọn loại tin** (cấu hình được, không hard-code): Minh bạch / Chấm công nhân viên / Đơn từ nhân viên, lọc
  theo phòng cho tin nhân viên. Nhóm nhân viên (vd. "YDSG-NHÂN VIÊN"): **gửi ngay từng người** (không gom tin), đơn từ **chỉ trạng thái**
  (không lý do xin nghỉ, không ghi chú duyệt/từ chối), nhóm minh bạch cũ **giữ nguyên** luồng. "Vắng không phép" = hết ca, không lần quét
  nào, không có đơn nghỉ (đã duyệt hoặc đang chờ) — chỉ là tin báo, không đổi cách tính công. Xem PRD v2.1 mục 18.

## Đã chốt v1.5.4 (21/09/2026)

- **Đưa vào vận hành thật không qua dữ liệu mẫu.** `npm run db:seed:base` chỉ tạo cấu hình nền (ca, mẫu tuần, ngày lễ, quyền, cấu
  hình; ca "Sáng thứ Bảy" 4 giờ = 0.5 công), không xóa, không tạo nhân viên/phòng ban. `npm run admin:create` tạo Quản trị đầu tiên
  (chỉ khi chưa có Quản trị đang hoạt động), `--reset <mã>` cấp lại mật khẩu tạm cho Quản trị đang hoạt động. Seed demo tự dừng khi DB
  đã có nhân viên hoặc ca (ép bằng `npm run db:seed:force`). Xem PRD v2.1 mục 17.

## Đã chốt v1.5.3 (20/09/2026)

- **Không xóa cứng nhân viên đã có lịch sử.** Nút "Xóa tài khoản" chỉ dành cho tài khoản tạo nhầm (server từ chối khi có bất kỳ
  log/đơn/lịch/ngày chốt/nhật ký); nhân viên nghỉ việc dùng "bỏ tích Đang làm việc". Lý do: giữ bảng công đã chốt, nhật ký, không tái
  dùng mã NV/SĐT. Xem PRD mục 16.

## Đã chốt v1.5.1 (20/09/2026)

- **Xóa cấu hình tổ chức chỉ khi chưa đi vào lịch sử**: ca chỉ xóa khi chưa ai dùng; mẫu tuần chỉ xóa khi không nhân viên đang làm
  dùng (người đã nghỉ được gỡ liên kết); phòng ban chỉ xóa khi trống hoàn toàn (kể cả nhân viên đã nghỉ, tuần đã đăng ký, ngày đã
  chốt). Không có "xóa mềm" cho ca/phòng — muốn ngừng dùng thì đổi tên. Ngày lễ sửa được cả tên lẫn ngày. Xem PRD mục 14.

## Đã chốt v1.5.0 (20/09/2026)

- **Mục "Thông tin" (thư viện liên kết)** trong trang cá nhân: quyền mới `links.manage`, mặc định Nhân sự; Quản lý chỉ khi được cấp và
  bị giới hạn theo phòng mình phụ trách (phải chọn ≥ 1 phòng). Hiển thị theo luật giao vai trò ∩ phòng ban, trống = tất cả, không có
  ngoại lệ cho HR/Quản trị. Trên điện thoại mục này nằm trong ngăn "Thêm" (thanh dưới đã đủ 4 mục). Xem PRD mục 13.

## Đã chốt v1.4.3 (20/09/2026)

- **Giữ `org.manage` là quyền gộp toàn công ty**, không tách quyền "hệ số công của phòng mình" cho Quản lý. Ghi chú trong cẩm nang
  (mục 3) và PRD mục 2: không cấp `org.manage` cho Quản lý.

## Đã chốt v1.4 (19/09/2026)

- **Zalo OA giai đoạn 1: chỉ nhóm minh bạch (GMF).** OA có gói dịch vụ, nhóm đã tạo. Tin cá nhân để D4.
- **Webhook mở bằng Cloudflare Tunnel** khi cần liên kết nhân viên.

## Đã chốt v1.3 (19/09/2026)

- **Nhận diện khuôn mặt chuyển sang server (InsightFace R50):** do mô hình trên tablet nhận nhầm người có nét giống (đo trên dữ liệu thật). Phải enroll lại toàn bộ.
- Tuỳ chọn mô hình nhẹ `mbf` cho máy chủ yếu (`FACE_EMBED_MODEL=mbf`).

## Đã chốt v1.2 (19/09/2026, xem `PRD-v2.1-HR.md` mục 8–10)

- **Ngày công theo hệ số ca (mới):**
  - Mỗi ca có hệ số công chung (mặc định 1).
  - Quản trị đặt hệ số riêng theo phòng ban (ví dụ Hành chính: Sáng thứ Bảy = 0.5).
  - Khi triển khai, mọi hệ số đều bằng 1.
- **Nửa ngày phép:** đi làm nửa ngày, nửa còn lại nghỉ phép đã duyệt thì tính 0.5 công + 0.5 phép (nhân với hệ số).
  - Được coi là nửa ngày khi đơn che ≥ một nửa thời gian làm thực của ca, hoặc che trọn một buổi (trước hoặc sau giờ nghỉ trưa).
  - Đơn về sớm (VE_SOM) không trừ công.
- **D1 – Trừ giờ nghỉ:** ca có "Giờ bắt đầu nghỉ" thì giờ công chỉ trừ phần giờ nghỉ giao với khoảng có mặt. Ví dụ vào 13:00, ra 17:00 được 4 giờ.
  - Khoảng có mặt được kẹp trong giờ ca.
  - Chỉ ảnh hưởng cột "Giờ công"; ngày công và OT không đổi.
- **D2 – Chốt công tháng:**
  - HR hoặc Quản trị chốt tháng đã kết thúc, từ ngày 2 của tháng sau. Hệ thống lưu bản chụp kết quả từng ngày.
  - Sau khi chốt, chặn mọi thao tác ghi làm đổi công trong tháng (trả lỗi 409).
  - Chỉ Quản trị mở khóa, bắt buộc có lý do, có nhật ký và gửi tin nhóm Zalo.
- **D3 – Đơn chờ quá hạn:** quá 24 giờ thì nhắc người xử lý; quá 48 giờ thì báo Quản trị và nhóm Zalo. Không bao giờ tự duyệt.
