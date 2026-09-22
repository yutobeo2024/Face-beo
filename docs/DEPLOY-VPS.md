# Triển khai Face Beo lên VPS qua Cloudflare Tunnel

VPS hiện dùng: `root@103.142.27.210` — Ubuntu 24.04, 6 vCPU (AVX2), RAM 5,8 GB, Docker 29. VPS **chạy chung** với các dự án khác
(medichat, zalo-hermess, qlcl, billbot — mỗi dự án một docker compose + container `cloudflared` riêng; cổng host 3000 đã có người dùng,
Caddy giữ 80/443). Face Beo làm cùng kiểu: compose project `facebeo` gồm `app` + `cloudflared`, **không mở cổng host nào**, không đụng
Caddy / ufw / container khác.

```
/opt/facebeo/
  .env        # cấu hình + bí mật (chmod 600) — KHÔNG commit
  data/       # facebeo.db, snapshots/, backups/, credentials/, avatars/, photos/
  models/     # w600k_r50.onnx, MiniFASNetV2.onnx
  src/        # git clone của repo
```

## 1. Cloudflare (một lần)

1. Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → đặt tên `facebeo` → chép **token** (chuỗi dài sau `--token`).
2. Tab **Public Hostname** → Add: Subdomain `<sub>`, Domain `<tên miền>`, Service **HTTP** `app:3000`.
3. SSL/TLS của tên miền: **Full**; bật **Always Use HTTPS**. (Tải lên của Cloudflare gói miễn phí ≤ 100 MB — enroll gửi ~5 MB, đủ.)

## 2. VPS — chuẩn bị (một lần)

```bash
ssh root@103.142.27.210
mkdir -p /opt/facebeo/data /opt/facebeo/models
git clone https://github.com/yutobeo2024/Face-beo.git /opt/facebeo/src
```

## 3. Chuyển dữ liệu từ máy đang chạy (Windows)

1. **Dừng server local** (tắt tiến trình node cổng 3000) để SQLite gộp `-wal` vào `facebeo.db`.
2. Từ máy local (Git Bash, thư mục dự án):
   ```bash
   scp data/facebeo.db root@103.142.27.210:/opt/facebeo/data/
   scp -r data/credentials data/avatars data/photos root@103.142.27.210:/opt/facebeo/data/      # nếu có
   scp -r data/snapshots data/backups root@103.142.27.210:/opt/facebeo/data/        # tùy chọn
   scp models/*.onnx root@103.142.27.210:/opt/facebeo/models/                        # hoặc tải lại ở bước 4
   scp .env root@103.142.27.210:/opt/facebeo/.env
   ```
3. Trên VPS sửa `/opt/facebeo/.env`:
   - `APP_BASE_URL="https://<sub>.<tên miền>"`
   - thêm `TUNNEL_TOKEN=<token bước 1>`
   - **xóa** `INSECURE_COOKIES` (hoặc `=false`), **xóa** `TRUSTED_PROXY_HOPS=0`
   - `DISABLE_CRON=false`
   - **giữ nguyên** `BIOMETRIC_KEY`, `SESSION_SECRET`, `CRON_SECRET`, các khóa `ZALO_*` (đổi `BIOMETRIC_KEY` = mất toàn bộ mẫu khuôn mặt)
   - `DATABASE_URL` và `CLIENT_IP_HEADER` đã đặt sẵn trong `deploy/docker-compose.yml`.
   ```bash
   chmod 600 /opt/facebeo/.env
   ```

## 4. Build & chạy

```bash
cd /opt/facebeo/src
alias fb='docker compose -f deploy/docker-compose.yml -p facebeo --env-file /opt/facebeo/.env'
fb build app
fb run --rm --entrypoint "" app sh -c "npm run models:face && npm run models:liveness"   # bỏ qua nếu đã chép .onnx
fb up -d
docker logs --tail 50 facebeo-app-1        # phải có "[cron] đã lên lịch" và "Ready"
docker logs --tail 20 facebeo-cloudflared-1 # phải có "Registered tunnel connection"
```

Mở `https://<sub>.<tên miền>/login` → đăng nhập bằng tài khoản thật.

> Đổi biến trong `/opt/facebeo/.env` xong phải **tạo lại container** (`fb up -d --force-recreate app`, tunnel: `… cloudflared`) — `restart` không nạp lại env.
> Dán bí mật bằng lệnh, **không chụp màn hình** có bí mật.

## 5. Tắt hẳn server local — BẮT BUỘC

Refresh token Zalo **chỉ dùng được một lần**: hai nơi cùng chạy cron sẽ làm hỏng token (phải lấy lại bằng API Explorer) và gửi tin nhóm trùng.
Muốn giữ máy local để phát triển: xóa mọi dòng `ZALO_*` trong `.env` local (chạy mô phỏng) và đặt `DISABLE_CRON=true`.

## 6. Sau khi chuyển

