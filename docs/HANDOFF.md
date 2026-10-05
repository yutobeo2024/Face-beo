# Bàn giao / chuyển máy làm việc

Cập nhật 05/10/2026, phiên bản **v1.21.4**. Ngữ cảnh cho Claude Code nằm ở `CLAUDE.md` (gốc repo) — máy mới mở Claude Code trong thư mục
dự án là đọc được ngay. Lịch sử hội thoại và memory của Claude Code **không** nằm trong repo.

## 0. Máy chủ thật đã ở VPS (từ 21/09/2026)

- Ứng dụng chạy tại **https://face.ydsg.website** — VPS `root@103.142.27.210`, compose project `facebeo` (app + cloudflared + backup), dữ liệu ở
  `/opt/facebeo/data`, bí mật ở `/opt/facebeo/.env`, cập nhật: `sh /opt/facebeo/src/deploy/update.sh [tag]`. Chi tiết: `docs/DEPLOY-VPS.md`.
- **Đường vào (v1.16.0)**: người dùng → Caddy trên VPS (`/etc/caddy/face.caddy`, chỉ cho IP Việt Nam, fail2ban `facebeo-login`) →
  `127.0.0.1:3100` → container. Cloudflare Tunnel giữ làm **dự phòng** (đổi DNS về CNAME cũ là dùng lại). Đi thẳng nhanh hơn ~10 lần.
- **Chat bot tra cứu y khoa (v1.17.0–v1.19.0)**: dự án riêng **medichat** ở `/home/beodev/medichat` trên cùng VPS. Face Beo là cửa duy nhất,
  gọi qua mạng docker `facebeo-medichat` kèm khóa `X-Chat-Key`. Hai tài liệu: `docs/ket-noi-hai-webapp.html` (dễ hiểu) và
  `docs/ket-noi-hai-webapp-ky-thuat.md` (lệnh, VPS/Docker, sự cố, rollback).
- **Đổi máy làm việc (máy phát triển) không còn phải chép dữ liệu thật** — mục 1–3 dưới đây chỉ còn dùng khi dựng máy phát triển hoặc khi
  phải chuyển máy chủ thật sang nơi khác (quy trình chuyển thật: `docs/DEPLOY-VPS.md` mục 3).
- Máy phát triển **không** dùng khóa Zalo thật và **không** chạy cron (`DISABLE_CRON=true`): refresh token Zalo chỉ dùng được một lần, hai nơi
  cùng chạy sẽ làm hỏng token và gửi tin trùng. Cần dữ liệu thật để tái hiện lỗi: tải bản `data/backups/facebeo-YYYYMMDD.db` từ VPS về,
  mở bằng `.env` phát triển (không khóa Zalo) — nhớ `BIOMETRIC_KEY` phải trùng VPS mới đọc được mẫu khuôn mặt.

## 1. GitHub có gì, thiếu gì

`git clone` / `git pull` lấy được: toàn bộ mã nguồn, migration Prisma, seed, test, tài liệu (`docs/`), `.env.example`.

Bị `.gitignore` bỏ qua — **cố ý**, phải chép tay từ máy cũ (USB / ổ mã hóa, KHÔNG đẩy lên GitHub):

