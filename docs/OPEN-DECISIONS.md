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

## Đã chốt

_(chưa có)_
