# Các quyết định còn mở

Ghi lại những điểm đã phát hiện trong quá trình làm và test, cần chủ dự án quyết định sau. Khi đã chốt, chuyển mục sang phần "Đã chốt" và cập nhật PRD.

## Đang mở

### D1. Cách trừ giờ nghỉ khi tính giờ công

- **Ghi nhận:** 19/09/2026, khi test kiosk với 2 nhân viên (BEO, yuto).
- **Hiện trạng:** làm đúng công thức PRD mục 4: `giờ công = (OUT cuối − IN) − breakMinutes`, chặn trên bằng `độ dài ca − breakMinutes`. Code: `workMinutes()` trong `src/lib/attendance.ts`.
- **Vấn đề:** giờ nghỉ luôn bị trừ đủ, kể cả khi nhân viên không có mặt trong khung giờ nghỉ.
  - Vào 13:00, ra 17:00 (ca 08:00–17:00, nghỉ 60 phút): hệ thống tính **3 giờ** thay vì 4 giờ.
  - Có mặt dưới 60 phút: giờ công = 0.
- **Phương án đề xuất:** thêm giờ bắt đầu nghỉ vào `Shift` (ví dụ `breakStart = "12:00"`), rồi chỉ trừ **phần giờ nghỉ giao với khoảng có mặt thực tế**. Cần:
  - thêm migration Prisma cho trường mới;
  - sửa ô nhập ở trang Cấu hình → Ca làm việc;
  - sửa `workMinutes()` và bổ sung unit test.
- **Ảnh hưởng:** chỉ ảnh hưởng số "giờ công" trong bảng công và Excel. **Không** ảnh hưởng đi trễ, về sớm, OT hay vắng mặt.
- **Trạng thái:** tạm giữ theo PRD, quyết định sau.

### D2. Khóa công theo tháng

- **Vấn đề:** HR/ADMIN hiện vẫn sửa được ca, xóa log hay chấm tay theo đơn ở những ngày thuộc tháng đã chốt lương, trong giới hạn 7 ngày của đơn bổ sung công. Bảng công đã xuất có thể lệch với dữ liệu hiện tại.
- **Phương án:** thêm thao tác "Chốt công tháng" (chỉ ADMIN). Sau khi chốt, mọi thao tác làm đổi công trong tháng đó bị chặn, trừ khi ADMIN mở khóa kèm lý do (ghi AuditLog và gửi tin nhóm Zalo).
- **Trạng thái:** chờ quyết định.

### D3. Đơn chờ HR quá lâu có tự chuyển lên Quản trị không

- **Vấn đề:** đơn của quản lý và đơn bổ sung công chờ HR xử lý. Nếu HR vắng mặt, đơn có thể bị treo.
- **Phương án:** job nhắc HR khi đơn chờ quá 24 giờ. Quá 48 giờ thì báo ADMIN (ADMIN vốn đã duyệt hay chấm tay thay được).
- **Trạng thái:** chờ quyết định.

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
