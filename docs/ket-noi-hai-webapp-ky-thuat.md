# Nối Face Beo với chat bot medichat — tài liệu kỹ thuật

Bản chi tiết dành cho người vận hành / lập trình. Bản dễ đọc cho người không chuyên: [`ket-noi-hai-webapp.html`](ket-noi-hai-webapp.html).
Triển khai chung của Face Beo: [`DEPLOY-VPS.md`](DEPLOY-VPS.md). Đặc tả tính năng: [`PRD-v2.1-HR.md`](PRD-v2.1-HR.md) mục 31.

Mọi lệnh dưới đây chạy với quyền `root` trên VPS `103.142.27.210` trừ khi ghi khác. **Không lệnh nào in khóa ra màn hình** —
nếu cần đối chiếu thì so sánh trong shell rồi chỉ in kết quả đúng/sai (xem §3.3).

---

## 1. Bản đồ máy chủ

VPS chạy **5 dự án** trong cùng một Docker daemon. Chỉ được đụng vào container/mạng của `facebeo` và `medichat`.

### 1.1 Container liên quan

| Container | Image | Cổng host | Mạng | Vai trò |
|---|---|---|---|---|
| `facebeo-app-1` | `facebeo-app:latest` | `127.0.0.1:3100→3000` | `facebeo_default`, `facebeo-medichat` | App nhân sự (Next.js) |
| `facebeo-cloudflared-1` | `cloudflare/cloudflared` | — | `facebeo_default` | Đường hầm **dự phòng** |
| `facebeo-backup-1` | `rclone/rclone` | — | `facebeo_default` | Sao lưu R2 03:30 |
| `medichat-backend-1` | `medichat-backend` | `127.0.0.1:8089→8089` | `medichat_default`, `facebeo-medichat` | FastAPI + RAG |
| `medichat-qdrant-1` | `qdrant/qdrant` | `127.0.0.1:6333` | `medichat_default` | Kho vector |
| `medichat-frontend-1` | `medichat-frontend` | `127.0.0.1:3000` | `medichat_default` | Giao diện chat công khai + trang `/admin`. **Đã tắt từ 25/09/2026** (nằm sau profile `web`): chat bot chỉ phục vụ Face Beo. Bật lại khi cần nạp tài liệu: `cd ~/medichat && docker compose --profile web up -d --build frontend` |
| `medichat-cloudflared-1` | `cloudflare/cloudflared` | — | `medichat_default` | Đường hầm của medichat |

Tất cả cổng đều bind **loopback**, không có cổng nào mở ra Internet. Tường lửa chỉ mở 80/443/22.

```bash
# Xem nhanh
docker ps --format '{{.Names}}|{{.Ports}}'
for c in facebeo-app-1 medichat-backend-1 medichat-cloudflared-1; do
  echo -n "$c: "; docker inspect $c -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
done
```

### 1.2 Đường vào từ Internet

```
Người dùng VN ──HTTPS──> Caddy (VPS:443) ──> 127.0.0.1:3100 ──> facebeo-app-1:3000
                            │
                            ├── import /etc/caddy/vn-ips.caddy   (chỉ dải IP Việt Nam)
                            └── log /var/log/caddy/face.log      (fail2ban đọc)

Dự phòng: Cloudflare Tunnel ──> facebeo-app-1:3000   (đổi DNS về CNAME cũ là dùng lại)
```

- Cấu hình: `/etc/caddy/face.caddy`, được kéo vào bằng **một dòng** `import` trong `/opt/hermes/Caddyfile` (dòng 77) — không sửa
  phần của dự án khác. Bản gốc trong repo: `deploy/caddy-face.conf`.
- Chặn địa lý: `/etc/caddy/vn-ips.caddy` sinh bằng `deploy/vn-ip-refresh.sh`; chừa webhook Zalo và ACME.
- fail2ban jail `facebeo-login`: `logpath=/var/log/caddy/face.log`, `findtime=600`, `maxretry=30`, `bantime=900`,
  `ignoreip` có sẵn IP của chính VPS.

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy   # sau khi sửa Caddy
fail2ban-client status facebeo-login                                     # xem IP đang bị chặn
fail2ban-client set facebeo-login unbanip <IP>                           # gỡ chặn nhầm
```

### 1.3 Đường giữa hai app (phần của tài liệu này)

```
facebeo-app-1 ──[mạng facebeo-medichat]──> medichat-backend-1:8089
                 POST /api/v1/chat/stream
                 header X-Chat-Key: <khóa chung>
                 header X-Chat-Viewer: <vai trò + phòng ban người hỏi, JSON mã hóa URL>
