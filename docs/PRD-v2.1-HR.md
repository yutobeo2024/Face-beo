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
- **`org.manage` là quyền toàn công ty** (chốt 20/09/2026): ca, ngày lễ, mẫu tuần không thuộc phòng nào nên không giới hạn được theo phòng.
  Giữ quyền này cho Quản trị như mặc định, không cấp cho Quản lý. Các phần có phạm vi phòng (hệ số riêng theo phòng, gán quản lý,
  log chấm công, hệ số ca, lần quét đáng ngờ) đã kiểm tra `assertDept`/`deptScope` từ v1.4.3.

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

## 8. Ngày công, nửa ngày phép, giờ công (v1.2)

**Hệ số công:**
- Mỗi ca có `workDayValue` (hệ số chung, mặc định 1).
- `DepartmentShiftWeight` là hệ số riêng theo phòng, ghi đè hệ số chung. Quản trị cấu hình ở **Cấu hình → Ca**.
- Hệ số của một ngày lấy theo phòng mà nhân viên thuộc về vào đúng ngày đó.

**Ngày công và ngày phép của một ngày:**

| Trường hợp | Ngày công | Ngày phép |
| --- | --- | --- |
| Đi làm (đúng giờ hoặc trễ) | hệ số | 0 |
| Đi làm + đơn nghỉ phép đã duyệt che nửa ngày | hệ số × 0.5 | hệ số × 0.5 |
| Nghỉ phép cả ca | 0 | hệ số |
| Vắng, nhưng có đơn nghỉ phép nửa ngày đã duyệt | 0 | hệ số × 0.5 |
| Vắng | 0 | 0 |
| Làm ngày nghỉ hoặc ngày lễ | 0 (OT tính theo đơn) | 0 |

- **"Nửa ngày"** nghĩa là đơn che ≥ ½ thời gian làm thực của ca (độ dài ca trừ giờ nghỉ), hoặc che trọn một buổi trước hay sau giờ nghỉ trưa.
- Hai đơn sáng và chiều cách nhau đúng giờ nghỉ trưa được coi là nghỉ cả ca.
- Đơn về sớm (VE_SOM) không trừ công.

**Giờ công (D1):**
- Khoảng có mặt được kẹp trong ca.
- Ca có `breakStart` thì chỉ trừ phần giờ nghỉ giao với khoảng có mặt; không có thì trừ đủ `breakMinutes`.
- Nghỉ phép hết buổi sáng rồi vào ca sau giờ nghỉ trưa thì không bị tính trễ (tương tự cho buổi chiều).

## 9. Chốt công tháng (v1.2)

**Chốt:**
- Người có quyền `payroll.lock` (mặc định HR và Quản trị) chốt được một tháng đã kết thúc, từ ngày 2 của tháng sau.
- Hệ thống chụp kết quả từng ngày của mọi nhân viên (`LockedDay`), kể cả người đã nghỉ việc nhưng có log trong tháng.
- Báo cáo, Excel, dashboard và `/me` của tháng đã chốt đều đọc từ bản chụp. Vì vậy sửa ngày lễ, giờ ca, hệ số hay mẫu tuần sau đó không làm lệch bảng công.

**Bị chặn (409) trong tháng đã chốt:**
- xếp ca, đăng ký tuần nằm trọn trong tháng;
- chấm tay, chấm tay theo đơn, xóa log;
- tạo, duyệt, hủy đơn có thời gian thuộc tháng đó;
- quét kiosk gửi bù vào ngày công của tháng đó (lớp bảo vệ cuối).

**Mở khóa:**
- Chỉ Quản trị (`payroll.unlock`, khóa cứng), bắt buộc lý do ≥ 5 ký tự.
- Mở khóa xóa bản chụp; tháng đó tính lại theo dữ liệu hiện tại.
- Chốt và mở khóa đều ghi AuditLog và gửi tin nhóm Zalo.

## 11. Nhận diện khuôn mặt phía server (v1.3)

**Vấn đề:** mô hình `faceres` (Human, chạy trên tablet) cho điểm giống giữa những người khác nhau tới 0.79 — ngang mức cùng một người — nên nhận nhầm
người có nét giống (anh em) và từ chối nhiều lượt quét đúng. Đo trên 16 ảnh chấm công thật: 2 ảnh nhận nhầm, 14 lượt bị từ chối.

