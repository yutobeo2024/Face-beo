# Triển khai Face Beo lên VPS (đi thẳng qua Caddy; Cloudflare Tunnel làm dự phòng)

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

## Đường truyền: đi thẳng (chính) và Cloudflare Tunnel (dự phòng) — v1.16.0

Máy chủ đặt ở TP.HCM nhưng Cloudflare nối đường hầm qua Singapore, nên trước v1.16.0 **mỗi lượt gọi phải đi vòng Việt Nam →
Singapore → Việt Nam**. Đo từ máy ở Việt Nam: qua đường hầm **300–420 ms** (có lần 5 giây khi đường hầm rớt và nối lại), đi thẳng
tới VPS **31 ms**. Vì vậy đường chính chuyển sang đi thẳng, đường hầm giữ lại làm dự phòng.

```
Điện thoại ──HTTPS──> Caddy (VPS, cổng 443) ──> 127.0.0.1:3100 ──> container facebeo-app
                └ dự phòng: Cloudflare Tunnel ──> facebeo-app:3000 (mạng docker)
```

**Cài một lần trên VPS** (chỉ thêm, không sửa phần của dự án khác — Caddyfile hiện chỉ có khối mẫu `:80`):

```bash
cd /opt/facebeo/src && git pull && docker compose -f deploy/docker-compose.yml -p facebeo --env-file /opt/facebeo/.env up -d
cp deploy/caddy-face.conf /etc/caddy/face.caddy
grep -q 'face.caddy' /etc/caddy/Caddyfile || echo 'import /etc/caddy/face.caddy' >> /etc/caddy/Caddyfile
sh deploy/vn-ip-refresh.sh                       # tạo /etc/caddy/vn-ips.caddy (dải IP Việt Nam, APNIC)
(crontab -l 2>/dev/null; echo '0 4 * * 1 sh /opt/facebeo/src/deploy/vn-ip-refresh.sh >/var/log/vn-ip-refresh.log 2>&1') | crontab -
apt-get install -y fail2ban   # rồi làm theo hướng dẫn trong deploy/fail2ban-facebeo.conf
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

**Hiện trạng (24/09/2026)**: đã chuyển xong. `face.ydsg.website` và `direct.ydsg.website` cùng trỏ **A → 103.142.27.210**
(DNS only). Caddy phục vụ cả hai trong một khối (`/etc/caddy/face.caddy`), chứng chỉ Let's Encrypt đã cấp.
Đo sau khi chuyển: **35–90 ms** mỗi lượt (trước đó 300–530 ms, thỉnh thoảng 5 giây). Đã kiểm tra từ máy chủ nước ngoài:
trang app trả 403 "chỉ truy cập được từ Việt Nam", riêng `/api/zalo/webhook` vẫn trả `{"ok":true}`.

**Lưu ý khi sửa Caddy trên máy này**: Caddy chạy bằng `/opt/hermes/Caddyfile` (dự án zalo-hermess) chứ không phải
`/etc/caddy/Caddyfile`; file đó dùng biến môi trường nên muốn kiểm tra cú pháp phải nạp biến trước:
`set -a; . /opt/hermes/.env; set +a; caddy validate --config /opt/hermes/Caddyfile --adapter caddyfile`.
Caddy ở đây đặt `admin off` nên **không reload được**, phải `systemctl restart caddy` (các trang khác gián đoạn vài giây).
Thư mục log phải thuộc user `caddy`: `chown -R caddy:caddy /var/log/caddy`. Bản sao lưu cấu hình gốc:
`/opt/hermes/Caddyfile.truoc-facebeo.bak`.

**DNS (làm trên Cloudflare, sau khi Caddy chạy)**

1. Thử trước: thêm `direct.ydsg.website` → **A** `103.142.27.210`, **tắt proxy** (đám mây xám). Mở thử, đăng nhập, quét kiosk.
2. Chuyển chính thức: xóa bản ghi **Tunnel** của `face.ydsg.website` rồi thêm **A** `103.142.27.210`, **tắt proxy**, TTL Auto.
   Làm liền tay: vùng này có bản ghi `*.ydsg.website` (A, Proxied) sẽ tạm hứng `face` trong lúc trống.
   Ngay sau đó thêm tên miền vào khối Caddy (`sed -i "s|^direct|face.ydsg.website, direct|" /etc/caddy/face.caddy`) và restart.
3. Muốn quay lui: xóa bản ghi A, vào **Zero Trust → Networks → Tunnels → facebeo → Public Hostnames → Add**
   (`face.ydsg.website` → `http://app:3000`). Container `cloudflared` vẫn chạy nên vài phút là về như cũ.

**Bắt buộc đi kèm**: `deploy/docker-compose.yml` đã bỏ `CLIENT_IP_HEADER=cf-connecting-ip`. Khi đi thẳng, IP thật nằm ở
`X-Forwarded-For` do Caddy ghi. Nếu quay về chạy **chỉ** qua đường hầm thì phải đặt lại biến đó, nếu không mọi người dùng bị tính
chung một IP khi giới hạn tần suất đăng nhập.

**Chặn truy cập ngoài Việt Nam**: `vn-ip-refresh.sh` sinh danh sách dải IP Việt Nam cho Caddy; ngoài dải → 403. Hai đường được chừa:
`/api/zalo/webhook*` (máy chủ Zalo gọi, đã kiểm chữ ký) và `/.well-known/*` (xác thực chứng chỉ). Script tự dừng nếu tải được dưới
300 dải (nghi lỗi mạng) để không khóa nhầm cả phòng khám.