```

Không đi qua Caddy, không ra Internet, không qua Cloudflare.

---

## 2. Thiết kế mạng Docker

### 2.1 Vì sao **không** dùng `medichat_default`

Cách nhanh nhất là cho `facebeo-app` tham gia `medichat_default` (compose khai `external: true`). Nó chạy, nhưng:

> Mọi container trong một mạng bridge của Docker **gọi được lẫn nhau bằng tên service**, không có tường lửa nội bộ.
> `medichat_default` chứa `medichat-cloudflared-1` — tiến trình có đường ra Internet của Cloudflare.
> Khi `facebeo-app` vào mạng đó, cloudflared của medichat **tới được `facebeo-app:3000`**.

Hậu quả: nếu cấu hình public hostname của tunnel medichat bị sửa (trên dashboard Cloudflare, không cần đụng VPS), sẽ có một
đường vào Face Beo **bỏ qua Caddy** ⇒ bỏ qua chặn IP Việt Nam **và** fail2ban. Đây là leo thang phạm vi âm thầm: không có
triệu chứng, không có log, mọi thứ vẫn "chạy đúng".

### 2.2 Mạng cầu nối riêng

Tạo **một lần**, ngoài compose (vì thuộc về cả hai dự án):

```bash
docker network create facebeo-medichat
```

Khai báo ở cả hai phía (`external: true` để không bên nào sở hữu/xóa nhầm):

```yaml
# deploy/docker-compose.yml  (Face Beo)
services:
  app:
    networks: [default, chatbot]
    environment:
      CHATBOT_API_URL: "http://backend:8089"
networks:
  chatbot:
    external: true
    name: facebeo-medichat

# ~/medichat/docker-compose.yml
services:
  backend:
    networks: [default, facebeo]
networks:
  facebeo:
    external: true
    name: facebeo-medichat
```

Vì compose gán **alias theo tên service** trên mọi mạng container tham gia, `medichat-backend-1` có alias `backend` trên mạng
cầu nối ⇒ `CHATBOT_API_URL=http://backend:8089` dùng được nguyên văn.

### 2.3 Kiểm chứng

```bash
# Phải in ra ĐÚNG hai tên, không dư
docker network inspect facebeo-medichat -f '{{range .Containers}}{{.Name}} {{end}}'
# → facebeo-app-1 medichat-backend-1

# Chiều ngược lại: mạng của medichat KHÔNG được chứa facebeo-app
docker network inspect medichat_default -f '{{range .Containers}}{{.Name}} {{end}}'
# → medichat-frontend-1 medichat-qdrant-1 medichat-cloudflared-1 medichat-backend-1
#   (không có facebeo-app-1 ⇒ cloudflared của medichat không gọi tới Face Beo được)
```

Lệnh trên là cách kiểm tra chắc chắn nhất: Docker chỉ cho phép phân giải tên **trong cùng một mạng**, nên chỉ cần
soát thành viên của từng mạng, không cần thử gọi từ bên trong container (nhiều image, ví dụ `cloudflared`, không có shell).

### 2.4 Rollback mạng

```bash
# Gỡ Face Beo khỏi mạng cầu nối (tính năng chat bot sẽ báo 502, phần còn lại chạy bình thường)
docker network disconnect facebeo-medichat facebeo-app-1
# Nối lại
docker network connect facebeo-medichat facebeo-app-1
# Xóa hẳn mạng (chỉ khi cả hai đã rời)
docker network rm facebeo-medichat
```

> Lưu ý: `docker network connect` thủ công **mất khi container bị tạo lại**. Nguồn sự thật phải là compose của cả hai bên.

---

## 3. Khóa chung và biến môi trường

### 3.1 Biến

| Phía | Biến | Nằm ở | Ý nghĩa |
|---|---|---|---|
| Face Beo | `CHATBOT_API_URL` | `deploy/docker-compose.yml` (giá trị cố định `http://backend:8089`) | Địa chỉ nội bộ của chat bot |
| Face Beo | `CHATBOT_API_KEY` | `/opt/facebeo/.env` | Khóa gửi kèm ở header `X-Chat-Key` |
| medichat | `CHAT_API_KEY` | `/home/beodev/medichat/backend/.env` | Khóa bắt buộc để gọi `/api/v1/chat*` |
| medichat | `GEMINI_API_KEY` | như trên | Nhiều khóa, ngăn cách bằng dấu phẩy |
| medichat | `GEMINI_GENERATION_MODEL` | như trên (tùy chọn) | Model chính |
| medichat | `GEMINI_FALLBACK_MODELS` | như trên (tùy chọn) | Mặc định `gemini-3.5-flash,gemini-2.5-flash` |
| medichat | `CHAT_RATE_PER_MINUTE` | như trên (tùy chọn) | Hạn mức theo IP cho **khách lạ** (mặc định 20) |

### 3.2 Cài lần đầu

```bash
KEY=$(openssl rand -hex 32)
grep -q '^CHATBOT_API_KEY=' /opt/facebeo/.env || printf 'CHATBOT_API_KEY=%s\n' "$KEY" >> /opt/facebeo/.env
grep -q '^CHAT_API_KEY='   /home/beodev/medichat/backend/.env || printf 'CHAT_API_KEY=%s\n' "$KEY" >> /home/beodev/medichat/backend/.env
chown beodev:beodev /home/beodev/medichat/backend/.env
unset KEY
```

### 3.3 Đối chiếu mà không lộ khóa

```bash
a=$(grep '^CHATBOT_API_KEY=' /opt/facebeo/.env | cut -d= -f2)
b=$(grep '^CHAT_API_KEY=' /home/beodev/medichat/backend/.env | cut -d= -f2)
[ "$a" = "$b" ] && echo "hai bên KHỚP" || echo "hai bên KHÁC NHAU"
unset a b
```

### 3.4 Xoay khóa

```bash
KEY=$(openssl rand -hex 32)
sed -i "s|^CHATBOT_API_KEY=.*|CHATBOT_API_KEY=$KEY|" /opt/facebeo/.env
sed -i "s|^CHAT_API_KEY=.*|CHAT_API_KEY=$KEY|"      /home/beodev/medichat/backend/.env
unset KEY
cd /home/beodev/medichat && docker compose up -d --force-recreate backend
cd /opt/facebeo/src && docker compose -f deploy/docker-compose.yml -p facebeo --env-file /opt/facebeo/.env up -d --force-recreate app
```