**Thay đổi:**
- Kiosk và trang enroll chỉ: phát hiện mặt (BlazeFace), facemesh, liveness L1; gửi **snapshot + 5 điểm mốc** (mắt trái, mắt phải, mũi, khóe miệng trái/phải) theo pixel của snapshot. Không còn embedding trên máy.
- Server (`src/lib/face-embed.ts`): căn chỉnh mặt theo mẫu ArcFace 112×112 (phép tương tự từ 5 điểm), chuẩn hóa (x−127.5)/127.5, chạy InsightFace
  `w600k_r50` (mặc định) hoặc `w600k_mbf` bằng onnxruntime → vector 512 chiều chuẩn hóa L2. Ảnh enroll không được lưu.
- Phiên bản template: `insightface-w600k_r50-v1` / `insightface-w600k_mbf-v1`. Template phiên bản khác bị bỏ qua → danh sách nhân viên hiện "Enroll lại".
- Ngưỡng mặc định: khớp 0.45, chênh lệch top-1/top-2 0.08 (đo được: cùng người ≥ 0.51, anh em ≤ 0.35).
- Enroll: 5 mẫu phải giống nhau (cosine ≥ 0.4, chống lẫn người khác vào khung); giống nhân viên khác ≥ ngưỡng thì cảnh báo, ≥ 0.65 thì
  **chỉ Quản trị** mới được ghi đè.
- Hồi chiêu ở kiosk theo vị trí khung mặt thay cho embedding: thoát khi mặt biến mất 8 khung, hoặc có mặt ở vị trí khác hẳn 3 khung.
- Thiếu mô hình: kiosk trả 503 "máy chủ chưa sẵn sàng", Cấu hình hiện cảnh báo, log boot báo rõ.

## 10. Nhắc đơn quá hạn (v1.2)

Job `request-overdue` chạy mỗi 30 phút.

- **Đơn chờ duyệt** (tính từ lúc tạo) và **đơn bổ sung công chờ chấm tay** (tính từ lúc duyệt):
  - quá 24 giờ: nhắc người phải xử lý;
  - quá 48 giờ: báo mọi Quản trị và nhóm Zalo.
- Mỗi mốc chỉ gửi một lần. Đơn quá 60 ngày thì bỏ qua.
- Không bao giờ tự duyệt.
- Dashboard hiện số đơn quá hạn mà người xem có quyền xử lý.

## 12. Phiên đăng nhập, mật khẩu, liveness (v1.4.4 — theo rà soát bảo mật 20/09/2026)

- **Không có mật khẩu mặc định.** Tạo tài khoản không kèm mật khẩu thì hệ thống sinh mật khẩu tạm ngẫu nhiên, trả về một lần cho người tạo.
- **Tự đổi mật khẩu** ở `/me/password` (mọi vai trò, cần mật khẩu hiện tại). Quên mật khẩu: Nhân sự đặt lại trong hồ sơ → mật khẩu tạm.
- **Thu hồi phiên.** `Employee.sessionVersion` được ghi vào JWT; đổi mật khẩu, đặt lại mật khẩu, và **đăng xuất** đều tăng số này nên mọi
  phiên cũ (kể cả cookie bị sao chép) hết hiệu lực ngay. Đăng xuất một nơi = thoát mọi thiết bị.
- **Đăng nhập.** Sai tài khoản và sai mật khẩu trả cùng một thông báo; bộ đếm sai được tăng nguyên tử trong DB, ≥ 5 lần khóa 15 phút.
- **Ảnh quét bị từ chối** (không gắn log, không rõ phòng) chỉ người có phạm vi toàn công ty và quyền `suspicious.view` xem được.
- **Liveness L2 lỗi = từ chối** (fail-closed): kiosk nhận 503, giữ lần quét trong hàng đợi (không đếm lần thử) và gửi lại khi mô hình
  chạy; Quản trị được cảnh báo. L2 tắt bằng cấu hình thì chỉ dùng L1 — vận hành thật phải bật `LIVENESS_SERVER=true`.

