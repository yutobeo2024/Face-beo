# Bàn giao / chuyển máy làm việc

Cập nhật 20/09/2026, phiên bản v1.5.3. Ngữ cảnh cho Claude Code nằm ở `CLAUDE.md` (gốc repo) — máy mới mở Claude Code trong thư mục
dự án là đọc được ngay. Lịch sử hội thoại và memory của Claude Code **không** nằm trong repo.

## 1. GitHub có gì, thiếu gì

`git clone` / `git pull` lấy được: toàn bộ mã nguồn, migration Prisma, seed, test, tài liệu (`docs/`), `.env.example`.

Bị `.gitignore` bỏ qua — **cố ý**, phải chép tay từ máy cũ (USB / ổ mã hóa, KHÔNG đẩy lên GitHub):

| Đường dẫn | Chứa gì | Nếu không chép |
|---|---|---|
| `.env` | mọi bí mật: `BIOMETRIC_KEY`, `SESSION_SECRET`, `ZALO_OA_*`, `ZALO_WEBHOOK_SECRET`, `CRON_SECRET`, `APP_BASE_URL`… | Mất `BIOMETRIC_KEY` = **không giải mã được mẫu khuôn mặt**, phải enroll lại toàn bộ. Tạo `.env` mới từ `.env.example` chỉ khi bắt đầu lại từ đầu. |
| `data/facebeo.db` (+ `facebeo.db-wal`, `facebeo.db-shm` nếu còn) | DB thật: nhân viên, khuôn mặt, log chấm công, đơn, lịch, token Zalo, phân quyền | Máy mới trống, phải seed lại (`npm run db:seed`) và nhập lại người |
| `data/backups/` | bản `VACUUM INTO` hằng đêm 03:00 (giữ 14 bản) | Có thể dùng thay `facebeo.db` |
| `data/snapshots/` | ảnh lần quét (tự xóa sau 90 ngày) | Mất ảnh đối chiếu cũ, không ảnh hưởng công |
| `models/*.onnx` (≈180 MB) | mô hình nhận diện + liveness | Tải lại: `npm run models:face` và `npm run models:liveness` |
| `public/models/`, `node_modules/`, `.next/` | sinh ra khi cài/build | `npm install`, `npm run build` |

## 1b. Bắt đầu sạch (dữ liệu hiện tại chỉ là mockup — chọn cách này khi chưa vận hành thật)

Không cần chép `data/`. Trên máy mới sau `npm install`:

```bash
copy .env.example .env      # rồi mở .env điền giá trị (xem dưới)
npm run db:deploy && npm run db:seed   # DB mới + dữ liệu mẫu NV001…, mật khẩu seed 123456
```

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
npm run models:face && npm run models:liveness # bỏ qua nếu đã chép .onnx
npm run db:deploy                             # áp migration còn thiếu cho DB vừa chép
npm run build
set LIVENESS_SERVER=true && npx next start -p 3000   # PowerShell: $env:LIVENESS_SERVER="true"; npx next start -p 3000
npm test                                      # 812 test, dùng data/test.db riêng
```

Kiểm tra: đăng nhập, Cấu hình → Zalo OA hiện "đang gửi thật" (nếu chép đúng `.env` + DB), Nhân viên hiện đủ người, Chấm công có log cũ.

Kiosk/tablet: đang trỏ tới IP máy chủ cũ (`192.168.1.6:3000`). IP đổi thì cập nhật `APP_BASE_URL` trong `.env`, mở lại `/kiosk` trên
tablet bằng địa chỉ mới; thiết bị đã ghép vẫn hợp lệ (cookie kiosk) nếu cùng origin, khác origin thì ghép lại ở Thiết bị kiosk.

## 4. Tiếp tục với Claude Code

- Mở Claude Code trong thư mục dự án; nó tự nạp `CLAUDE.md`. Mô tả việc cần làm; nhắc "làm liền mạch, review + QC song song" nếu cần.
- Tài liệu để cùng đọc: cẩm nang https://claude.ai/artifact/EiMsP9AtirhXTiNUeKyPXz (mục nào cần thì gửi link), Zalo OA
  https://claude.ai/artifact/KwxtwjjshvwgYp8F9T64gh. File gốc: `docs/huong-dan-su-dung.html`, `docs/zalo-oa.html`.
- Việc còn mở: xem cuối `CLAUDE.md` và `docs/OPEN-DECISIONS.md` mục "Đang mở".

## 5. Mốc đã làm hôm 20/09/2026
v1.4.3 sửa RBAC → v1.4.4 khắc phục rà soát bảo mật → v1.4.5 đổi mật khẩu → v1.5.0 mục Thông tin (liên kết) → v1.5.1 sửa/xóa cấu hình
tổ chức → v1.5.2 Excel giờ vào/ra → v1.5.3 xóa tài khoản tạo nhầm + thu hồi phiên → tài liệu Zalo OA.