Quên một bên: Face Beo trả **502 "Chat bot từ chối khóa truy cập"**, không mất dữ liệu, các tính năng khác không ảnh hưởng.
Khóa rỗng ở medichat: `/api/v1/chat*` **mở cho mọi người** và backend in cảnh báo lúc khởi động:

```bash
docker logs medichat-backend-1 2>&1 | grep 'CHAT_API_KEY trống'
```

---

## 4. Hợp đồng giữa hai ứng dụng

### 4.1 Endpoint của medichat

| Endpoint | Dùng khi | Trả về |
|---|---|---|
| `POST /api/v1/chat` | Bản cũ / dự phòng khi luồng không khả dụng | JSON `{reply_text, sources[]}` |
| `POST /api/v1/chat/stream` | Mặc định từ v1.18.0 | SSE: `sources` → `chunk`* → `done`, hỏng thì `error` |
| `GET /static/images/...` | Ảnh minh họa | Ảnh (do backend phục vụ, vẫn công khai — xem §9.12) |

Cả hai endpoint chat đều đi qua `_chat_guard`: bắt buộc `X-Chat-Key` khi `CHAT_API_KEY` được đặt; **có khóa hợp lệ thì bỏ
qua bộ đếm theo IP** (`_chat_rate_guard`), vì mọi nhân viên đi chung một container.

Thân yêu cầu: `{ message: str, attachments: [{data: base64, mime_type}], history: [{role: "user"|"ai", content}] }`.

Header `X-Chat-Viewer` (từ 25/09/2026): `encodeURIComponent(JSON.stringify({ role, dept }))`, lấy từ `AuthUser.role` và tên
phòng ban của người hỏi (`chatbotViewer` trong `src/lib/chatbot.ts`). medichat dùng nó để chỉ tìm trong tài liệu người hỏi được
xem ở các kho hạn chế (quy chế, mô tả công việc — mỗi file khai báo `ai_duoc_xem` trong danh mục khi nạp). medichat **chỉ tin**
header này khi đi kèm `X-Chat-Key` đúng; thiếu header thì chỉ thấy tài liệu công khai (`all`). Header phải là ASCII nên tên phòng
tiếng Việt được mã hóa URL. Đổi tên phòng ban trong Face Beo thì phải sửa danh mục quyền xem bên medichat rồi nạp lại file.

### 4.2 Endpoint của Face Beo (trình duyệt gọi)

| Endpoint | Việc |
|---|---|
| `POST /api/me/chatbot/ask/stream` | Đường chính: kiểm quyền → hạn mức → chuyển tiếp SSE |
| `POST /api/me/chatbot/ask` | Hỏi một lần (giữ cho tương thích / máy yếu) |
| `GET /api/me/chatbot/ask` | Số lượt đã dùng hôm nay |
| `GET /api/me/chatbot/static/[...path]` | Lấy hộ ảnh minh họa |

Sự kiện SSE mà **trình duyệt** nhận, thứ tự cố định: `sources` → `used` → `chunk`* → `done` (hoặc `error`).
Face Beo tự sinh `used`; `sources` được viết lại `image_url` sang `/api/me/chatbot/static/...` trước khi phát.

### 4.3 Ánh xạ lỗi upstream → lỗi cho người dùng

| medichat trả | Face Beo trả | Thông báo |
|---|---|---|
| 429 | 429 | "Chat bot đang bận, chờ một chút rồi hỏi lại nhé." |
| 401 / 403 | 502 | "Chat bot từ chối khóa truy cập — báo Quản trị kiểm tra cấu hình." |
| 422 | 400 | "Câu hỏi quá dài hoặc ảnh quá lớn — rút gọn rồi gửi lại." |
| 404 / 405 trên `/chat/stream` | — | Tự quay về `POST /api/v1/chat` (không báo lỗi) |
| khác (500, 503…) | 502 | "Chat bot trả lời lỗi. Thử lại sau ít phút." |
| thân không phải JSON | 502 | như trên |
| không kết nối được | 502 | "Không gọi được Chat bot (máy chủ chat bot đang tắt?)" |

Chi tiết lỗi gốc **chỉ nằm trong log**; không bao giờ trả xuống trình duyệt.

---

## 5. Phía Face Beo — mã nguồn

| Tệp | Nội dung |
|---|---|
| `src/lib/chatbot.ts` | Quyền dùng (`chatbotInfo`, `assertChatbotAllowed`), hạn mức (`takeDailySlot`, `bumpUsage`), người hỏi (`chatbotViewer` → header `X-Chat-Viewer`), gọi upstream (`askChatbot`, `askChatbotStream`), lấy ảnh (`fetchChatbotImage`), hook test (`__setChatbotTestHooks`) |
| `src/lib/client/chatbot-text.ts` | `rewriteImagePaths` / `rewriteImageUrl` — dùng chung server và trình duyệt |
| `src/app/api/me/chatbot/ask/schema.ts` | zod schema dùng chung hai route |
| `src/app/api/me/chatbot/ask/stream/route.ts` | Đọc SSE upstream, phát lại, giữ/hoàn lượt, ping 15 s |
| `src/app/api/me/chatbot/static/[...path]/route.ts` | Proxy ảnh, lọc đường dẫn + `Content-Type` |
| `src/app/me/chatbot/` | `page.tsx` (màn hình chat), `markdown.tsx` (render an toàn), `knowledge.ts` (gợi ý chuyên khoa), `layout.tsx` (chặn ở máy chủ) |
| `prisma/schema.prisma` | `Department.chatbotEnabled`, `Employee.chatbotEnabled`, model `ChatbotUsage` |

