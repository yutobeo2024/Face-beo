# Face Beo

Hệ thống quản trị nhân sự, xếp ca, chấm công khuôn mặt trên tablet kiosk và thông báo Zalo OA cho khoảng 100 nhân viên. Đặc tả đầy đủ: [`docs/PRD-v2-Face-Beo.md`](docs/PRD-v2-Face-Beo.md).

**Stack:** Next.js 15 (App Router) + TypeScript · TailwindCSS v4 · SQLite (WAL) + Prisma · `@vladmandic/human` · `jose` + `bcryptjs` · `zod` · `luxon` · `node-cron` · `xlsx` · `vitest`.

## Cài đặt nhanh

Yêu cầu Node.js ≥ 20.

```bash
npm install                 # postinstall: prisma generate + chép mô hình Human vào public/models
cp .env.example .env        # rồi đổi SESSION_SECRET, BIOMETRIC_KEY, CRON_SECRET
npx prisma migrate deploy   # tạo data/facebeo.db
npm run db:seed             # dữ liệu mẫu (xóa và tạo lại dữ liệu nghiệp vụ)
npm run dev                 # http://localhost:3000
```

Tạo bí mật ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`BIOMETRIC_KEY` phải là **32 byte dạng hex (64 ký tự)**. Mất khóa này thì mọi mẫu khuôn mặt không giải mã được và phải enroll lại.

## Tài khoản seed

Mật khẩu của các tài khoản **seed (dữ liệu mẫu)** là `123456`, và hệ thống **bắt buộc đổi mật khẩu ở lần đăng nhập đầu**. Có thể đăng nhập bằng mã nhân viên hoặc số điện thoại.
Tài khoản tạo trên giao diện **không** có mật khẩu mặc định: nếu không nhập, hệ thống sinh mật khẩu tạm ngẫu nhiên và chỉ hiện một lần cho người tạo.
Không dùng seed để khởi tạo dữ liệu vận hành thật (hoặc đổi ngay mật khẩu NV001).

| Mã | Họ tên | Vai trò | Phòng | SĐT |
| --- | --- | --- | --- | --- |
| NV001 | Nguyễn Văn An | ADMIN | Hành chính | 0901000001 |
| NV002 | Trần Thị Bích | MANAGER | Hành chính | 0901000002 |
| NV003 | Lê Hoàng Cường | MANAGER | Kinh doanh | 0901000003 |
| NV004 | Phạm Minh Dũng | MANAGER | Kỹ thuật | 0901000004 |
| NV005 | Hoàng Thu Hà | MANAGER | Kho vận | 0901000005 |
| NV006 | Vũ Đức Hải | MANAGER | Chăm sóc khách hàng | 0901000006 |
| NV007–NV009 | … | EMPLOYEE (ca cố định) | | 0901000007–09 |
| NV010–NV015 | … | EMPLOYEE (xoay ca, tuần này + tuần sau đã đăng ký) | | 0901000010–15 |
| NV016 | Lê Thị Nhân Sự | HR | Hành chính | 0901000016 |

Seed còn tạo 4 ca (Hành chính 08:00–17:00, Sáng sớm 07:00–17:00, Ca đêm 22:00–06:00, Sáng thứ Bảy 08:00–12:00), 3 mẫu tuần (HC T2–T6 + T7 sáng, HC T2–T7, Sáng sớm T2–T7), ma trận phân quyền mặc định, 2 ngày lễ, 3 đơn mẫu (mỗi trạng thái một đơn), log chấm công MANUAL cho 5 ngày làm việc gần nhất, và 1 kiosk mẫu kèm mã ghép in ra console. Seed **không** tạo khuôn mặt: khuôn mặt phải được enroll thật.

## Phân hệ