- Zalo (developers.zalo.me → ứng dụng), làm theo thứ tự:
  1. **Xác thực domain** `<sub>.<tên miền>` bằng cách **Tải tệp HTML**: đặt file `zalo_verifier<mã>.html` Zalo đưa vào `public/`, commit,
     `update.sh`, rồi bấm Xác thực. (DNS TXT không dùng được: tên `<sub>` đã là CNAME của tunnel; thẻ meta không qua được vì `/` chuyển hướng.)
  2. **Webhook** → URL `https://<sub>.<tên miền>/api/zalo/webhook` → Kiểm tra → tích "Tôi đã hiểu" → Cập nhật. Cảnh báo "IP [US]" là do
     Cloudflare; chiều app → Zalo vẫn đi từ IP Việt Nam của VPS. Chưa có `ZALO_WEBHOOK_SECRET` thì webhook trả 200 nhưng bỏ qua mọi sự kiện.
  3. Chép **OA Secret Key** hiện ra sau khi lưu → `ZALO_WEBHOOK_SECRET` trong `/opt/facebeo/.env` →
     `fb up -d --force-recreate app` (env chỉ nạp khi tạo lại container). Từ đây chữ ký sai → 401.
  4. Đăng ký sự kiện `user_send_text`, `create_group`.
- Cấu hình → Zalo OA: phải "Đang gửi thật" → **Gửi tin thử** từng nhóm.
- **Tablet kiosk**: mở `https://<sub>.<tên miền>/kiosk/pair`, ghép lại (Thiết bị kiosk → Thêm thiết bị → mã 6 số); thu hồi thiết bị cũ.
- Thử enroll + quét trên tablet: camera mở được (HTTPS), nhận đúng người.

## Cập nhật phiên bản mới

```bash
sh /opt/facebeo/src/deploy/update.sh            # main mới nhất
sh /opt/facebeo/src/deploy/update.sh v1.10.1    # đúng một tag
```
Script: `git pull` → build image → `up -d` (container tự `prisma migrate deploy` khi khởi động) → chờ `/login` 200. Trong lúc build
image cũ vẫn phục vụ; gián đoạn chỉ vài giây lúc đổi container. Kiosk đang mở tự tải lại khi thấy phiên bản mới.

## Sao lưu

- Job `db-backup` (03:00) ghi `VACUUM INTO` vào `/opt/facebeo/data/backups/`, giữ 14 bản — **vẫn nằm trên VPS**.
- **Ra ngoài VPS — Cloudflare R2 (v1.10.4)**: service `backup` (image `rclone/rclone`, `deploy/backup.sh`) mỗi ngày **03:30** nén bản DB mới
  nhất trong `backups/` + `credentials/` + `avatars/` + `photos/` → **mã hóa** (rclone crypt) → bucket R2 `facebeo-backup`, thư mục `facebeo/daily/`,
  giữ **30 ngày**. Không đưa `snapshots/` (ảnh quét tự xóa sau 90 ngày) và **không đưa `.env`** lên R2.
  - Biến trong `/opt/facebeo/.env`: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (token R2 chỉ quyền Object Read & Write
    trên đúng bucket), `BACKUP_CRYPT_PASSWORD`, `BACKUP_CRYPT_SALT` (tạo ngẫu nhiên trên VPS).
  - **Cất một bản `/opt/facebeo/.env` ra ngoài máy chủ** (trình quản lý mật khẩu / USB mã hóa): mất mật khẩu mã hóa = không giải mã được bản
    sao lưu; mất `BIOMETRIC_KEY` = không đọc được mẫu khuôn mặt.
  - Chạy tay / xem kết quả: `docker exec facebeo-backup-1 sh /scripts/backup.sh once`, `cat /opt/facebeo/backup-status/offsite-status.json`,
    `docker logs facebeo-backup-1`.
- **Khôi phục từ R2**: `sh /opt/facebeo/src/deploy/restore-offsite.sh [YYYYMMDD]` → tải + giải mã + giải nén vào `/opt/facebeo/restore`,
  kiểm `integrity_check`, đếm bản ghi; **không tự ghi đè** — script in các lệnh thay dữ liệu đang chạy.
- Khôi phục từ bản trên VPS: `fb down` → chép `backups/facebeo-YYYYMMDD.db` thành `data/facebeo.db` (xóa `-wal`/`-shm`) → `fb up -d`.

## Theo dõi

```bash
docker ps --filter name=facebeo          # trạng thái + healthcheck
docker stats --no-stream facebeo-app-1   # RAM (giới hạn 1,5 GB)
docker logs -f facebeo-app-1             # log ứng dụng, [cron], [api] lỗi
```

## Quay lui

Dữ liệu gốc vẫn ở máy local tới khi xóa. VPS lỗi: `fb down`, bật lại server local (khôi phục `.env` local đủ khóa Zalo). Nếu VPS đã
chạy cron vài lần (token Zalo đã refresh) thì **chép `facebeo.db` từ VPS về** local trước khi bật lại.