### 5.1 Thứ tự kiểm tra trong route (không được đổi)

```
requireUser            → 401 nếu chưa đăng nhập / phiên bị thu hồi / là phiên kiosk
assertChatbotAllowed   → 403 nếu phòng tắt và người không được bật riêng
parseJson(askSchema)   → 400 nếu câu quá dài, >3 ảnh, tổng ảnh >12 MB, history >10
rateLimit(chatbot:<id>)→ 429 (10 câu/phút, bộ đếm trong RAM)
takeDailySlot          → 429 nếu đã đủ 100 câu/ngày; nếu còn thì CỘNG TRƯỚC
askChatbotStream       → gọi upstream; lỗi ⇒ slot.refund() rồi ném tiếp
```

Cộng trước rồi mới gọi là có chủ đích: kiểm-rồi-mới-cộng để lọt nhiều tab hỏi song song (đo thực tế: ở mức 99/100, 5 tab
cùng lúc lọt cả 5, tổng thành 104).

### 5.2 Quy tắc hoàn lượt

| Tình huống | Hoàn lượt? |
|---|---|
| Lỗi trước khi nhận `chunk` đầu tiên (upstream 5xx, mạng đứt, luồng rỗng, sự kiện `error`) | **Có** |
| Đứt / lỗi sau khi đã phát được chữ | Không (đã tốn tiền gọi AI) |
| Người dùng bấm Dừng hoặc rời trang trước khi có chữ | **Có** (qua `cancel()` của stream) |
| Ngày ghim lúc giữ chỗ | Hoàn đúng ngày đó, kể cả khi đã qua nửa đêm |

### 5.3 Quyền

`Department.chatbotEnabled` (bool) + `Employee.chatbotEnabled` (bool?, `null` = theo phòng, cấu hình người **thắng** phòng).
Năng lực cấp phát: `chatbot.grant` (mặc định HR + ADMIN). Vì `ensureDefaultPermissions` có chốt sentinel (không tự nạp
capability mới vào DB đang chạy), migration `20260924120357_chatbot` chèn thẳng:

```sql
INSERT OR IGNORE INTO "RolePermission" ("role","capability") VALUES ('HR','chatbot.grant');
```

---

## 6. Phía medichat — mã nguồn

Một tệp `backend/main.py`. Các hàm liên quan:

| Hàm | Việc |
|---|---|
| `_require_chat_key(req) -> bool` | So sánh `X-Chat-Key` bằng `secrets.compare_digest`; trả `True` nếu là ứng dụng nội bộ |
| `_chat_guard(req)` | Gọi hàm trên; **không** phải nội bộ thì mới `_chat_rate_guard(client_ip(req))` |
| `_prepare_chat(request)` | Dùng chung: phân loại ý định → viết lại câu hỏi theo ngữ cảnh → truy hồi Qdrant → mở rộng trọn quy trình → dựng prompt + `sources`. Trả `(contents, sources, marks)` |
| `chat()` | `_prepare_chat` → `generate_content` → JSON |
| `chat_stream()` | `_prepare_chat` → phát `sources` → `generate_content_stream` → từng `chunk` → `done` |
| `_log_timing(marks, t_prepare, t_end, t_first)` | Dòng `[TIMING]`, có mốc **chữ đầu** |
| `GeminiKeyPool._run(fn)` | Vòng đổi khóa: 429/`RESOURCE_EXHAUSTED` → nghỉ theo "retry in Xs"; 401/403 → nghỉ 1 giờ; **503/500 → nghỉ 20 s** rồi thử khóa kế |
| `GeminiKeyPool.generate_content_stream` | Lấy sẵn mẩu đầu (`next(stream)`) để lỗi lộ ra kịp đổi khóa, rồi `itertools.chain` trả luồng |
| `_try_models(call)` | Model chính quá tải → lần lượt `GEMINI_FALLBACK_MODELS` |

Thứ tự chịu lỗi khi Gemini hỏng: **đổi khóa trước** (cùng model) → **hết khóa mới đổi model**.

```
POST /api/v1/chat/stream
  └─ _chat_guard ──(nội bộ)──> bỏ rate-limit theo IP
  └─ _prepare_chat ─> Qdrant (~1 s)
  └─ SSE: sources
  └─ _try_models ─> GeminiKeyPool._run ─> generate_content_stream
        ├─ 503 key#2 → nghỉ 20 s → key#3
        ├─ 503 key#3 → hết khóa → model dự phòng
        └─ ok → chunk, chunk, …
  └─ SSE: done + [TIMING] … chữ đầu 17.06s | tổng 19.76s
```

---

## 7. Quy trình triển khai

Hai dự án có **cách phát hành khác nhau**. Thứ tự đúng: **medichat trước, Face Beo sau** (Face Beo có nhánh dự phòng khi
upstream chưa có `/chat/stream`, nhưng ngược lại thì không).