| Đường dẫn | Quyền cần có | Nội dung |
| --- | --- | --- |
| `/login` | Tất cả | Đăng nhập, đổi mật khẩu lần đầu. Khóa 15 phút sau 5 lần sai |
| `/admin` | `dashboard.view` | Dashboard hôm nay, cảnh báo phòng chưa đăng ký ca, danh sách "Chưa có lịch" |
| `/admin/roster` | `roster.view` / `roster.edit` | Xếp ca tuần nhóm xoay ca, đăng ký tuần, lịch sử thay đổi |
| `/admin/requests` | `requests.decide` | Duyệt đơn; tab "Chờ chấm tay" (`attendance.executeCorrection`) |
| `/admin/attendance` | `attendance.view` | Log theo ngày, snapshot, chấm tay trực tiếp (`attendance.manualDirect`, chỉ ADMIN) |
| `/admin/reports` | `reports.view` | Bảng công tổng hợp, xuất Excel: bảng công (`/api/reports/attendance.xlsx`) và ma trận giờ vào/ra theo ngày (`/api/reports/inout.xlsx`, v1.5.2) |
| `/admin/employees` | `employees.view` / `employees.manage` | Nhân viên, loại lịch + mẫu tuần, enroll khuôn mặt (`faces.enroll`) |
| `/admin/devices` | 🔒 ADMIN | Ghép / thu hồi kiosk |
| `/admin/settings` | 🔒 ADMIN / `org.manage` | Ca, mẫu tuần, ngày lễ, phòng ban, ngưỡng, ID nhóm Zalo |
| `/admin/settings/permissions` | 🔒 ADMIN | Ma trận phân quyền |
| `/admin/links` | `links.manage` (HR mặc định; Quản lý nếu được cấp, giới hạn theo phòng) | Liên kết nhanh của mục "Thông tin": thêm/sửa/ẩn, chọn icon, giới hạn vai trò + phòng ban được xem (v1.5.0) |
| `/me`, `/me/requests`, `/me/attendance`, `/me/zalo`, `/me/info`, `/me/password` | Mọi người đăng nhập | Lịch tuần, đơn của tôi (nghỉ, về sớm, tăng ca, bổ sung công), lịch sử công, liên kết Zalo, mục Thông tin (ô liên kết web app / Google Sheet / Drive), đổi mật khẩu |
| `/kiosk`, `/kiosk/pair`, `/kiosk/benchmark` | Thiết bị đã ghép | Chấm công, ghép thiết bị, đo hiệu năng |

### Vai trò và ma trận phân quyền

Có 4 vai trò: **Quản trị (ADMIN)**, **Nhân sự (HR)**, **Quản lý (MANAGER)**, **Nhân viên (EMPLOYEE)**.

Quyền của từng vai trò lưu trong bảng `RolePermission`. ADMIN bật/tắt ở **Cấu hình → Phân quyền**; mỗi lần lưu phải nhập lý do, hệ thống ghi AuditLog và gửi tin vào nhóm Zalo. Danh mục quyền và ma trận mặc định nằm trong `src/lib/permissions.ts`.

Các luật khóa cứng trong code (ma trận không đổi được):
- ADMIN luôn có mọi quyền.
- Cấu hình hệ thống, thiết bị, phân quyền và gán vai trò HR/ADMIN chỉ thuộc ADMIN.
- Không ai tự duyệt đơn của mình, tự chấm tay đơn của mình hay tự đổi vai trò của mình. HR không sửa được tài khoản HR/ADMIN.
- **Phạm vi dữ liệu:** ADMIN/HR thấy toàn công ty, MANAGER chỉ thấy phòng mình quản lý (`Department.managerId`), nhân viên chỉ thấy dữ liệu của mình. Mọi API đều kiểm tra lại ở server.

### Tuyến duyệt đơn

| Người tạo đơn | Người duyệt |
| --- | --- |
| Nhân viên | Quản lý phòng; không có quản lý thì HR; không có HR thì ADMIN |
| Quản lý | HR (không có HR thì ADMIN) |
| HR | ADMIN |
| ADMIN | ADMIN khác, không có thì HR |

**Đơn bổ sung công** (quên chấm vào/ra, trong vòng 3 ngày) đi qua hai bước:
1. **Duyệt** theo tuyến trên. HR luôn nhận thông báo khi đơn được tạo.
2. **Chấm tay** do HR thực hiện; đơn của chính HR thì ADMIN thực hiện.
   - Có thể chỉnh giờ tối đa 60 phút trong cùng ngày công, nhưng phải kèm ghi chú.
   - Log MANUAL tạo ra có `sourceRequestId`.
   - Đơn chưa chấm tay không ảnh hưởng tính công.