## 13. Mục "Thông tin" — thư viện liên kết (v1.5.0, 20/09/2026)

- **Mục đích.** Trang cá nhân có mục **Thông tin** (`/me/info`): lưới ô liên kết đều nhau, bo tròn, mở tab mới — trỏ tới web app
  nội bộ cũ, Google Sheet chia sẻ, thư mục Drive, Google Docs… Mỗi ô có icon (chọn từ bộ icon nội bộ) và màu.
- **Ai quản lý.** Quyền mới `links.manage` (nhóm Tổ chức): Quản trị luôn có, Nhân sự có mặc định. Quản lý chỉ có khi Quản trị cấp trong
  Phân quyền; khi đó **chỉ tạo/sửa/xóa được liên kết gắn với phòng mình phụ trách** (bắt buộc chọn ≥ 1 phòng, mọi phòng đều trong
  phạm vi). Liên kết toàn công ty (không chọn phòng) chỉ Nhân sự / Quản trị thao tác được. Trang quản trị: `/admin/links`.
- **Ai được thấy.** Mỗi liên kết có hai bộ lọc: *vai trò được xem* và *phòng ban được xem*; để trống = tất cả. Nhân viên thấy liên kết
  khi đang bật **và** (vai trò khớp hoặc trống) **và** (phòng khớp hoặc trống). Ví dụ "Bảng KPI Kinh doanh" chọn vai trò Quản lý +
  phòng Kinh doanh → chỉ quản lý phòng Kinh doanh thấy; Nhân sự ở phòng Hành chính không thuộc diện xem (luật giao).
  Riêng người có `links.manage` thấy thêm mọi liên kết đang bật trong phạm vi mình quản lý (để kiểm tra cấu hình), ô không thuộc
  diện của họ mang nhãn "Chỉ: <vai trò> · <phòng>".
- **Ẩn thay vì xóa.** Bỏ tích "Đang hiển thị" để tạm ẩn; xóa thì mất hẳn. Mọi thao tác ghi audit `INFOLINK_UPDATE` và báo vào nhóm
  Zalo minh bạch (với HR/Quản trị).
- **An toàn.** Chỉ nhận URL `http(s)://`; icon và màu phải thuộc danh sách cho phép; mở bằng `rel="noopener noreferrer"`.
- **Dữ liệu.** Bảng `InfoLink` (SQLite), hai cột JSON `visibleRoles`, `visibleDeptIds`; lọc trong ứng dụng (≤ vài chục dòng).

## 14. Sửa / xóa cấu hình tổ chức (v1.5.1, 20/09/2026)

Trang Cấu hình có đủ sửa/xóa cho ca, mẫu tuần, phòng ban, ngày lễ. Nguyên tắc chung: **không xóa thứ đã đi vào lịch sử công**;
server là chốt chặn (400 kèm lý do), nút trên UI chỉ mờ đi để gợi ý.

| Đối tượng | Sửa | Xóa được khi | Khi bị chặn thì |
|---|---|---|---|
| Ca làm việc | giờ, nghỉ, ân hạn, hệ số (áp dụng cho tháng chưa chốt) | chưa ai dùng: không nhân viên (ca mặc định), mẫu tuần, lịch tuần, log chấm công, lịch sử phân công nào tham chiếu; hệ số riêng theo phòng của ca được xóa kèm | đổi tên "… (ngừng dùng)" |
| Mẫu tuần | tên, ca theo thứ (hiệu lực từ hôm nay) | không nhân viên **đang làm** dùng; người đã nghỉ còn trỏ tới mẫu được gỡ liên kết (lịch sử đã snapshot trong `ScheduleAssignment`) | đổi mẫu cho nhân viên trong hồ sơ trước |
| Phòng ban | đổi tên (chỉ nhãn; phạm vi, lịch, số liệu chốt theo `id` không đổi); gán/gỡ quản lý | phòng trống hoàn toàn: không nhân viên kể cả đã nghỉ (`departmentId` bắt buộc), không tuần đã đăng ký, không lịch sử phân công, không ngày đã chốt; hệ số riêng bị xóa; liên kết "Thông tin" gắn phòng được gỡ phòng, thành rỗng thì tạm ẩn | chuyển nhân viên sang phòng khác hoặc đổi tên |
| Ngày lễ | tên (chỉ hiển thị) hoặc ngày (khóa chính → xóa + tạo trong một giao dịch) | luôn xóa được | — |