## Chat bot tra cứu y khoa (v1.17.0)

Chat bot (dự án **medichat**, `~/medichat` trên cùng VPS) trước đây công khai không đăng nhập. Từ v1.17.0 chỉ Face Beo gọi được:

```
Điện thoại ──> Face Beo (/me/chatbot) ──> /api/me/chatbot/ask (kiểm đăng nhập + quyền + giới hạn)
                                              └──> http://backend:8089/api/v1/chat  (mạng docker, kèm X-Chat-Key)
```

**Cài một lần:**

```bash
# 1) Sinh khóa chung cho hai bên (giữ kín, không commit)
KEY=$(openssl rand -hex 32)

# 2) Face Beo biết khóa
grep -q '^CHATBOT_API_KEY=' /opt/facebeo/.env || echo "CHATBOT_API_KEY=$KEY" >> /opt/facebeo/.env

# 3) Chat bot bắt buộc khóa (thiếu biến này = vẫn mở cho mọi người như trước; lúc khởi động backend sẽ in cảnh báo)
grep -q '^CHAT_API_KEY=' ~/medichat/backend/.env || echo "CHAT_API_KEY=$KEY" >> ~/medichat/backend/.env

# 4) Mạng cầu nối RIÊNG chỉ có hai container: facebeo-app và medichat-backend.
#    (Không cho Face Beo vào thẳng medichat_default: làm vậy thì cloudflared của medichat cũng gọi được
#     facebeo-app:3000, tức là một đường vòng qua mặt Caddy — chặn ngoài Việt Nam + fail2ban.)
docker network create facebeo-medichat 2>/dev/null || true
cd ~/medichat && git pull && docker compose up -d --force-recreate backend

# 5) Cập nhật Face Beo (compose của Face Beo cũng tham gia mạng cầu nối này)
cd /opt/facebeo/src && sh deploy/update.sh v1.17.0
```

**Kiểm tra:**

```bash
# a) Hỏi thẳng chat bot từ ngoài → 401
curl -s -X POST https://medichat.ydsgchatbot.io.vn/api/v1/chat -H 'content-type: application/json' -d '{"message":"test"}'

# b) Mạng cầu nối đúng 2 container (facebeo-app, medichat-backend-1) — KHÔNG có cloudflared nào
docker network inspect facebeo-medichat -f '{{range .Containers}}{{.Name}} {{end}}'
```

Trong Face Beo, tài khoản được cấp quyền hỏi vẫn bình thường.

**Lưu ý còn hở**: ảnh minh họa `https://medichat.../static/images/...` vẫn mở cho ai biết đúng tên tệp (do chính backend
phục vụ). Đó là hình vẽ minh họa quy trình, không có dữ liệu nhân viên; phần hỏi đáp mới là phần đã khóa.
Từ 25/09/2026 giao diện chat công khai + trang `/admin` của medichat đã tắt (profile `web`), trang chủ trả 502; cần nạp tài
liệu thì bật lại: `cd ~/medichat && docker compose --profile web up -d --build frontend`.

**Trả lời theo luồng (v1.18.0)**: Face Beo gọi `POST /api/v1/chat/stream` của medichat và chuyển tiếp SSE thẳng cho trình duyệt.
Caddy trên VPS không đệm phản hồi nên chữ ra ngay; nếu sau này đưa chat bot ra sau một proxy khác, nhớ giữ `X-Accel-Buffering: no`
và tắt đệm, không thì luồng mất tác dụng. Chat bot đời cũ chưa có đường này thì Face Beo tự quay về cách hỏi một lần.

**Giới hạn lượt**: khi gọi kèm khóa, medichat bỏ qua bộ đếm theo IP của nó (cả phòng khám đi chung một container nên đếm theo
IP sẽ thành hạn mức chung). Việc chặn lạm dụng do Face Beo lo: 10 câu/phút và 100 câu/ngày cho **từng nhân viên**.

**Đổi khóa về sau**: sinh khóa mới, sửa cả hai file `.env`, dựng lại `medichat-backend` và `facebeo-app`. Quên một bên thì
Face Beo báo "Chat bot từ chối khóa truy cập" (502) — không mất dữ liệu.

**Cấp quyền dùng**: mặc định không ai dùng được. Cấu hình → Tổ chức → tích "Được dùng Chat bot" cho phòng, hoặc mở hồ sơ từng
nhân viên. Quyền cấp phát là `chatbot.grant` (Nhân sự + Quản trị có sẵn; migration đã chèn dòng cho Nhân sự).

## Theo dõi

```bash
docker ps --filter name=facebeo          # trạng thái + healthcheck
docker stats --no-stream facebeo-app-1   # RAM (giới hạn 1,5 GB)
docker logs -f facebeo-app-1             # log ứng dụng, [cron], [api] lỗi
tail -f /var/log/caddy/face.log          # lượt truy cập qua đường đi thẳng (JSON)
fail2ban-client status facebeo-login     # IP đang bị chặn vì dò mật khẩu
curl -o /dev/null -w '%{time_starttransfer}
' https://face.ydsg.website/login   # đo độ trễ (mục tiêu < 0,08 giây)
```

## Quay lui

Dữ liệu gốc vẫn ở máy local tới khi xóa. VPS lỗi: `fb down`, bật lại server local (khôi phục `.env` local đủ khóa Zalo). Nếu VPS đã
chạy cron vài lần (token Zalo đã refresh) thì **chép `facebeo.db` từ VPS về** local trước khi bật lại.