Chỉ ADMIN chấm tay trực tiếp được (không qua đơn), dùng cho trường hợp khẩn cấp.

### Ngày công, nửa ngày phép và chốt công tháng (v1.2)

- **Hệ số công:** mỗi ca có hệ số công chung (mặc định 1). Quản trị đặt hệ số riêng theo phòng ở **Cấu hình → Ca**, ví dụ Hành chính: Sáng thứ Bảy = 0.5.
- **Nửa ngày phép:** đi làm nửa ngày, nửa còn lại nghỉ phép đã duyệt thì được 0.5 công + 0.5 phép. Đơn về sớm không trừ công.
- **Giờ bắt đầu nghỉ** của ca: giờ công chỉ trừ phần giờ nghỉ mà nhân viên có mặt. Ví dụ vào 13:00, ra 17:00 được 4 giờ.
- **Chốt công tháng** ở trang Báo cáo:
  - HR hoặc Quản trị chốt tháng đã kết thúc. Bảng công tháng đó được giữ nguyên và mọi thao tác làm đổi công bị chặn.
  - Chỉ Quản trị mở khóa, kèm lý do.
  - Excel của tháng đã chốt có sheet "Ghi chú".
- Chi tiết: `docs/PRD-v2.1-HR.md` mục 8–10.

### Nhóm cố định, xoay ca và đăng ký ca tuần

- **Ca cố định (`scheduleType = FIXED`):** chấm công theo **mẫu tuần** (ca của từng thứ; để trống là ngày nghỉ). Không cần xếp ca hằng tuần. Mẫu tuần do ADMIN quản lý ở Cấu hình.
- **Xoay ca (`ROTATING`):** phải có lịch tuần **đã đăng ký**. Bản nháp không bao giờ được tính công.
  - Tuần chưa đăng ký thì trạng thái là **"Chưa có lịch"**: không báo vắng, mọi lần quét vẫn được lưu, và HR nhận thông báo.
  - Khi tuần được đăng ký, công các ngày đã qua tự tính lại.
- **Quản lý** chỉ xếp và đăng ký tuần **chưa bắt đầu** (trước 00:00 thứ Hai) của phòng mình.
- **Sau khi đăng ký**, hoặc khi tuần đã bắt đầu, chỉ HR/ADMIN sửa được. Sửa tuần đã đăng ký bắt buộc có lý do; hệ thống ghi AuditLog, gửi tin vào nhóm Zalo, và xem lại được ở tab "Lịch sử thay đổi".
- Ngày không có ca (mẫu nghỉ, Chủ nhật, ngày lễ) mà có đơn tăng ca đã duyệt thì OT = phần giao giữa đơn và thời gian có mặt.
- **Hiệu lực theo ngày:** đổi mẫu tuần, loại lịch, phòng ban hay ca mặc định của nhân viên, hoặc sửa ca theo thứ của một mẫu tuần, chỉ áp dụng **từ hôm nay**. Công các ngày đã qua giữ nguyên (bảng `ScheduleAssignment`). Khi chuyển phòng, lịch tương lai do phòng cũ xếp sẽ bị hủy.

## Ghép kiosk

1. ADMIN vào **Thiết bị kiosk → Thêm thiết bị**. Hệ thống sinh mã 6 số, hạn 10 phút.
2. Trên tablet (Chrome, Android 11+), mở `https://<máy-chủ>/kiosk/pair` và nhập mã. Token thiết bị được lưu trong cookie httpOnly; server chỉ lưu mã băm SHA-256.
3. Kiosk tự chuyển sang `/kiosk`. Bấm **Toàn màn hình** để khóa xoay ngang. Kiosk dùng Wake Lock để giữ màn hình sáng. Có thể “Thêm vào màn hình chính” để chạy như PWA.
4. Muốn đổi hoặc mất tablet: bấm **Thu hồi**. Token cũ bị từ chối ngay (401).

