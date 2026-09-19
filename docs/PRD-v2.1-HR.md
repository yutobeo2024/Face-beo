# PRD v2.1: Vai trò Nhân sự, bổ sung công, đăng ký ca tuần

Bổ sung cho `PRD-v2-Face-Beo.md`, chốt ngày 19/09/2026. Khi hai tài liệu mâu thuẫn, **tài liệu này được ưu tiên** trong phạm vi nó mô tả.

## 1. Mục tiêu

- Quy trình nhân sự xoay quanh vai trò **Nhân sự (HR)**. Quản trị (ADMIN) giữ toàn quyền cấu hình hệ thống.
- Chặn gian lận xếp ca, ví dụ: sửa ca hôm nay để né đi trễ rồi sửa lại.
- **Minh bạch:** mọi thao tác duyệt/sửa của HR và ADMIN đều được gửi vào một nhóm Zalo OA.

## 2. Vai trò và phân quyền

- Vai trò: ADMIN, HR, MANAGER, EMPLOYEE.
- Quyền lưu dạng ma trận `RolePermission`. ADMIN chỉnh trên web; lưu phải có lý do, hệ thống ghi AuditLog và gửi tin nhóm.
- **Khóa cứng trong code:**
  - ADMIN có mọi quyền.
  - Chỉ ADMIN có các quyền `settings.system`, `devices.manage`, `permissions.manage`, `roles.assignPrivileged`.
  - Không tự duyệt hay tự chấm tay đơn của mình; không tự đổi vai trò hay tự cho mình nghỉ việc.
  - HR không sửa được tài khoản HR/ADMIN, cũng không đụng được khuôn mặt của họ.
- **Phạm vi dữ liệu theo vai trò:** ADMIN/HR toàn công ty; MANAGER các phòng mình quản lý; EMPLOYEE chỉ dữ liệu của mình.
- **HR mặc định có quyền:**
  - dashboard, xem/xếp ca, sửa ca đã đăng ký;
  - duyệt đơn, xem công, chấm tay theo đơn;
  - snapshot, báo cáo;
  - xem/quản lý nhân viên, enroll/xóa khuôn mặt.
- **HR không có quyền:**
  - cấu hình hệ thống, thiết bị;
  - phòng ban/gán quản lý, ngày lễ, định nghĩa ca, mẫu tuần (`org.manage`);
  - chấm tay trực tiếp, xóa log.

## 3. Tuyến duyệt đơn (mọi loại đơn)

| Người tạo | Người duyệt | Dự phòng |
| --- | --- | --- |
| EMPLOYEE | Quản lý phòng | HR, rồi ADMIN |
| MANAGER | HR | ADMIN |
| HR | ADMIN | |
| ADMIN | ADMIN khác | HR |

Ngoại lệ: ADMIN chỉ tự duyệt được đơn của mình khi không còn người duyệt nào khác.

## 4. Đơn bổ sung công (`BO_SUNG_CONG`)

**Tạo đơn:** nhân viên ghi giờ cần bổ sung, loại vào/ra, và lý do từ 10 ký tự.
- Giờ phải ≤ hiện tại và trong vòng 3 ngày.
- Không được trùng (±15 phút) với một đơn cùng loại khác.

**Bước 1, duyệt:** theo tuyến ở mục 3. HR luôn nhận thông báo khi đơn được tạo.

**Bước 2, chấm tay:** HR thực hiện; đơn của HR thì ADMIN thực hiện. Người thực hiện không được là người tạo đơn.
- Đơn chỉ được chấm tay khi đã duyệt, chưa chấm tay, và giờ bổ sung còn trong vòng 7 ngày.
- Có thể chỉnh giờ tối đa 60 phút, trong cùng ngày công, kèm ghi chú.
- Log tạo ra phải đúng loại vào/ra của đơn; sai loại thì hủy toàn bộ, không để lại log.
- Log mang `sourceRequestId`. Xóa log này thì đơn quay về trạng thái "chờ chấm tay".

**Tác động tính công:** đơn chưa chấm tay không ảnh hưởng tính công (vẫn tính trễ, vẫn báo vắng).

**Chấm tay trực tiếp** (không qua đơn): chỉ ADMIN.

**Báo cáo:** cột "Số lần bổ sung công".

## 5. Nhóm cố định và nhóm xoay ca

- `Employee.scheduleType`:
  - `FIXED`: làm theo **mẫu tuần** `WorkPattern` (ca của từng thứ, để trống là nghỉ). Ví dụ: "HC T2–T6 + T7 sáng", "HC T2–T7".
  - `ROTATING`: làm theo lịch tuần `WorkSchedule` **đã đăng ký**.
- **Thứ tự ưu tiên khi xác định ca của một ngày:**
  1. Lịch ngày trong tuần đã đăng ký.
  2. Ngày lễ → nghỉ.
  3. Nhân viên xoay ca mà tuần chưa đăng ký → **"Chưa có lịch"**.
  4. Mẫu tuần.
  5. Ca mặc định, nghỉ Chủ nhật.
- **"Chưa có lịch":**
  - không báo vắng, không tính trễ; mọi lần quét vẫn được lưu;
  - HR nhận thông báo; dashboard có danh sách riêng;
  - khi tuần được đăng ký thì công tự tính lại.
- **Hiệu lực theo ngày:** các thay đổi sau chỉ áp dụng từ hôm nay, công đã qua không bị tính lại (lưu lịch sử trong `ScheduleAssignment`):
  - mẫu tuần, loại lịch, phòng ban, ca mặc định của nhân viên;
  - sửa ca theo thứ của mẫu tuần.

  Khi chuyển phòng, lịch tương lai do phòng cũ xếp bị hủy.
- **OT ngày không có ca:** OT = phần giao giữa đơn tăng ca đã duyệt và khoảng có mặt, làm tròn xuống. Không có đơn thì bằng 0.

## 6. Đăng ký và khóa ca tuần

Áp dụng cho các phòng có nhân viên xoay ca.

- `RosterWeek (departmentId, weekStart)` có hai trạng thái DRAFT / REGISTERED. Bản nháp không bao giờ được tính công.
- **Quản lý:** xếp và đăng ký tuần của phòng mình, chỉ khi tuần **chưa bắt đầu** (trước 00:00 thứ Hai) và còn là nháp.
- **HR/ADMIN:** xếp và đăng ký mọi lúc.
  - Sửa tuần đã đăng ký thì bắt buộc có lý do; hệ thống ghi AuditLog (trước/sau), gửi tin nhóm Zalo và tính lại các ngày đã qua.
  - Đăng ký muộn thì công tự tính lại.
- **Nhắc hạn:**
  - Thứ Sáu 15:00: nhắc quản lý các phòng chưa đăng ký tuần sau.
  - Thứ Hai 07:00: báo HR và nhóm Zalo các phòng chưa đăng ký tuần này.
- Lịch sử thay đổi xem ở tab riêng trên trang xếp ca.

## 7. Nhóm Zalo minh bạch

- ID nhóm lưu ở `AppSetting zaloGroupId`, do ADMIN nhập.
- **Gửi vào nhóm:** mọi thao tác duyệt/sửa của HR và ADMIN:
  - đơn: duyệt, chấm tay;
  - nhân viên, khuôn mặt, mật khẩu;
  - đăng ký/sửa ca;
  - phân quyền, mẫu tuần, phòng ban.
- **Không gửi:** lần quét chấm công, và thao tác ngang quyền nhân viên (HR tự tạo hay hủy đơn của mình).
- Endpoint gửi tin nhóm GMF cần được xác minh trước khi chạy thật.