### 7.1 medichat (repo private, đẩy bằng `git archive`)

```bash
# Máy dev (Git Bash, thư mục repo medichat)
cd "D:/RAG VER2 GG"
backend/venv/Scripts/python.exe -m unittest discover -s backend/tests   # BẮT BUỘC: bắt lỗi thụt lề, lỗi import
git archive HEAD backend/main.py backend/tests/test_security.py \
  | ssh root@103.142.27.210 "tar -x -C /home/beodev/medichat \
      && chown -R beodev:beodev /home/beodev/medichat/backend/main.py /home/beodev/medichat/backend/tests \
      && cd /home/beodev/medichat && docker compose up -d --build backend"
```

Chỉ đẩy đúng tệp cần thiết — `git archive HEAD` không kèm `.env`, `data/`, `static/images/`.
`chown` vì container chạy với `user: ${UID:-1000}:${GID:-1000}` (tức `beodev`).

### 7.2 Face Beo (qua GitHub + tag)

```bash
# Máy dev
npm run lint && npm run typecheck && npx vitest run && npm run build
git tag -a v1.x.y -m "…" && git push origin main && git push origin v1.x.y

# VPS
ssh root@103.142.27.210 "sh /opt/facebeo/src/deploy/update.sh v1.x.y"
```

`deploy/update.sh` làm: `git fetch --tags --force` → `git checkout <tag>` → `compose build app` → `compose up -d` →
`compose up -d --force-recreate backup` → chờ `/login` trả 200 (tối đa 3 phút). Migration Prisma tự áp lúc container khởi động.

### 7.3 Kiểm tra sau triển khai

```bash
# 1) App sống
curl -s -o /dev/null -w '%{http_code}\n' https://face.ydsg.website/login     # 200

# 2) Chat bot đã khóa với người ngoài
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://medichat.ydsgchatbot.io.vn/api/v1/chat \
  -H 'content-type: application/json' -d '{"message":"test"}'                # 401

# 3) Mạng cầu nối đúng 2 container
docker network inspect facebeo-medichat -f '{{range .Containers}}{{.Name}} {{end}}'

# 4) Đường nội bộ có khóa → đo luôn thời gian và số mẩu chữ
docker exec facebeo-app-1 sh -c 'S=$(date +%s%3N);
  curl -sN --max-time 180 -X POST http://backend:8089/api/v1/chat/stream \
    -H "content-type: application/json" -H "X-Chat-Key: $CHATBOT_API_KEY" \
    -d "{\"message\":\"Rua tay thuong quy co may buoc?\"}" > /tmp/s.txt;
  E=$(date +%s%3N);
  echo "tong $(( (E-S)/1000 ))s | mau chu: $(grep -c "event: chunk" /tmp/s.txt) | loi: $(grep -c "event: error" /tmp/s.txt)";
  rm -f /tmp/s.txt'

# 5) Migration + quyền đã vào DB (đọc chỉ-đọc, không khóa DB đang chạy)
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('file:/opt/facebeo/data/facebeo.db?mode=ro', uri=True); c = db.cursor()
cols = lambda t: [r[1] for r in c.execute(f'PRAGMA table_info({t})')]
print('Department.chatbotEnabled:', 'chatbotEnabled' in cols('Department'))
print('Employee.chatbotEnabled  :', 'chatbotEnabled' in cols('Employee'))
print('quyền chatbot.grant      :', [r[0] for r in c.execute("SELECT role FROM RolePermission WHERE capability='chatbot.grant'")])
print('migration mới nhất       :', c.execute("SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1").fetchone()[0])
db.close()
PY
```

---

## 8. Vận hành & chẩn đoán

### 8.1 Đọc nhật ký

```bash
docker logs --tail 50 medichat-backend-1 2>&1 | grep -E 'TIMING|GEMINI|ERROR'
docker logs --tail 100 facebeo-app-1 2>&1 | tail -30
```

Dòng `[TIMING]` là công cụ chẩn đoán chính:

```
[TIMING] intent 0.00s | retrieve 0.94s | expand 0.04s | generate 18.88s | chữ đầu 17.06s | tổng 19.76s | ngữ cảnh 8037 ký tự
```

| Mốc | Ý nghĩa | Bất thường khi |
|---|---|---|
| `retrieve` | Truy hồi Qdrant | > 3 s ⇒ xem Qdrant / kích thước collection |
| `generate` | Toàn bộ thời gian Gemini | — |
| `chữ đầu` | Người dùng chờ bao lâu mới thấy chữ | Gần bằng `generate` ⇒ model "suy nghĩ" lâu, cân nhắc đổi model |
| `ngữ cảnh` | Số ký tự prompt | Rất lớn ⇒ tốn tiền, chậm |

### 8.2 Kiểm tra quyền của một nhân viên

```bash
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('file:/opt/facebeo/data/facebeo.db?mode=ro', uri=True); c = db.cursor()
for code, name, dept, emp_flag, dept_flag in c.execute("""
  SELECT e.code, e.name, d.name, e.chatbotEnabled, d.chatbotEnabled
  FROM Employee e JOIN Department d ON d.id = e.departmentId WHERE e.active = 1 ORDER BY e.code"""):
    allowed = emp_flag if emp_flag is not None else dept_flag
    print(f"{code:7s} {name[:22]:24s} {dept[:20]:22s} {'DÙNG ĐƯỢC' if allowed else '—'}")
db.close()
PY
```