**Camera cần HTTPS**, trừ khi chạy trên `localhost`.

### Mô hình nhận diện (v1.3 — bắt buộc)

Nhận diện danh tính chạy **trên server** bằng InsightFace (ArcFace, giấy phép MIT) qua onnxruntime. Kiosk và trang enroll chỉ phát hiện mặt,
chấm liveness và gửi ảnh chụp + 5 điểm mốc (mắt, mũi, khóe miệng); server căn chỉnh mặt về 112×112, tính vector 512 chiều và so khớp.

```bash
npm run models:face          # buffalo_l -> models/w600k_r50.onnx (~170 MB, ResNet50, mặc định — chính xác nhất)
npm run models:face -- mbf   # buffalo_sc -> models/w600k_mbf.onnx (~13 MB, MobileFaceNet, cho máy chủ yếu; đặt FACE_EMBED_MODEL=mbf)
```

Script tải từ bản phát hành chính thức trên GitHub của InsightFace và kiểm tra SHA-256. Thiếu mô hình thì kiosk báo 503 và Cấu hình hiện cảnh báo.
**Đổi mô hình (r50 ↔ mbf) là đổi phiên bản template => phải enroll lại toàn bộ.** Khi deploy bản mới, kiosk đang mở tự tải lại trang (so
phiên bản API qua ping). Reverse proxy phải cho body ≥ 8 MB (enroll gửi 5 ảnh): Nginx `client_max_body_size 8m`, Caddy `request_body { max_size 8MB }`. Mỗi lần quét mất ~80–130 ms trên CPU (R50).

Vì sao đổi: mô hình `faceres` của Human (chạy trên tablet) không tách được người có nét giống nhau — trên dữ liệu thật của công ty nó nhận nhầm
2/16 ảnh và từ chối 14 lượt quét; InsightFace R50 trên cùng dữ liệu: 0 nhầm (cùng người ≥ 0.51, khác người ≤ 0.35).
Ngưỡng mặc định mới: khớp 0.45, chênh lệch top-1/top-2 0.08 (Cấu hình → Ngưỡng).

### Enroll khuôn mặt

Vào **Nhân viên → Enroll khuôn mặt**, trên máy có webcam hoặc trên tablet:

1. Nhân viên đọc văn bản đồng ý và tự tick. Hệ thống ghi `biometricConsentAt`.
2. Chụp tự động 5 góc: thẳng, trái, phải, ngẩng, cúi. Mỗi mẫu phải qua cổng chất lượng: đúng 1 mặt, mặt rộng ≥ 200 px, đủ sáng, không nhòe.
3. Chỉ embedding được gửi lên server và được mã hóa AES-256-GCM. Hệ thống không lưu ảnh enroll. Nếu mặt trùng với nhân viên khác, hệ thống cảnh báo và ghi AuditLog.

Nhân viên có thể tự rút đồng ý ở `/me`. Khi đó mẫu khuôn mặt bị xóa ngay và nhân viên chuyển sang chấm công thủ công.

### Chống giả mạo

