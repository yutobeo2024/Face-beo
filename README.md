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

Mật khẩu mặc định của tất cả tài khoản là `123456`, và hệ thống **bắt buộc đổi mật khẩu ở lần đăng nhập đầu**. Có thể đăng nhập bằng mã nhân viên hoặc số điện thoại.

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
| `/admin/reports` | `reports.view` | Bảng công tổng hợp, xuất Excel |
| `/admin/employees` | `employees.view` / `employees.manage` | Nhân viên, loại lịch + mẫu tuần, enroll khuôn mặt (`faces.enroll`) |
| `/admin/devices` | 🔒 ADMIN | Ghép / thu hồi kiosk |
| `/admin/settings` | 🔒 ADMIN / `org.manage` | Ca, mẫu tuần, ngày lễ, phòng ban, ngưỡng, ID nhóm Zalo |
| `/admin/settings/permissions` | 🔒 ADMIN | Ma trận phân quyền |
| `/me`, `/me/requests`, `/me/attendance`, `/me/zalo` | Mọi người đăng nhập | Lịch tuần, đơn của tôi (nghỉ, về sớm, tăng ca, bổ sung công), lịch sử công, liên kết Zalo |
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

Thiếu **bất kỳ** biến `ZALO_*` nào thì hệ thống chạy ở **chế độ mô phỏng**: tin nhắn được in ra console trong một khung màu và ghi `NotificationLog` với trạng thái `SIMULATED`/`SKIPPED_NO_ZALO`. Mọi luồng khác vẫn hoạt động.

1. Tạo ứng dụng tại [developers.zalo.me](https://developers.zalo.me) và liên kết với OA. Lấy `ZALO_OA_APP_ID`, `ZALO_OA_SECRET`.
2. Cấp quyền OA để lấy cặp access token / refresh token ban đầu, rồi điền `ZALO_OA_ACCESS_TOKEN`, `ZALO_OA_REFRESH_TOKEN`. Hai biến này **chỉ dùng để khởi tạo** bảng `ZaloToken`. Sau đó hệ thống tự refresh và lưu cặp token mới vào DB. Refresh token chỉ dùng được một lần, nên không chép lại giá trị cũ vào `.env`.
3. Cấu hình webhook `POST https://<máy-chủ>/api/zalo/webhook`, bật sự kiện `user_send_text`, và điền `ZALO_WEBHOOK_SECRET`. Chữ ký được kiểm tra theo `X-ZEvent-Signature`.
4. Nhân viên vào `/me/zalo`, lấy mã 6 ký tự (hạn 15 phút) rồi nhắn mã đó cho OA để liên kết.

### Nhóm Zalo minh bạch

Mọi thao tác duyệt/sửa của HR và ADMIN được gửi vào một nhóm Zalo do OA quản lý (nhóm GMF, cần OA gói Doanh nghiệp), gồm:
- duyệt/từ chối đơn, chấm tay theo đơn;
- nhân viên (thêm, sửa, cho nghỉ, đặt lại mật khẩu), khuôn mặt;
- đăng ký và sửa ca tuần;
- phân quyền, mẫu tuần;
- báo cáo phòng chưa đăng ký ca.

**Không** gửi các lần quét chấm công và thao tác ngang quyền nhân viên (HR tự làm đơn của mình).

ADMIN nhập **ID nhóm** tại Cấu hình → Zalo. Ở chế độ mô phỏng, tin nhóm được in ra console và ghi `NotificationLog` (`toGroupId`). Khi chạy thật mà chưa nhập ID thì tin bị bỏ qua, kèm cảnh báo trong log server. **Cần xác minh** endpoint `/v3.0/oa/group/message` và payload theo tài liệu GMF trước khi chạy thật (`groupTransport` trong `src/lib/zalo-token.ts`).

Nếu refresh token thất bại, dashboard ADMIN hiện cảnh báo đỏ. **Cần xác minh trước khi chạy thật:** chính sách tin tư vấn (chỉ gửi được trong một khoảng thời gian sau khi người dùng tương tác), tin giao dịch và ZNS có phí. Phần gửi tin được tách thành `transport` trong `src/lib/zalo-token.ts`, nên có thể đổi loại tin mà không phải sửa nghiệp vụ.

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
- Việc cần làm ngoài code: lập hồ sơ đánh giá tác động xử lý dữ liệu cá nhân theo Luật 91/2025/QH15 và Nghị định 356/2025/NĐ-CP.

## Quyết định còn mở

Xem [`docs/OPEN-DECISIONS.md`](docs/OPEN-DECISIONS.md). Hiện có D1: cách trừ giờ nghỉ khi tính giờ công.

## Nghiệm thu thủ công trên thiết bị thật (PRD mục 10)

- [ ] Enroll 5 người thật, mỗi người quét 10 lần: nhận đúng ≥ 98%, không nhận nhầm.
- [ ] Thử giả mạo bằng ảnh in, ảnh trên điện thoại, video trên tablet (mỗi loại 20 lần), ghi lại tỉ lệ bị từ chối để quyết định có bật L2 hay không.
- [ ] `/kiosk/benchmark` trên tablet tham chiếu đạt p95 ≤ 1,5 giây.
- [ ] Tắt wifi, quét 3 lần, bật lại: cả 3 bản ghi lên server với đúng `capturedAt`.
- [ ] Liên kết Zalo thật cho 1 nhân viên và nhận đủ 4 loại tin.