Đổi **ngày** của ngày lễ (hoặc thêm/xóa ngày lễ) thay đổi cách tính công của tháng *chưa chốt* ở ngày cũ (thành ngày làm, có thể
phát sinh vắng) và ngày mới (thành nghỉ lễ). Tháng đã chốt không đổi vì `LockedDay` đã snapshot. Không có bước "tính lại" riêng:
công được tính trực tiếp từ planner. Quản lý được cấp `org.manage` chỉ xóa được phòng trong phạm vi mình (`assertDept`).

## 15. Mẫu Excel "Giờ vào/ra theo ngày" (v1.5.2, 20/09/2026)

- Trang Báo cáo có hai nút xuất, dùng chung khoảng ngày (Từ–Đến, Tháng này, 7 ngày, Tháng trước) và lọc phòng ban:
  **Xuất bảng công** (`BangCong_*.xlsx`, sheet Tổng hợp + Chi tiết, giữ nguyên) và **Xuất giờ vào/ra** (`GioVaoRa_*.xlsx`).
- `GioVaoRa`: sheet "Giờ vào ra" dạng ma trận — dòng = nhân viên (STT, Nhân viên, Bộ phận), cột = từng ngày với 2 cột IN / OUT;
  3 dòng tiêu đề (ngày dd/MM/yyyy, thứ T2…CN, IN/OUT); cột Chủ nhật tô hồng, ngày lễ tô vàng; cố định 3 dòng + 3 cột. Sheet
  "Ghi chú" nêu kỳ, quy ước và tên ngày lễ trong kỳ.
- IN = lần quét đầu tiên trong ngày, OUT = lần quét cuối cùng (`DaySummary.inTime/outTime`); ngày chỉ một lần quét → OUT trống;
  ô trống = không có lần quét. Giờ VN, định dạng 24h `HH:mm`. Log ngoài ca (làm Chủ nhật không lịch) vẫn hiện theo ngày quét.
- Cùng route guard với bảng công: `reports.view`, `employeeScopeWhere` (quản lý chỉ thấy phòng mình, phòng ngoài phạm vi → file
  rỗng), tối đa 62 ngày, danh sách nhân viên và lọc phòng theo ngày dùng chung `listReportEmployees` + `deptOk`; tháng đã chốt lấy
  từ bản chụp như bảng công.

## 16. Xóa tài khoản tạo nhầm; thu hồi phiên khi nghỉ việc (v1.5.3, 20/09/2026)

- **Vì sao trước đây không có nút Xóa nhân viên.** Hồ sơ nhân viên là khóa của log chấm công, đơn từ, lịch tuần (khóa ngoại RESTRICT)
  và của lịch sử phân công, ngày đã chốt công, nhật ký, tin Zalo (không có khóa ngoại). Xóa cứng làm bảng công tháng đã chốt mất tên
  người, nhật ký trỏ vào id không còn, và giải phóng mã NV / SĐT (duy nhất) cho người khác. "Nghỉ việc" (`active=false`) đã đáp ứng
  mọi yêu cầu: ghi `leftAt`, xóa mẫu khuôn mặt ngay (nghĩa vụ xóa dữ liệu sinh trắc), gỡ vai trò quản lý, chặn đăng nhập/kiosk, không
  tính vắng sau ngày nghỉ, vẫn xuất hiện trong báo cáo kỳ có `leftAt`.
- **Nút "Xóa tài khoản"** (hộp Sửa, quyền `employees.manage`, cùng luật chống leo thang với sửa hồ sơ): chỉ xóa được tài khoản
  **chưa có bất kỳ lịch sử nào** — server đếm log chấm công (của họ hoặc do họ chấm tay), đơn từ (gửi/duyệt/thực hiện), ô lịch tuần,
  ngày đã chốt, lần chốt lương, tuần đăng ký ca, liên kết Thông tin, mẫu khuôn mặt enroll cho người khác, thao tác nhật ký, thông báo
  đã gửi; có bất kỳ → 400 kèm danh sách lý do. Xóa được thì dọn: gỡ khỏi quản lý phòng, mã liên kết Zalo, dòng baseline phân công,
  mẫu khuôn mặt, hồ sơ; audit `EMPLOYEE_DELETE`, báo nhóm Zalo. Không tự xóa mình; HR không xóa được HR/ADMIN.