- **L1 (bắt buộc):** mô-đun `antispoof` và `liveness` của Human chấm trên 5 khung. Server tự tính điểm trung bình, so với `livenessThreshold` và tự đặt `verified3D`. Mọi cờ boolean từ client bị bỏ qua. Tọa độ Z của mesh chỉ được ghi log (`meshFlatness`), không dùng để quyết định.
- **L2 (khuyến nghị trước khi chạy thật, `LIVENESS_SERVER=true`):** server chạy lại **MiniFASNetV2** (Silent-Face-Anti-Spoofing, Apache-2.0) bằng `onnxruntime-node` trên vùng mặt cắt từ snapshot, xem `src/lib/liveness-l2.ts`. Xem thêm mục [Bật lớp L2](#bật-lớp-l2-chống-giả-mạo-phía-server).
- **Giới hạn:** camera RGB thường không chặn được 100% video phát lại chất lượng cao. Bù lại, hệ thống lưu snapshot, có mục **Quét đáng ngờ**, và nên đặt kiosk ở nơi có người qua lại.

### Bật lớp L2 chống giả mạo phía server

```bash
npm run models:liveness      # tải models/MiniFASNetV2.onnx (1,7 MB) và kiểm tra SHA-256
# trong .env:
LIVENESS_SERVER=true
# LIVENESS_MODEL_PATH=...    # tùy chọn, mặc định models/MiniFASNetV2.onnx
npm run build && npm start   # log khởi động: "[boot] L2 liveness sẵn sàng: … (input 80×80)"
```

Cách hoạt động:

- Kiosk gửi kèm snapshot JPEG và khung mặt `faceBox` (toạ độ pixel của snapshot).
- Server cắt vùng quanh khung mặt với hệ số 2,7, resize bilinear **khớp `cv2.resize`**, đưa vào mô hình theo thứ tự màu BGR, giá trị 0–255. Mô hình trả 3 lớp và lấy xác suất lớp 1 (“mặt thật”). Mỗi lượt mất khoảng 10–15 ms trên CPU.
- Pipeline Node được đối chiếu với mã tham chiếu Python (onnxruntime + OpenCV): sai lệch xác suất < 0,002. Test hồi quy nằm trong `tests/unit/liveness-l2.test.ts`.
- Lần quét chỉ được nhận khi **cả L1 và L2 cùng đạt**. Ngưỡng L2 chỉnh ở **Cấu hình → Ngưỡng liveness L2** (mặc định 0,5). Điểm `livenessScore` lưu vào log là điểm thấp hơn trong hai lớp.
- Khi L2 bật, request thiếu snapshot hoặc `faceBox` bị **từ chối**, để client không thể né L2 bằng cách bỏ trống dữ liệu.
- Nếu mô hình lỗi hoặc thiếu (sự cố phía server), hệ thống tạm dùng L1 để không làm tê liệt chấm công, ghi AuditLog `LIVENESS_L2_UNAVAILABLE`, và dashboard ADMIN hiện cảnh báo đỏ.
- **Hiệu chỉnh:** trong giai đoạn pilot, xem điểm L2 của các lần bị từ chối ở **Chấm công → Quét đáng ngờ** (lưu trong chi tiết AuditLog). Kết hợp với bài thử ảnh in / điện thoại / video để chọn ngưỡng. MiniFASNet được huấn luyện trên dữ liệu công khai, nên độ chính xác thực tế phụ thuộc camera và ánh sáng của tablet; hãy đo trên thiết bị thật trước khi tin vào con số.

### Offline

Khi mất mạng, kiosk lưu embedding, điểm liveness, snapshot và `capturedAt` vào IndexedDB và báo “Đã ghi nhận, sẽ xác nhận khi có mạng”. Khi có mạng lại, kiosk gửi tuần tự. Server chấp nhận bản ghi trong vòng 24 giờ và chống ghi trùng bằng `clientEventId`.

### Benchmark

Mở `/kiosk/benchmark` trên tablet thật và bấm **Bắt đầu 50 lượt**. Trang hiển thị p50, p95 và max. Mục tiêu p95 ≤ 1,5 giây.

## Cấu hình Zalo OA

Tài liệu đầy đủ (sơ đồ cho người không kỹ thuật, 13 loại tin, job nền, cài đặt, xử lý sự cố, tham chiếu mã/API, link tài liệu Zalo):
[`docs/zalo-oa.html`](docs/zalo-oa.html).

Thiếu `ZALO_OA_APP_ID`, `ZALO_OA_SECRET` hoặc chưa có token thì hệ thống chạy ở **chế độ mô phỏng**: tin nhắn in ra console và ghi
`NotificationLog` với trạng thái `SIMULATED`. Trạng thái hiện tại xem ở **Cấu hình → Zalo OA** (chỉ Quản trị).

### Giai đoạn 1 (v1.4): nhóm minh bạch

Mọi thao tác duyệt/sửa của Nhân sự và Quản trị (đơn, chấm tay, nhân viên, khuôn mặt, ca, chốt công…) và báo cáo của hệ thống được gửi vào
**một nhóm chat GMF do OA quản lý** — miễn phí, gửi 24/7. Tin nhắn cá nhân tới nhân viên để giai đoạn sau (xem `docs/OPEN-DECISIONS.md` D4).

Điều kiện: OA đã xác thực và đang dùng gói dịch vụ OA (để có tính năng Nhóm chat GMF); ứng dụng trên developers.zalo.me đã liên kết OA.

**Các bước làm thật** (không cần lập trình):
1. Tạo nhóm GMF trong OA Manager (Chat → tạo nhóm → chọn loại GMF-10/50/100), thêm Quản trị/HR vào nhóm.
2. Trên developers.zalo.me → ứng dụng → **Official Account → cấp quyền**: chọn OA và bật ít nhất *Quyền: Gửi tin nhắn*, *Quản lý thông tin OA*,
   *Quản lý Nhóm Chat - GMF*. Lấy **App ID** và **Secret key** ở phần Cài đặt.
3. **Lấy token lần đầu** bằng công cụ **API Explorer** (developers.zalo.me/tools/explorer → "Lấy Access Token", Version 4, chọn ứng dụng và OA):
   sao chép *Access token* và *Refresh token*. Access token hiệu lực 25 giờ, refresh token 3 tháng và **chỉ dùng được một lần**; hệ thống tự refresh
   và lưu cặp mới vào bảng `ZaloToken` — không chép lại giá trị cũ vào `.env`.
4. Điền `.env`: `ZALO_OA_APP_ID`, `ZALO_OA_SECRET`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_OA_REFRESH_TOKEN` (hai token chỉ dùng để khởi tạo DB),
   `ZALO_OA_NAME` (tên hiển thị), `APP_BASE_URL` (địa chỉ mà link trong tin nhắn trỏ tới). Khởi động lại server.
5. Vào **Cấu hình → Zalo OA**: thấy "Đang gửi thật · OA <tên>". Chọn nhóm trong danh sách *Nhóm đã dò* (nếu đã bật webhook, nhóm tạo mới tự
   xuất hiện) hoặc dán ID nhóm, bấm **Kết nối** — hệ thống kiểm tra nhóm đang `enabled` rồi gửi một tin xác nhận vào nhóm. Có thể bấm thêm **Gửi tin thử vào nhóm**. Thẻ này cũng hiện trạng thái nhóm (`enabled` = OA gửi được) và
   10 tin gần nhất kèm mã lỗi.

API đã đối chiếu tài liệu (19/09/2026): `POST https://openapi.zalo.me/v3.0/oa/group/message` body `{recipient:{group_id}, message:{text}}`;
`GET /v3.0/oa/group/getgroup?group_id=`; refresh `POST https://oauth.zaloapp.com/v4/oa/access_token` (form, header `secret_key`).
Mã lỗi tạm thời (quá nhiều request) được thử lại tối đa 3 lần; lỗi cấu hình (sai group_id, thiếu quyền) ghi `FAILED` kèm mã, không thử lại.

### Webhook và Cloudflare Tunnel (chuẩn bị cho liên kết nhân viên)

Webhook `POST /api/zalo/webhook` nhận sự kiện `user_send_text` để nhân viên nhắn mã 6 ký tự (tạo ở `/me/zalo`) và liên kết Zalo.
Chữ ký `X-ZEvent-Signature = mac=sha256(appId + body + timestamp + OAsecretKey)` với secret lấy ở phần Webhook của ứng dụng → `ZALO_WEBHOOK_SECRET`.
Sự kiện `create_group` (OA vừa tạo nhóm GMF) được lưu lại để **Cấu hình → Zalo OA** hiện nhóm đó kèm nút *Kết nối* — không cần tìm ID nhóm bằng tay. Các sự kiện khác (`oa_send_text`, `user_received_message`…) được trả 200 và bỏ qua.

Zalo chỉ gọi webhook tới **HTTPS công khai**. Máy chủ trong LAN có thể dùng Cloudflare Tunnel (miễn phí, không mở port):
```bash
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000     # in ra https://<ngẫu-nhiên>.trycloudflare.com (đổi mỗi lần chạy — dùng để test)
```
Có tên miền riêng thì tạo tunnel có tên (`cloudflared tunnel create` + `route dns`) để địa chỉ cố định. Đặt `APP_BASE_URL` bằng địa chỉ đó
và khai báo `https://<host>/api/zalo/webhook` ở developers.zalo.me → Webhook. Webhook có rate limit 120 yêu cầu/phút/IP và **từ chối** khi chưa
đặt `ZALO_WEBHOOK_SECRET` ở môi trường production.

Nếu refresh token thất bại, dashboard ADMIN và Cấu hình → Zalo OA hiện cảnh báo đỏ.

## Job nền

`node-cron` chạy trong tiến trình server (múi giờ Asia/Ho_Chi_Minh). Có thể tắt bằng `DISABLE_CRON=true` và gọi từ cron bên ngoài:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<máy-chủ>/api/cron/absence-check
```

| Job | Lịch | Việc |
| --- | --- | --- |
| `absence-check` | 5 phút | `ABSENT_WARNING` cho từng người vắng + `ABSENT_DIGEST` cho quản lý (chỉ xét ca bắt đầu trong 6 giờ gần nhất) |
| `missing-checkout` | 30 phút | Gắn cờ “thiếu giờ ra” (AuditLog) + nhắc nhân viên làm đơn bổ sung công |
| `roster-reminder` | Thứ Sáu 15:00 | Nhắc quản lý các phòng có nhân viên xoay ca chưa đăng ký ca tuần sau |
| `roster-report` | Thứ Hai 07:00 | Báo HR và nhóm Zalo các phòng chưa đăng ký ca tuần này |
| `request-overdue` | 30 phút | Đơn chờ duyệt / chờ chấm tay quá 24h: nhắc người xử lý; quá 48h: báo Quản trị + nhóm Zalo |
| `zalo-token-refresh` | 6 giờ | Refresh token chủ động |
| `snapshot-cleanup` | 02:00 | Xóa snapshot quá hạn, mã ghép/mã liên kết hết hạn, template của người đã nghỉ việc |
| `db-backup` | 03:00 | `VACUUM INTO data/backups/`, giữ 14 bản |

Mọi job đều idempotent: chạy lại không sinh tin trùng, nhờ ràng buộc unique `NotificationLog.dedupeKey`.

## Kiểm thử

```bash
npm test          # unit (logic chấm công) + tích hợp (API, phân quyền, bổ sung công, đăng ký ca, kiosk, Zalo, Excel) trên data/test.db
npm run test:tz   # chạy unit test dưới TZ=UTC và TZ=Asia/Ho_Chi_Minh
npm run lint && npm run typecheck && npm run build
```

Logic chấm công nằm trọn trong hàm thuần `src/lib/attendance.ts`, không truy cập DB. Các API chỉ nạp dữ liệu qua `src/lib/attendance-service.ts`.

### Bảo mật thư viện phụ thuộc

Chạy `npm audit` trước mỗi lần phát hành. Mục tiêu là **0 lỗ hổng** (đạt ở v1.2.1).

- **Xuất Excel dùng `exceljs`.** Gói `xlsx` trên npm đã ngừng cập nhật và còn lỗ hổng chưa có bản vá.
- **`overrides` trong `package.json`** ép dùng bản đã vá của thư viện gián tiếp, không cần nâng major Next.js hay Prisma:
  - `postcss` (qua Next 15);
  - `deepmerge-ts` (qua `@prisma/config`);
  - `uuid` (qua `exceljs`).

  Khi nâng Next.js, Prisma hoặc exceljs, chạy `npm audit` lại và gỡ override nào không còn cần.
- **Cấu hình Prisma CLI** nằm ở `prisma.config.ts` (thay khóa `prisma` trong `package.json`, sẽ bị bỏ ở Prisma 7). File này tự nạp `.env` nhưng không ghi đè biến môi trường đã có.

## Triển khai

- Chạy trên 1 máy chủ hoặc VPS: `npm run build && npm start`, dưới PM2 hoặc Docker. Cần volume bền cho thư mục `data/` (SQLite, snapshot, bản sao lưu). **Không** dùng nền tảng serverless.
- HTTPS là bắt buộc (camera). Đặt Caddy hoặc Nginx phía trước kèm chứng chỉ Let's Encrypt. Ví dụ Caddyfile:
  ```
  chamcong.congty.vn {
    reverse_proxy localhost:3000
  }
  ```
- Chạy `npx prisma migrate deploy` mỗi lần cập nhật. SQLite được bật `journal_mode=WAL` và `busy_timeout=5000` khi khởi động.
- Cookie session dùng cờ `secure` trong production. Nếu thử nghiệm trong LAN qua HTTP, đặt `INSECURE_COOKIES=true` (không dùng khi chạy thật).
- Mô hình Human được phục vụ từ `public/models` (do `npm install` chép vào). Nếu chép lại mô hình sau khi build, phải khởi động lại `next start`.
- Nên đồng bộ `data/backups/` ra một nơi lưu trữ ngoài máy chủ.
- Khi vượt khoảng 500 nhân viên hoặc cần nhiều máy chủ: đổi `provider` sang `postgresql`.

## Bảo mật và dữ liệu cá nhân

- Chỉ lưu embedding khuôn mặt, mã hóa AES-256-GCM bằng `BIOMETRIC_KEY` (khóa để ngoài DB). Không lưu ảnh enroll.
- Snapshot nằm ở `data/snapshots/YYYY/MM/DD/`, ngoài thư mục `public`, chỉ xem được qua `/api/snapshots/*` (ADMIN hoặc quản lý trực tiếp). Tự xóa sau `snapshotRetentionDays` (mặc định 90 ngày).
- Giới hạn tần suất: đăng nhập 10 lượt/phút/IP; quét kiosk 60 lượt/phút/thiết bị.
- Mọi input đều được validate bằng zod. Log không chứa embedding, token hay mật khẩu.
- Phiên đăng nhập (v1.4.4): JWT mang `sessionVersion`; đổi/đặt lại mật khẩu, đăng xuất và cho nghỉ việc (v1.5.3) thu hồi mọi phiên cũ của tài khoản.
- Nhân viên nghỉ việc: giữ hồ sơ (bảng công, nhật ký), xóa mẫu khuôn mặt ngay. Chỉ xóa hẳn được tài khoản tạo nhầm chưa có lịch sử (v1.5.3).
  Đăng nhập sai trả một thông báo chung, bộ đếm sai tăng nguyên tử, ≥ 5 lần khóa 15 phút. Không có mật khẩu mặc định cho tài khoản mới.
- Liveness L2 (`LIVENESS_SERVER=true`) lỗi thì **từ chối** quét (503) thay vì hạ xuống điểm L1 của kiosk; kiosk giữ hàng đợi và gửi lại.
  Chi tiết rà soát: `docs/SECURITY-AUDIT-79baa01.md`.
- Việc cần làm ngoài code: lập hồ sơ đánh giá tác động xử lý dữ liệu cá nhân theo Luật 91/2025/QH15 và Nghị định 356/2025/NĐ-CP.

## Quyết định còn mở

Xem [`docs/OPEN-DECISIONS.md`](docs/OPEN-DECISIONS.md). Hiện có D1: cách trừ giờ nghỉ khi tính giờ công.

## Nghiệm thu thủ công trên thiết bị thật (PRD mục 10)

- [ ] Enroll 5 người thật, mỗi người quét 10 lần: nhận đúng ≥ 98%, không nhận nhầm.
- [ ] Thử giả mạo bằng ảnh in, ảnh trên điện thoại, video trên tablet (mỗi loại 20 lần), ghi lại tỉ lệ bị từ chối để quyết định có bật L2 hay không.
- [ ] `/kiosk/benchmark` trên tablet tham chiếu đạt p95 ≤ 1,5 giây.
- [ ] Tắt wifi, quét 3 lần, bật lại: cả 3 bản ghi lên server với đúng `capturedAt`.
- [ ] Liên kết Zalo thật cho 1 nhân viên và nhận đủ 4 loại tin.