Kết quả có dạng:

```
AD01    BEO                      Ban Giám đốc           DÙNG ĐƯỢC
NV003   CAO NGỌC LONG            Khoa Khám bệnh         —
NV005   HUỲNH THỊ THU TƯ         Kế toán                DÙNG ĐƯỢC
```

### 8.3 Xem mức dùng trong ngày

```bash
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('file:/opt/facebeo/data/facebeo.db?mode=ro', uri=True)
for day, code, n in db.execute("""
  SELECT u.day, e.code, u.count FROM ChatbotUsage u JOIN Employee e ON e.id = u.employeeId
  ORDER BY u.day DESC, u.count DESC LIMIT 15"""):
    print(day, code, n)
db.close()
PY
```

### 8.4 Kiểm tra sức khỏe Gemini

```bash
docker exec medichat-backend-1 python - <<'PY'
import os
from google import genai
for i, k in enumerate([x.strip() for x in (os.getenv('GEMINI_API_KEY') or '').split(',') if x.strip()], 1):
    try:
        genai.Client(api_key=k).models.generate_content(model=os.getenv('GEMINI_GENERATION_MODEL','gemini-3.5-flash-lite'), contents='ping')
        print(f'khóa #{i}: OK')
    except Exception as e:
        print(f'khóa #{i}: {getattr(e, "code", "?")} {str(e)[:70]}')
PY
```

Ba mã lỗi hay gặp, **ba nguyên nhân khác nhau**:

| Mã | Nghĩa | Xử lý |
|---|---|---|
| 429 / `RESOURCE_EXHAUSTED` | Hết hạn mức miễn phí theo phút/ngày | Pool tự nghỉ và đổi khóa |
| 402 `prepayment credits are depleted` | **Hết tiền trả trước** của khóa đó | Nạp tiền ở AI Studio, hoặc bỏ khóa khỏi `GEMINI_API_KEY` |
| 503 `UNAVAILABLE` | Model quá tải phía Google | Pool đổi khóa (20 s) → hết khóa thì đổi model |

---

## 9. Sự cố đã gặp và cách xử lý

### 9.1 Mạng chung làm lộ app qua cloudflared của dự án khác

- **Phát hiện**: rà soát trước khi phát hành (không có triệu chứng).
- **Chẩn đoán**: `docker network inspect medichat_default -f '{{range .Containers}}{{.Name}} {{end}}'` → thấy cả `cloudflared`.
- **Xử lý**: mạng cầu nối riêng (§2.2), bỏ `external: medichat_default` khỏi compose Face Beo.
- **Phòng ngừa**: sau mỗi lần đổi mạng, chạy lại lệnh liệt kê ở §2.3.

### 9.2 Hạn mức theo IP biến thành hạn mức chung

- **Triệu chứng**: cả phòng khám bị giới hạn chung 20 câu/phút (chưa kịp xảy ra, phát hiện lúc review).
- **Nguyên nhân**: `_chat_rate_guard(client_ip(...))` thấy mọi lượt hỏi đến từ một IP — IP của `facebeo-app-1` trong mạng docker.
- **Xử lý**: `_chat_guard` bỏ qua rate-limit theo IP khi có `X-Chat-Key` hợp lệ; Face Beo giới hạn theo `employeeId`.
- **Bài học**: sau khi đặt một dịch vụ ra sau proxy, rà lại **mọi** logic dựa trên IP (rate limit, fail2ban, nhật ký, chống gian lận).

### 9.3 Chuyển tiếp SSE bằng `String.includes` trên từng gói TCP

- **Triệu chứng** (do QC tái hiện): mất nguyên mẩu chữ; câu trả lời đúng nhưng kèm `⚠️ Chat bot trả lời lỗi`; hỏi mãi không bị trừ lượt.
- **Nguyên nhân**: mã cũ `text.includes("event: chunk")` trên từng `reader.read()` rồi chèn `event: used` ngay sau gói đó.
  Ranh giới gói TCP không trùng ranh giới sự kiện SSE ⇒ chuỗi bị cắt (`event: chu` | `nk\ndata:…`) hoặc `used` bị chèn vào
  giữa JSON còn dở. Thêm nữa, `new TextDecoder()` tạo mới mỗi vòng, không `{stream:true}` ⇒ ký tự UTF-8 bị cắt thành `\uFFFD`.
- **Xử lý**: đọc–phân tích–phát lại. Một `TextDecoder` với `{stream:true}`, gom `buffer`, `split("\n\n")`, chỉ xử lý sự kiện
  trọn vẹn, phần dở giữ lại; `used` phát trước `chunk` đầu tiên.
- **Phòng ngừa**: test tiêm luồng cắt vụn theo nhiều kiểu (cắt giữa JSON, giữa `event:`/`data:`, giữa chữ `event: chunk`,
  mỗi byte một gói) — `tests/integration/qc-chatbot-stream.test.ts`.

### 9.4 Báo lỗi hai lần

- **Triệu chứng**: một lỗi upstream, hai dòng cảnh báo.
- **Nguyên nhân**: `fail()` chạy cả khi nhận sự kiện `error` lẫn khi luồng đóng mà `!sawChunk`.
- **Xử lý**: cờ `failed` — chỉ báo một lần. Phát hiện bởi test, không phải bằng mắt.

### 9.5 Lỗi thụt lề Python mà `ast.parse` không bắt