- **Thu hồi phiên khi cho nghỉ việc**: `sessionVersion` tăng cùng lúc đặt `leftAt` — cookie cũ không "sống lại" nếu sau này kích hoạt
  lại tài khoản (tài khoản không active vốn đã bị `loadUser` chặn).

## 17. Khởi tạo vận hành thật: cấu hình nền và Quản trị đầu tiên (v1.5.4, 21/09/2026)

- **Vấn đề.** Trước đây chỉ có `db:seed` (xóa sạch DB rồi tạo 16 nhân viên mẫu, mật khẩu chung 123456, log/đơn mẫu). Muốn có tài
  khoản Quản trị thật phải sửa NV001 rồi cho nghỉ việc các nhân viên mẫu (không xóa được vì đã có log) — dữ liệu mẫu lẫn vào DB thật.
- **`npm run db:seed:base`** (`prisma db seed -- --base`, logic `seedBase` trong `src/lib/bootstrap.ts`): tạo phần còn thiếu của cấu
  hình nền — ca Hành chính 08:00–17:00, Sáng sớm 07:00–17:00, Ca đêm 22:00–06:00, Sáng thứ Bảy 08:00–12:00 (**0.5 công**); mẫu tuần
  "HC T2–T6 + T7 sáng", "HC T2–T7", "Sáng sớm T2–T7"; ngày lễ; ma trận quyền mặc định; cấu hình ngưỡng. Không sửa bản ghi đã có, không xóa
  gì, không tạo phòng ban hay nhân viên → chạy lại bao nhiêu lần cũng được. Từ v1.7.0: mỗi danh mục chỉ tạo khi bảng còn TRỐNG (trước đó so
  theo tên nên từng tạo lại ca "Ca đêm" Quản trị đã xóa); cấu hình ngưỡng vẫn bổ sung theo từng khóa.
- **`npm run admin:create -- --code AD01 --name "…" --phone 09…`** (`scripts/create-admin.ts`): tạo tài khoản ADMIN, loại lịch cố định,
  ca mặc định "Hành chính" (`--shift` để đổi), phòng "Ban quản trị" (`--dept`, chưa có thì tạo). Kiểm tra mã/SĐT như form tạo nhân
  viên; mật khẩu tự đặt (`--password`) phải ≥ 8 ký tự có chữ và số, không đặt thì sinh mật khẩu tạm và **chỉ in một lần** ra màn hình;
  luôn bắt đổi ở lần đăng nhập đầu. Ghi lịch sử phân công gốc và nhật ký `EMPLOYEE_CREATE` (người thực hiện trống, `via: cli`, không
  chứa mật khẩu). **Từ chối khi đã có Quản trị đang hoạt động** — lệnh chỉ dùng để khởi tạo, không thay trang Nhân viên.
- **`--reset <mã>`**: Quản trị quên mật khẩu hoặc bị khóa đăng nhập → mật khẩu tạm mới, xóa đếm sai/khóa, tăng `sessionVersion`
  (mọi phiên cũ hết hiệu lực), nhật ký `PASSWORD_RESET`. Chỉ cho ADMIN **đang hoạt động**; Quản trị đã nghỉ việc không được kích hoạt
  lại qua lệnh này — khi không còn Quản trị nào hoạt động thì tạo tài khoản mới. Người chạy lệnh phải có quyền truy cập máy chủ và DB.
- **Chặn seed demo trên DB thật**: `npm run db:seed` từ chối khi DB đã có nhân viên hoặc ca, ép bằng `npm run db:seed:force` hoặc `SEED_FORCE=1`
  (test tích hợp dùng `--force` cho `data/test.db`). Dữ liệu demo giữ nguyên (ca demo hệ số 1).

## 18. Nhiều nhóm Zalo, mỗi nhóm nhận loại tin riêng (v1.6.0, 21/09/2026)

