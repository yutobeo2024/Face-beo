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