- **Triệu chứng**: `python -c "import ast; ast.parse(...)"` báo OK, nhưng container không khởi động nổi.
- **Nguyên nhân**: tách `_prepare_chat` ra khỏi thân `chat()` làm lệch 4 dấu cách ⇒ `return` nằm ngoài hàm.
  `ast.parse` **không** kiểm tra ngữ nghĩa này; `compile()` thì có.
- **Xử lý / phòng ngừa**:

```bash
python -c "import io; compile(io.open('backend/main.py',encoding='utf-8').read(),'m','exec'); print('OK')"
backend/venv/Scripts/python.exe -m unittest discover -s backend/tests   # chắc chắn hơn: nạp app thật
```

### 9.6 `npm ci` hỏng trên VPS vì lock sinh bằng npm phiên bản khác

- **Triệu chứng**: `docker build` dừng ở bước `RUN npm ci` với `EUSAGE … Missing: @emnapi/core@… from lock file`.
- **Nguyên nhân**: máy dev dùng Node 25/npm 11, image dùng `node:22-bookworm-slim` (npm 10). Lock do npm 11 sinh thiếu mục npm 10 đòi.
- **Xử lý**: sinh lại lock **trong đúng image**:

```powershell
docker run --rm -v "D:\FACE BEO:/app" -w /app node:22-bookworm-slim `
  npm install --package-lock-only --no-audit --no-fund --ignore-scripts
```

```bash
npm ci --dry-run --no-audit --no-fund --ignore-scripts   # xác nhận trước khi commit
```

- **Phòng ngừa**: ghi quy tắc này vào `CLAUDE.md`; khi đổi phụ thuộc thì luôn sinh lock bằng Node 22.

### 9.7 `update.sh` dừng im lặng, không in gì

- **Triệu chứng**: chạy `sh deploy/update.sh v1.x.y`, không output, app vẫn bản cũ.
- **Nguyên nhân**: tag bị dời (vá lỗi trước khi phát hành) ⇒ `git fetch --tags` từ chối ghi đè, lỗi stderr bị nuốt, `set -e` dừng script trước dòng `echo` đầu tiên.
- **Xử lý**: `git fetch --tags --force --quiet` trong `deploy/update.sh`. Tạm thời có thể chữa bằng tay:

```bash
cd /opt/facebeo/src && git fetch --tags --force && sh deploy/update.sh v1.x.y
```

- **Bài học**: script triển khai nên in trạng thái **ngay dòng đầu**, và cân nhắc `set -x` khi chạy tay.

### 9.8 Lịch sử chat dùng chung trên máy dùng chung

- **Nguyên nhân**: khóa `localStorage` cố định `facebeo.chatbot.v1`.
- **Xử lý**: khóa theo `employeeId`; `logout()` xóa mọi khóa `facebeo.chatbot.*`; đọc dữ liệu cũ có kiểm tra định dạng, và có trần dung lượng.

### 9.9 Hoàn lượt sai ngày khi qua nửa đêm

- **Nguyên nhân**: `releaseUsage` gọi lại `todayVN()` lúc hoàn.
- **Xử lý**: `takeDailySlot` ghim `day` lúc giữ chỗ, truyền xuống cả `bumpUsage` và `releaseUsage`.
- **Nguyên tắc chung**: thao tác bù trừ phải mang theo bối cảnh lúc phát sinh (ngày, tỉ giá, hệ số, người phụ trách).

### 9.10 Menu không hiện sau khi cấp quyền

- **Chẩn đoán**: kiểm tra DB (§8.2) thấy cờ đã đúng ⇒ vấn đề ở trình duyệt.
- **Nguyên nhân**: Next.js App Router đã prefetch layout `/me` trước khi cờ đổi.
- **Xử lý**: tải lại trang / đăng xuất vào lại. Tài liệu người dùng ghi rõ điều này.

### 9.11 Gemini 503 và 402

Xem §8.4. Sau khi thêm hai lớp dự phòng, nhật ký một lượt hỏi thành công có dạng:

```
🔑 [GEMINI] key #2 gặp model quá tải, nghỉ 20s → dùng key #3
🔑 [GEMINI] key #3 gặp model quá tải, nghỉ 20s
⚠️ [GEMINI] model gemini-3.5-flash-lite đang quá tải (503) → thử gemini-3.5-flash
[TIMING] … generate 18.88s | chữ đầu 17.06s | tổng 19.76s
```

### 9.12 Proxy ảnh tin `Content-Type` của upstream

- **Nguyên nhân**: chuyển tiếp nguyên header ⇒ upstream trả `image/svg+xml` hoặc `text/html` thì trình duyệt có thể chạy mã trong ngữ cảnh Face Beo.
- **Xử lý**: chỉ nhận `image/png|jpeg|jpg|webp|gif`, kèm `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=600`;
  lọc đường dẫn (`[A-Za-z0-9._-]` mỗi đoạn, cấm `.`/`..`, ≤ 8 đoạn, ≤ 300 ký tự).
- **Còn hở đã ghi nhận**: `https://medichat…/static/images/*` vẫn công khai vì do chính backend phục vụ (không nằm sau khóa).
  Đó là hình minh họa quy trình trong tài liệu Bộ Y tế, không chứa dữ liệu nhân sự. Từ 25/09/2026 trang chủ và `/admin` của
  medichat trả **502** vì frontend đã tắt; chỉ `/api/*` (có khóa) và `/static/*` còn sống.