- **Vấn đề.** Trước đây mọi tin nhóm vào **một** nhóm (`AppSetting.zaloGroupId`) và chỉ gồm thao tác quản trị. Chủ dự án cần thêm nhóm nhân
  viên (vd. "YDSG-NHÂN VIÊN") nhận tin chấm công và đơn từ của nhân viên, nhóm minh bạch cũ giữ nguyên.
- **Loại tin** (`ZaloGroup.categories`, JSON; rỗng = nhóm không nhận tin):
  | Mã | Nội dung | Nguồn |
  |---|---|---|
  | `MINH_BACH` | 25 luồng tin nhóm cũ (`announce()` / `announceSystem()`), luật HR/QT + `always` không đổi | `src/lib/announce.ts` |
  | `CHAM_CONG` | ⏰ chưa chấm giờ vào (sau `absentAfterMinutes`, không đơn — cùng lúc `ABSENT_WARNING`) · 🚪 quên chấm giờ ra (cùng lúc `MISSING_OUT_NUDGE`) · ❌ vắng không phép | `src/lib/jobs.ts` |
  | `DON_TU` | 📝 đã gửi đơn → đang chờ {người duyệt} · ✅/❌ đã duyệt/từ chối bởi {tên} (mọi người duyệt, kể cả Quản lý) · ↩️ tự hủy đơn · 🛠️ bổ sung công đã chấm tay | `src/lib/notify.ts` |
- **Lọc phòng** (`ZaloGroup.departmentIds`; rỗng = mọi phòng): chỉ áp cho `CHAM_CONG`/`DON_TU`, theo phòng hiện tại của nhân viên.
- **Riêng tư**: tin nhóm nhân viên chỉ có tên, mã, phòng, loại đơn, thời gian, trạng thái, người duyệt — **không** lý do xin nghỉ, **không**
  ghi chú duyệt/từ chối (các nội dung đó vẫn gửi riêng cho người liên quan như trước).
- **Vắng không phép** (chỉ để báo nhóm): trong vòng 12 giờ sau giờ kết thúc ca, cả ngày công không có lần quét nào, nhân viên đã enroll, ngày
  có ca (không nghỉ, không lễ, tuần xoay ca đã đăng ký), không có đơn nghỉ phép giao ca và không có đơn bổ sung công trong cửa sổ ca
  (đã duyệt **hoặc đang chờ**). Không đổi dữ liệu công. Người đã nghỉ việc không bị báo nhóm.
- **Khóa dedupe tin nhân viên** luôn là `staff:{sự kiện}:{id}@{groupId}` (thêm/bớt nhóm giữa hai lần chạy job không làm gửi lặp).
- **Gửi ngay từng người**, mỗi sự kiện một tin; chạy lại job không trùng. Tin Minh bạch có kèm lý do/ghi chú nên chỉ tích cho nhóm quản lý.
- **Nâng cấp**: migration chuyển nhóm đang ở `zaloGroupId` thành dòng `ZaloGroup` có `categories=["MINH_BACH"]` — không phải cấu hình lại.
  Chưa nhóm nào tích Minh bạch → tin minh bạch ghi `FAILED` "Chưa cấu hình ID nhóm" như cũ; tin nhân viên không có nhóm → bỏ qua, không ghi.
- **Cấu hình → Zalo OA**: mỗi nhóm tích loại tin + chọn phòng, nút Lưu / Gửi tin thử riêng; ô "Thêm nhóm" nhận **link chat nhóm**
  (`https://oa.zalo.me/chat?gid=…&oaid=…`) và tự tách `gid`; chuỗi toàn số (ID OA) bị từ chối kèm giải thích. Đổi loại tin ghi audit
  `ZALO_GROUP_ROUTING` và báo nhóm minh bạch. Quyền `settings.system` (chỉ Quản trị).
- **Test không gọi Zalo thật**: `tests/setup.ts` chặn @next/env và Prisma Client nạp `.env` của máy (khai báo trước khóa rỗng) — lỗi cũ chỉ lộ
  ra trên máy có `.env` chứa khóa Zalo thật. `TRUSTED_PROXY_HOPS=` để trống giờ được hiểu là mặc định 1.