| Đường dẫn | Chứa gì | Nếu không chép |
|---|---|---|
| `.env` | mọi bí mật: `BIOMETRIC_KEY`, `SESSION_SECRET`, `ZALO_OA_*`, `ZALO_WEBHOOK_SECRET`, `CRON_SECRET`, `APP_BASE_URL`, `CHATBOT_API_KEY` (v1.17.0, phải khớp `CHAT_API_KEY` của medichat)… | Mất `BIOMETRIC_KEY` = **không giải mã được mẫu khuôn mặt**, phải enroll lại toàn bộ. Tạo `.env` mới từ `.env.example` chỉ khi bắt đầu lại từ đầu. |
| `data/facebeo.db` (+ `facebeo.db-wal`, `facebeo.db-shm` nếu còn) | DB thật: nhân viên, khuôn mặt, log chấm công, đơn, lịch, token Zalo, phân quyền | Máy mới trống: làm theo mục 1b (cấu hình nền + tạo Quản trị) rồi nhập lại người |
| `data/backups/` | bản `VACUUM INTO` hằng đêm 03:00 (giữ 14 bản) | Có thể dùng thay `facebeo.db` |
| `data/snapshots/` | ảnh lần quét (tự xóa sau 90 ngày) | Mất ảnh đối chiếu cũ, không ảnh hưởng công |
| `data/credentials/` (v1.9.0) | file scan văn bằng / chứng chỉ / CME | Mất file đính kèm (dữ liệu nhập tay vẫn còn trong DB) |
| `data/avatars/` (v1.10.0) | ảnh đại diện nhìn thẳng (cắt từ mẫu enroll) | Thẻ nhân viên hiện chữ viết tắt tới khi enroll lại |
| `data/photos/` (v1.13.0) | ảnh đại diện **tự chọn** của nhân viên (không phải dữ liệu sinh trắc) | Quay về ảnh enroll / chữ viết tắt |
| `models/*.onnx` (≈205 MB) | mô hình nhận diện + liveness + đồng phục | Tải lại: `npm run models:face`, `npm run models:liveness`, `npm run models:uniform` |
| `data/uniforms/` | ảnh mẫu áo đồng phục | Không có bản khác — phải nằm trong gói sao lưu (`deploy/backup.sh` đã gói) |
| `public/models/`, `node_modules/`, `.next/` | sinh ra khi cài/build | `npm install`, `npm run build` |

## 1b. Bắt đầu sạch (dữ liệu hiện tại chỉ là mockup — chọn cách này khi chưa vận hành thật)

Không cần chép `data/`. Trên máy mới sau `npm install`:

```bash
copy .env.example .env      # rồi mở .env điền giá trị (xem dưới)
npm run db:deploy           # tạo DB trống data/facebeo.db
npm run db:seed:base        # chỉ cấu hình nền: 4 ca, 3 mẫu tuần, ngày lễ, ma trận quyền (không tạo nhân viên, chạy lại được)
npm run admin:create -- --code AD01 --name "Họ Tên Quản Trị" --phone 09xxxxxxxx
#   tùy chọn: --dept "Ban quản trị" (mặc định)  --shift "Hành chính" (mặc định)  --password <≥8 ký tự, có chữ và số>
#   không truyền --password → in mật khẩu tạm MỘT LẦN ra màn hình; đăng nhập lần đầu bắt buộc đổi.
```

Sau đó đăng nhập bằng mã hoặc SĐT vừa tạo, vào Cài đặt kiểm tra ca/hệ số công (ca "Sáng thứ Bảy" 4 giờ = 0.5 công), tạo phòng ban,
nhân viên. Lệnh `admin:create` từ chối khi DB đã có Quản trị đang hoạt động. `db:seed:base` chạy lại an toàn: mỗi danh mục (ca, mẫu
tuần, ngày lễ, chức danh, chuyên khoa) chỉ được tạo khi bảng còn trống — mục đã xóa/đổi tên không bị tạo lại (v1.7.0).

- Nên bỏ `--password` (npm in lại cả dòng lệnh, lịch sử shell cũng lưu) — dùng mật khẩu tạm rồi đổi khi đăng nhập.
- Quên mật khẩu / Quản trị bị khóa đăng nhập: `npm run admin:create -- --reset AD01` → mật khẩu tạm mới, mở khóa, thu hồi mọi phiên cũ.
  Quản trị đã cho nghỉ việc không cấp lại được — khi không còn Quản trị nào hoạt động thì tạo tài khoản mới bằng `admin:create`.
- Muốn dữ liệu mẫu để thử (NV001…NV016, mật khẩu 123456): `npm run db:seed` — **xóa sạch DB** rồi tạo lại, nên tự dừng nếu DB đã có
  nhân viên hoặc ca; ép chạy bằng `npm run db:seed:force`. Không dùng trên DB thật.