### 9.13 Vitest báo `database is locked`

- **Nguyên nhân**: hai tiến trình vitest cùng chạy trên `data/test.db` (ví dụ agent QC chạy song song).
- **Xử lý**: chạy tuần tự; test tích hợp của dự án này dùng chung một tệp SQLite.

### 9.14 Prisma: `Argument gte: Invalid value provided. Expected DateTime, provided Int`

- **Nguyên nhân**: `AuditLog.createdAt` trong schema này là số (epoch ms) ở tầng ứng dụng nhưng Prisma kiểu `DateTime`.
- **Xử lý**: trong test, lọc bằng `orderBy: { id: "desc" }, take: N` thay vì so sánh thời gian.

---

## 10. Rollback

| Mức | Lệnh | Ảnh hưởng |
|---|---|---|
| Quay về bản Face Beo trước | `sh /opt/facebeo/src/deploy/update.sh v1.17.0` | Chat bot mất chế độ luồng, vẫn hỏi được (route cũ) |
| Tắt tính năng chat bot | Bỏ tích "Được dùng Chat bot" ở tất cả phòng, hoặc `docker network disconnect facebeo-medichat facebeo-app-1` | Menu biến mất / route trả 502 |
| Mở lại chat bot cho công chúng | Xóa dòng `CHAT_API_KEY=` khỏi `~/medichat/backend/.env` rồi recreate backend | **Chỉ làm khi có chủ đích** — link công khai dùng lại được |
| Quay về đường Cloudflare Tunnel | Đổi DNS `face.ydsg.website` về CNAME tunnel | Chậm hơn ~10 lần, nhưng không phụ thuộc Caddy |
| Khôi phục dữ liệu | `deploy/restore-offsite.sh` (bản mã hóa trên Cloudflare R2, 03:30 hằng ngày) | Xem `DEPLOY-VPS.md` |

Ghi chú: `git checkout <tag>` trong `update.sh` là thao tác thuận nghịch, và migration Prisma của tính năng này chỉ **thêm cột**
(`ALTER TABLE … ADD COLUMN`) nên bản cũ vẫn chạy được trên DB mới.

---

## 11. Checklist phát hành

- [ ] `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` — xanh (Face Beo)
- [ ] `python -m unittest discover -s backend/tests` — xanh (medichat)
- [ ] Lock file sinh bằng Node 22 nếu có đổi phụ thuộc (§9.6)
- [ ] Đẩy medichat **trước**, Face Beo sau (§7)
- [ ] `docker network inspect facebeo-medichat` — đúng 2 container
- [ ] Gọi thẳng `/api/v1/chat` từ Internet — 401
- [ ] Hỏi qua đường nội bộ có khóa — có `event: chunk`, `event: done`
- [ ] `https://face.ydsg.website/login` — 200
- [ ] Migration + `chatbot.grant` có trong DB (§7.3 mục 5)
- [ ] Tab Network của trình duyệt — không thấy tên miền medichat, không thấy khóa
- [ ] Tài khoản chưa cấp quyền — không thấy menu **và** gọi thẳng API trả 403

---

## 12. Phụ lục

### 12.1 Đường dẫn

| Thứ | Ở đâu |
|---|---|
| Mã nguồn Face Beo trên VPS | `/opt/facebeo/src` (git checkout theo tag) |
| Dữ liệu Face Beo | `/opt/facebeo/data` (DB, snapshots, credentials, avatars, photos) |
| Cấu hình Face Beo | `/opt/facebeo/.env` |
| Mã nguồn medichat | `/home/beodev/medichat` (đẩy bằng `git archive`) |
| Cấu hình medichat | `/home/beodev/medichat/backend/.env` |
| Ảnh tài liệu medichat | `/home/beodev/medichat/backend/static/images` |
| Caddy | `/opt/hermes/Caddyfile` (import), `/etc/caddy/face.caddy`, `/etc/caddy/vn-ips.caddy` |
| Log Caddy cho fail2ban | `/var/log/caddy/face.log` |

### 12.2 Hằng số hạn mức (Face Beo)

`src/lib/chatbot.ts`: `CHAT_PER_MINUTE = 10`, `CHAT_PER_DAY = 100`, `MAX_ATTACHMENTS = 3`,
`MAX_ATTACHMENT_BYTES = 10 MB`, `MAX_ATTACHMENT_TOTAL_BYTES = 12 MB`, `MAX_MESSAGE_CHARS = 4000`.

### 12.3 Bộ test liên quan

| Tệp | Bao gồm |
|---|---|
| `tests/integration/chatbot.test.ts` | Quyền, khóa gửi đi, giới hạn, proxy ảnh, không lưu nội dung |
| `tests/integration/qc-chatbot.test.ts` | Ca đối nghịch: phiên/kiosk/thu hồi phiên, ranh giới hạn mức, 18 đường dẫn ảnh độc hại |
| `tests/integration/chatbot-stream.test.ts` | Luồng SSE: thứ tự sự kiện, quay về hỏi một lần, hoàn lượt |
| `tests/integration/qc-chatbot-stream.test.ts` | Luồng cắt vụn, đua hạn mức, không lộ bí mật, không lưu nội dung |
| `backend/tests/test_security.py` | Phiên admin, giới hạn, khóa `X-Chat-Key`, SSE, đổi khóa/model khi quá tải |