## 19. Cách duyệt đơn theo phòng; Chức danh & Chuyên khoa (v1.7.0, 21/09/2026)

- **Bối cảnh.** Công ty là phòng khám đa khoa. Phòng ban = đơn vị quản lý ("ai duyệt, ai xếp ca cho ai"); chuyên môn (bác sĩ TMH, KTV siêu
  âm…) là thuộc tính của người. Duyệt đơn ở hầu hết phòng là **trưởng phòng + Nhân sự**; trước đây `approversFor` chỉ trả về quản lý
  phòng nên Nhân sự không duyệt được đơn của phòng có quản lý.
- **`Department.approvalMode`** (chỉ áp cho đơn của Nhân viên trong phòng có quản lý đang làm; đơn của Quản lý/HR/Quản trị giữ tuyến cũ;
  phòng không có quản lý → Nhân sự). **Lưu ý nâng cấp:** mọi phòng có sẵn được gán `MANAGER_OR_HR` — khác trước (chỉ quản lý phòng):
  Nhân sự giờ duyệt được và mọi Nhân sự nhận tin có đơn mới; muốn giữ như cũ thì chọn "Chỉ trưởng phòng". Cách duyệt đổi bằng quyền
  `org.manage` (mặc định chỉ Quản trị; Nhân sự nếu được cấp) và Quản lý không bao giờ tự đổi được:
  | Mã | Luật |
  |---|---|
  | `MANAGER_OR_HR` (mặc định; migration gán cho mọi phòng) | Trưởng phòng **hoặc** Nhân sự duyệt, ai trước có hiệu lực; cả hai nhận `REQUEST_CREATED` |
  | `TWO_STEP` | Trưởng phòng duyệt đơn `PENDING` → `MANAGER_APPROVED` (ghi `managerApproverId/At/Note`, chưa hiệu lực, không tính lại công); Nhân sự duyệt → `APPROVED`. Từ chối ở bước nào cũng `REJECTED`. Nhân sự không duyệt thay bước 1 (403); Quản trị duyệt ở bước nào cũng là quyết định cuối |
  | `MANAGER_ONLY` | Chỉ trưởng phòng (hành vi cũ) |
- **`MANAGER_APPROVED` = đơn còn chờ**: tính như `PENDING` ở mọi nơi (không bị báo vắng / vắng không phép, nhắc trễ bỏ qua, chặn tạo đơn
  trùng, đếm đơn tồn khi chốt công, dashboard, trang cá nhân), hủy được; job quá hạn bước 2 tính giờ từ `managerDecidedAt`, nhắc Nhân sự
  (`req2-overdue24/48`). Tin riêng mới `REQUEST_STAGE2` cho Nhân sự; tin nhóm Đơn từ "☑️ trưởng phòng đã duyệt, chờ HR".
- **Đổi cách duyệt giữa chừng**: đơn đang `MANAGER_APPROVED` vẫn chờ bước cuối; người duyệt bước cuối theo cách duyệt mới của phòng. Gỡ
  quản lý khỏi phòng → đơn chuyển Nhân sự.
- **Chỉ HR xếp ca**: cấu hình bằng Phân quyền (bỏ "Xếp ca" của vai trò Quản lý), không cần code.
- **Chức danh / Chuyên khoa**: bảng `JobTitle`, `Specialty` (tên duy nhất, thứ tự); `Employee.jobTitleId`, `specialtyId` tùy chọn. Quản lý
  danh mục bằng quyền `org.manage`; ai đăng nhập cũng đọc được. Xóa mục đang dùng → nhân viên được để trống. Không ảnh hưởng phân quyền,
  duyệt đơn, lịch (không tạo bản ghi phân công mới). Hiện ở danh sách nhân viên (lọc được), bảng xếp ca, Excel (Bảng công: 2 cột sau Phòng
  ban; Giờ vào ra: cột Chức danh sau Bộ phận). Tháng đã chốt hiển thị chức danh hiện tại (như tên, mã). `db:seed:base` tạo sẵn 12 chức danh
  và 12 chuyên khoa cho phòng khám (chỉ khi danh mục còn trống).