Trong `.env` mới: tạo `BIOMETRIC_KEY` và `SESSION_SECRET` mới (chuỗi ngẫu nhiên dài; mẫu khuôn mặt sẽ enroll lại từ đầu nên khóa mới
không sao). Riêng phần Zalo nên **chép lại từ `.env` máy cũ**: `ZALO_OA_APP_ID`, `ZALO_OA_SECRET`, `ZALO_WEBHOOK_SECRET`, `ZALO_OA_NAME`.
Lưu ý token: cặp token hiện hành nằm trong bảng `ZaloToken` của DB cũ (refresh token trong `.env` cũ rất có thể đã bị dùng một lần
rồi) → bỏ DB thì phải **lấy cặp token mới** bằng API Explorer (developers.zalo.me/tools/explorer, Version 4) điền vào
`ZALO_OA_REFRESH_TOKEN`, rồi vào Cấu hình → Zalo OA **kết nối lại nhóm** (ID nhóm "FCY-ai": `712b67d35bb3b2edeba2`, hoặc dán từ danh
sách nhóm đã dò). Không điền Zalo thì hệ thống chạy mô phỏng, vẫn phát triển và test bình thường.

## 2. Trên máy cũ (trước khi tắt) — chỉ khi muốn giữ dữ liệu

1. Dừng server (`Ctrl+C` hoặc tắt tiến trình node cổng 3000) để SQLite gộp `-wal` vào `.db`.
2. Chép `.env`, `data/facebeo.db` (và `-wal`/`-shm` nếu vẫn còn), tùy chọn `data/backups/`, `data/snapshots/`, `models/*.onnx`.
3. Tùy chọn: chép thư mục memory của Claude Code `C:\Users\<user>\.claude\projects\D--FACE-BEO\memory\` — chỉ dùng lại được nếu
   đường dẫn dự án ở máy mới cũng là `D:\FACE BEO`; nếu khác, `CLAUDE.md` đã đủ.
4. Đảm bảo `git status` sạch và đã `git push` (kể cả tag: `git push --tags`).

## 3. Trên máy mới

```bash
# cần Node.js LTS (>= 20) và Git
git clone https://github.com/yutobeo2024/Face-beo.git "D:\FACE BEO"
cd "D:\FACE BEO"
# chép .env và thư mục data/ vào đây (bước 2), models/*.onnx nếu có
npm install                                   # prisma generate + copy models sang public/models
npm run models:face && npm run models:liveness && npm run models:uniform # bỏ qua nếu đã chép .onnx
npm run db:deploy                             # áp migration còn thiếu cho DB vừa chép (DB trống: xem mục 1b)
npm run build
set LIVENESS_SERVER=true && npx next start -p 3000   # PowerShell: $env:LIVENESS_SERVER="true"; npx next start -p 3000
npm test                                      # 821 test, dùng data/test.db riêng (+ data/test-bootstrap.db)
```

Kiểm tra: đăng nhập, Cấu hình → Zalo OA hiện "đang gửi thật" (nếu chép đúng `.env` + DB), Nhân viên hiện đủ người, Chấm công có log cũ.

Kiosk/tablet: từ 21/09/2026 trỏ tới **https://face.ydsg.website/kiosk** (không còn IP LAN `192.168.1.6:3000`). Đổi địa chỉ máy chủ thì cập nhật
`APP_BASE_URL` trong `.env` và **ghép lại** tablet ở Thiết bị kiosk (cookie kiosk gắn với từng địa chỉ).

## 4. Tiếp tục với Claude Code

- Mở Claude Code trong thư mục dự án; nó tự nạp `CLAUDE.md`. Mô tả việc cần làm; nhắc "làm liền mạch, review + QC song song" nếu cần.
- Tài liệu để cùng đọc: cẩm nang https://claude.ai/artifact/EiMsP9AtirhXTiNUeKyPXz (mục nào cần thì gửi link), Zalo OA
  https://claude.ai/artifact/KwxtwjjshvwgYp8F9T64gh. File gốc: `docs/huong-dan-su-dung.html`, `docs/zalo-oa.html`.
- Nối Face Beo với chat bot medichat: `docs/ket-noi-hai-webapp.html` (cho người không chuyên) và
  `docs/ket-noi-hai-webapp-ky-thuat.md` (lệnh cụ thể, logic VPS/Docker, 14 sự cố đã gặp, rollback).
  Hai tài liệu này **giữ trong repo, không publish artifact**.
- Việc còn mở: xem cuối `CLAUDE.md` và `docs/OPEN-DECISIONS.md` mục "Đang mở".

## 5. Mốc đã làm hôm 20/09/2026
v1.4.3 sửa RBAC → v1.4.4 khắc phục rà soát bảo mật → v1.4.5 đổi mật khẩu → v1.5.0 mục Thông tin (liên kết) → v1.5.1 sửa/xóa cấu hình
tổ chức → v1.5.2 Excel giờ vào/ra → v1.5.3 xóa tài khoản tạo nhầm + thu hồi phiên → tài liệu Zalo OA.
21/09/2026: v1.5.4 `db:seed:base` + `admin:create` (khởi tạo vận hành thật không qua dữ liệu mẫu).
21/09/2026 (tiếp): v1.6.0 nhiều nhóm Zalo → v1.7.0 duyệt đơn theo phòng + chức danh/chuyên khoa → v1.8.0 thông tin cá nhân + nhập Excel →
v1.9.0 hồ sơ hành nghề (GPHN, CME) → v1.10.0 ảnh đại diện → v1.10.1 đóng gói Docker, triển khai VPS qua Cloudflare Tunnel, chuyển dữ liệu →
v1.10.2 webhook Zalo trên face.ydsg.website (xác thực domain bằng tệp HTML, OA Secret Key).

## 6. Mốc 22/09 – 05/10/2026 (v1.10.4 → v1.21.4)

| Bản | Nội dung |
|---|---|
| v1.10.4 | Sao lưu ra ngoài VPS: mã hóa rồi đẩy lên Cloudflare R2 lúc 03:30 (`deploy/backup.sh`, khôi phục `deploy/restore-offsite.sh`) |
| v1.11.0–v1.11.1 | Tra cứu GPHN trên medinet (điền sẵn form, đối chiếu tự động 06:30) |
| v1.12.0 | Phòng / người **không chấm công** (Ban Giám đốc), chỉ Quản trị đổi được |
| v1.12.1–v1.12.2 | Ca cố định luôn có mẫu tuần trong Cấu hình; sửa lỗi hai mẫu tuần sinh cùng lúc |
| v1.13.0 | Ảnh đại diện tự chọn (cắt 3:4, ≤ 5 MB, `data/photos/`) |
| v1.14.0 | Cài Face Beo thành app điện thoại / máy tính (PWA) |
| v1.15.0 | Trang Cấu hình chia 5 tab; xóa nhóm Zalo |
| v1.16.0 | Giảm độ trễ: kho nhớ phía trình duyệt + **đường đi thẳng qua Caddy** (chặn IP ngoài VN, fail2ban) |
| v1.17.0 | **Chat bot tra cứu y khoa** nhúng trong Face Beo: khóa đường công khai của medichat, quyền theo phòng + từng người, 10 câu/phút · 100 câu/ngày, không lưu nội dung |
| v1.18.0 | Chat bot **trả lời theo luồng** (chữ hiện dần), giao diện chat làm lại: bảng bên đóng/mở, nút Dừng, ba chấm nhấp nháy |
| v1.19.0 | Bảng gợi ý chia **4 mục tra cứu**: TRA CỨU MÃ ICD · CHUYÊN MÔN Y TẾ · QUY CHẾ – QUY ĐỊNH · MÔ TẢ CÔNG VIỆC (hai mục sau chờ nạp tài liệu, cờ `ready` trong `src/app/me/chatbot/knowledge.ts`) |
| v1.20.0 | **Kiểm áo đồng phục** ở lượt chấm vào đầu ca: 3 tín hiệu (màu · logo ngực · DINOv2), 3 mức Đạt / Không đạt / Cần xem lại, bảng theo dõi, Excel riêng `DongPhuc_*.xlsx`, tin Zalo 18:00 cho quản lý phòng. Khung ngắm kiosk đổi sang tỉ lệ ảnh thẻ 4×6 + nhắc "Lùi lại một bước" |
| v1.20.1 | Gỡ vòng luẩn quẩn khi khai mẫu áo lần đầu: chỉ chế độ **Bật** mới đòi mẫu áo đang dùng; phòng chưa khai mẫu vẫn **lưu ảnh vùng áo** để Nhân sự lấy làm mẫu |
| v1.20.2 | Kiosk **vẽ đúng chỗ máy đang nhìn**: ô bám theo khuôn mặt + dải vùng áo (cùng hằng `SHIRT_CROP`), xanh khi đạt cổng. Vạch nét đứt cũ chỉ là hình trang trí, không khớp luật máy |
| v1.21.0 | Kiosk có **chế độ chờ**: camera TẮT tới khi chạm màn hình — chặn chấm nhầm khi đi ngang, camera không chạy suốt. `kioskIdleSeconds` / `kioskAwakeSeconds` trong Cấu hình |
| v1.21.1–v1.21.2 | **Sửa vùng cắt áo theo 13 ảnh thật**: khung mặt của bộ dò là hình VUÔNG nên tỉ lệ cũ cắt quá thấp, mất logo. Cắt được 8/13 → 12/13, logo 3/6 → 6/6, hết cắt hụt đáy. `CHEST_ROOM_NEEDED` và `QUALITY_LIMITS` thành nguồn duy nhất, hết cảnh sửa một nơi quên nơi kia |
| v1.21.3 | Thêm **ô nhập 4 ngưỡng đồng phục** vào Cấu hình → Chấm công (tài liệu ghi có từ v1.20.0 mà giao diện chưa làm) |
| v1.21.4 | Test chấm công hết phụ thuộc giờ chạy / thứ trong tuần (giờ quét cố định + mẫu tuần đủ 7 ngày cho nhân viên test) |

## 7. Việc đang chờ chủ dự án

- **Nạp tài liệu** cho hai mục còn lại của chat bot (quy chế – quy định, mô tả công việc) bên dự án medichat, rồi đổi `ready: true`.
- **Khóa Gemini**: một khóa đã hết tiền trả trước (lỗi 402), nạp lại ở AI Studio hoặc gỡ khỏi `GEMINI_API_KEY` của medichat.
- **D7** trong `docs/OPEN-DECISIONS.md`: đổi token tunnel + OA Secret Key đã lộ trong ảnh chụp 21/09/2026.
- Chạy thử một phòng với dữ liệu thật (hiện vẫn là dữ liệu mẫu).
- **Đồng phục — phòng Kế toán đang chạy thử** từ 03/10/2026. Mẫu áo "Áo polo navy" đã bật với **7 ảnh người mặc** lấy
  từ chính lượt chấm công. Số đo 2 ngày đầu: mặc đúng áo cho **màu 0,92–0,99 · hình dáng 0,85–0,91**.
  - Mỗi ngày Nhân sự vào `/admin/uniform` bấm **Đạt / Không đạt** cho mọi dòng — đó là đáp án để đo ngưỡng.
  - **Đang thiếu nhóm mặc SAI áo.** Cần 10–15 lượt, rải nhiều hôm, có cả **áo sẫm gần giống navy**. Không có nhóm này
    thì `npm run uniform:eval` không tìm được vạch, vì chỉ biết áo đúng nằm ở đâu.
  - Hẹn đo khoảng **17/10/2026** → đặt ngưỡng ở **Cấu hình → Chấm công → Ngưỡng kiểm đồng phục** → chuyển sang **Bật**.
- **Chưa chốt camera cho kiosk**: máy tính webcam ngang (đang dùng) hay tablet camera dọc. Khung dọc dư chỗ hơn hẳn cho
  vùng ngực. Đổi camera thì phải **đo lại `minBrightness`** (số hiện tại là của webcam máy tính).
