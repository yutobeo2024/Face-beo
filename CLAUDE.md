# Face Beo — ngữ cảnh cho Claude Code

Đọc file này trước khi làm bất cứ việc gì. Chi tiết bàn giao máy: `docs/HANDOFF.md`.

## Dự án
- Web app quản trị nhân sự cho ~100 nhân viên: xếp ca, chấm công khuôn mặt trên tablet kiosk (InsightFace w600k_r50 + liveness
  MiniFASNetV2 phía server), đơn từ, tính công/chốt công tháng, xuất Excel, thông báo Zalo OA (nhiều nhóm theo loại tin: minh bạch / chấm công / đơn từ + tin riêng).
- Stack: Next.js 15 App Router, Prisma 6 (SQLite WAL), zod 4, luxon, exceljs, node-cron, jose JWT (HS256, 7 ngày, `sessionVersion`),
  vitest 4 (test tích hợp gọi thẳng route handler, DB `data/test.db`).
- Phiên bản hiện tại: **v1.18.0** (tag GitHub `v1.18.0`, repo `yutobeo2024/Face-beo`). Phiên bản ghi trong prose (README, PRD,
  OPEN-DECISIONS), không có CHANGELOG; `package.json` version không dùng để đánh số.

## Lệnh
```bash
npm install                      # postinstall: prisma generate + copy models
npm run models:face && npm run models:liveness   # tải .onnx nếu chưa có trong models/
npm run db:deploy                # áp migration (KHÔNG dùng migrate reset trên DB thật)
npm run db:seed:base             # DB trống: chỉ ca/mẫu tuần/ngày lễ/quyền, không NV, chạy lại được
npm run admin:create -- --code AD01 --name "…" --phone 09…   # Quản trị đầu tiên; --reset <mã> cấp lại mật khẩu
npm run db:seed                  # dữ liệu mẫu demo: XÓA SẠCH; tự dừng nếu DB có NV/ca (ép: db:seed:force)
npm run build && LIVENESS_SERVER=true npx next start -p 3000
npm test | npm run lint | npm run typecheck
```
Server production: **https://face.ydsg.website** trên VPS `root@103.142.27.210` (từ 21/09/2026). Từ v1.16.0 đi **thẳng** qua Caddy trên VPS
(`deploy/caddy-face.conf`, app mở `127.0.0.1:3100`, chặn ngoài VN + fail2ban); Cloudflare Tunnel giữ làm dự phòng (xem `docs/DEPLOY-VPS.md`;
cập nhật bằng `deploy/update.sh`). VPS chạy chung dự án khác — không đụng Caddy/ufw/container khác. Máy local chỉ để phát triển: **không**
chạy cron / khóa Zalo thật song song với VPS (refresh token Zalo dùng một lần) — `.env` local đã tắt Zalo + `DISABLE_CRON=true`
(bản đủ khóa cũ: `.env.pre-vps.bak`, không commit). Dữ liệu thật nằm ở VPS `/opt/facebeo/data`; test local vẫn dùng `data/test.db`.

## Cách làm việc đã thống nhất với chủ dự án (tiếng Việt)
- Chạy liền mạch, **không dừng hỏi xác nhận từng bước**; chỉ hỏi khi lựa chọn làm khác hẳn kết quả hoặc thao tác phá hủy/ra ngoài.
- Mỗi tính năng: lên plan ngắn → làm → **song song 1 agent review + 1 agent QC** (agent không tạo worktree, không đụng
  `node_modules`) → lint + typecheck + toàn bộ vitest xanh → build → cập nhật tài liệu → commit (tiếng Việt, có
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`) → push → tag `v1.x.y` khi phát hành → cập nhật VPS: `ssh root@103.142.27.210 "sh /opt/facebeo/src/deploy/update.sh v1.x.y"`
  (chờ `/login` 200; kiểm tra `https://face.ydsg.website`).
- Giải thích bằng tiếng Việt, có ví dụ số cụ thể; quy tắc công/lương phải **cấu hình được** (theo ca, theo phòng), không hard-code.
- `package-lock.json`: image dựng bằng **Node 22 / npm 10**, máy local đang npm 11 → lock do npm 11 sinh làm `npm ci` trong Docker
  báo EUSAGE. Đụng vào phụ thuộc thì sinh lại lock bằng Node 22:
  `docker run --rm -v "D:\FACE BEO:/app" -w /app node:22-bookworm-slim npm install --package-lock-only --ignore-scripts`.
- Không commit `.env`, `data/`, `models/*.onnx`, `public/models/`; giữ nguyên `BIOMETRIC_KEY`; không bypass an toàn Prisma;
  không gửi tin Zalo thật hay đăng nhập tài khoản thật khi tự test; không in bí mật ra log/tài liệu.
- Tài liệu: cẩm nang HTML `docs/huong-dan-su-dung.html` (artifact https://claude.ai/artifact/EiMsP9AtirhXTiNUeKyPXz), Zalo OA
  `docs/zalo-oa.html` (artifact https://claude.ai/artifact/KwxtwjjshvwgYp8F9T64gh), đặc tả `docs/PRD-v2-Face-Beo.md` +
  `docs/PRD-v2.1-HR.md`, quyết định mở/đã chốt `docs/OPEN-DECISIONS.md`. Sửa tính năng thì cập nhật cẩm nang + PRD + republish.
  Cách nối Face Beo với chat bot medichat (logic, docker, luồng SSE, 12 sự cố đã gặp — viết cho người không chuyên):
  `docs/ket-noi-hai-webapp.html` (cho người không chuyên) + `docs/ket-noi-hai-webapp-ky-thuat.md` (lệnh, VPS/Docker,
  chẩn đoán, rollback). KHÔNG publish artifact hai tài liệu này (chủ dự án muốn giữ trong repo).

## Luật nghiệp vụ khóa cứng (đừng phá)
- Quyền: ma trận `CAPABILITIES` trong `src/lib/permissions.ts` (DB `RolePermission`, ADMIN luôn đủ quyền, quyền `locked` chỉ ADMIN).
  Phạm vi dữ liệu theo vai trò: `deptScope()` / `employeeScopeWhere()` trong `src/lib/auth.ts` (`{ id: -1 }` = không thấy gì; kết hợp bằng
  `AND`, không spread). Quản lý chỉ thấy/sửa phòng mình; luật chống leo thang ở `src/lib/employee-guards.ts`.
- Không tự duyệt đơn của mình; không tự đổi vai trò/tự khóa mình; HR không sửa tài khoản HR/ADMIN.
- Duyệt đơn: `approversFor(employeeId, status)` trong `src/lib/notify.ts` theo `Department.approvalMode` (MANAGER_OR_HR mặc định /
  TWO_STEP qua trạng thái `MANAGER_APPROVED` / MANAGER_ONLY). Đơn "còn chờ" = `OPEN_REQUEST_STATUSES` (`src/lib/roles.ts`) — thêm chỗ
  lọc đơn chờ mới thì dùng hằng này, đừng so `=== "PENDING"`. Chức danh/Chuyên khoa (`src/lib/catalogs.ts`) chỉ mô tả, không đụng quyền.
- Lịch sử là bất biến: không xóa cứng nhân viên/ca/mẫu tuần/phòng đã có dữ liệu (route DELETE chặn kèm lý do); "nghỉ việc" = `active=false`
  + xóa mẫu khuôn mặt + thu hồi phiên. Tháng đã chốt (`LockedDay`) không tính lại.
- Thay đổi cấu hình lịch của nhân viên chỉ có hiệu lực từ hôm nay (`ScheduleAssignment` snapshot). Ca cố định LUÔN có mẫu tuần trong Cấu hình
  (v1.12.1, `ensurePatternFor` trong `src/lib/work-patterns.ts`); ca mặc định chủ yếu cho nhóm xoay ca.
- Dữ liệu cá nhân (SĐT, CCCD, ngày sinh, giới tính, địa chỉ): chỉ vai trò HR/ADMIN + chính chủ (`canSeePersonal`/`maskPersonal`), không vào Zalo, nhật ký
  dùng `redactPersonal`. Tạo nhân viên qua `createEmployee` (`src/lib/employees.ts`); nhập Excel ở `src/lib/employee-import.ts`.
- Zalo: tin nhóm định tuyến theo `ZaloGroup.categories` (`src/lib/zalo-routing.ts`): MINH_BACH = `announce()` chỉ cho thao tác HR/ADMIN
  (trừ `always: true`); CHAM_CONG/DON_TU = `announceStaff()` tin nhân viên, **không** kèm lý do/ghi chú, lọc theo phòng. `sendZaloMessage`
  không bao giờ ném lỗi; mô phỏng khi thiếu cấu hình. Test: `tests/setup.ts` chặn Next/Prisma nạp `.env` thật (máy server có khóa Zalo thật).
- Hồ sơ hành nghề (v1.9.0, `src/lib/credentials.ts` hàm thuần CME/`licenseIssues`, quyền ở `src/lib/credential-access.ts`): xem = HR/ADMIN + chính
  chủ; sửa = HR/ADMIN, không tự sửa của mình (trừ ADMIN). File scan ở `data/credentials/<id>/` (ngoài public, kiểm chữ ký, ≤ 10 MB) — sao lưu
  ngoài máy phải gồm thư mục này. Job `credential-check` gom vấn đề mới thành một tin nhóm minh bạch, mỗi vấn đề ≤ 1 lần/tháng.
- Ảnh đại diện (v1.10.0, `src/lib/face-avatar.ts`): 1 ảnh nhìn thẳng cắt từ mẫu FRONT lúc enroll, `data/avatars/<id>/`; xem = chính chủ hoặc
  `snapshots.view` trong phạm vi phòng. Là dữ liệu khuôn mặt: chỗ nào xóa `faceTemplate` thì phải gọi `clearFaceAvatar`.
- Ảnh đại diện tự chọn (v1.13.0, `src/lib/profile-photo.ts`): KHÔNG phải dữ liệu sinh trắc, ưu tiên hiển thị hơn ảnh khuôn mặt (`displayAvatarUrl`);
  `data/photos/<id>/`, ≤ 2 MB sau cắt, sharp chuẩn hóa 600×800. Sửa = chính chủ / `employees.manage` (HR/ADMIN khác chỉ ADMIN). Nghỉ việc → `clearProfilePhoto`.
- Không chấm công (v1.12.0, `src/lib/attendance-scope.ts`): truy vấn nhân viên cho chấm công / cảnh báo / báo cáo / xếp ca / chốt công phải ghép
  `TRACKED_WHERE` (AND). Chỉ ADMIN đổi `attendanceExempt` (phòng / người).
- Chat bot (v1.17.0 · luồng v1.18.0, `src/lib/chatbot.ts`): Face Beo là cửa DUY NHẤT — gọi chat bot qua mạng docker kèm `X-Chat-Key`, KHÔNG để lộ
  địa chỉ/khóa ra trình duyệt, KHÔNG lưu nội dung hỏi đáp (chỉ đếm lượt ở `ChatbotUsage`). Quyền dùng: `Department.chatbotEnabled` +
  `Employee.chatbotEnabled` (null = theo phòng); cấp phát cần `chatbot.grant`. Lịch sử ở `localStorage` phải theo TỪNG người
  (`facebeo.chatbot.v1.<id>`, xóa khi đăng xuất — máy dùng chung). Ảnh chỉ qua `/api/me/chatbot/static/` (chỉ nhận
  `image/png|jpeg|webp|gif`). Mạng docker nối hai app là mạng CẦU NỐI RIÊNG `facebeo-medichat` — đừng cho `facebeo-app` vào thẳng
  `medichat_default` (cloudflared của medichat sẽ đi vòng qua mặt Caddy). Giới hạn lượt giữ chỗ trước khi hỏi (`takeDailySlot`);
  hỏng TRƯỚC khi có chữ thì hoàn lượt, đã ra chữ thì tính. Trả lời theo luồng SSE (`ask/stream` ↔ `/api/v1/chat/stream`);
  đừng đệm luồng (giữ `X-Accel-Buffering: no`), hàm đổi đường ảnh dùng chung ở `src/lib/client/chatbot-text.ts`.
- Độ trễ (v1.16.0): `useApi` có kho nhớ theo URL (hiện dữ liệu cũ rồi làm mới ngầm) — sau mỗi lần GHI cứ để `api()` tự gọi `clearApiCache()`,
  đừng fetch vòng ngoài. Ảnh đại diện `private, max-age=600` (URL có `?v=`). Phía trình duyệt KHÔNG dùng luxon (`src/lib/client/format.ts`
  tự tính theo UTC+7, có test đối chiếu). Chạy sau Caddy nên KHÔNG đặt `CLIENT_IP_HEADER` (IP thật ở `X-Forwarded-For`).
- Trang Cấu hình (v1.15.0): khung tab ở `src/app/admin/settings/page.tsx`, từng mục ở `sections/` — thêm thẻ mới thì đặt vào đúng tab, mỗi thẻ
  chỉ PUT khóa của chính nó. Xóa nhóm Zalo = DELETE `/api/settings/zalo/groups/[groupId]` (báo vào nhóm rồi xóa; webhook có thể thêm lại nhóm
  với `categories: []`).
- PWA (v1.14.0): manifest app nhân sự là file TĨNH `public/manifest.webmanifest` (layout con mới đè được), kiosk dùng `public/kiosk.webmanifest`;
  `public/sw.js` KHÔNG được lưu đệm gì ngoài `offline.html` (tránh chạy bản cũ / lộ dữ liệu có quyền). Luật hiện nút cài ở `src/lib/pwa.ts`.
- zod 4: schema PATCH không được có `.default()` (`.partial()` vẫn áp default → xóa dữ liệu). Cột JSON trong SQLite lưu chuỗi.

## Việc còn mở (21/09/2026)
- Chạy thử một phòng. Dữ liệu hiện có (máy cũ và seed demo) chỉ là mockup; máy mới/vận hành thật bắt đầu sạch theo `docs/HANDOFF.md`
  mục 1b: `db:deploy` → `db:seed:base` → `admin:create` (v1.5.4, logic ở `src/lib/bootstrap.ts`). Rà lại hệ số ca, ngày lễ trong năm.
- Sao lưu ngoài VPS: service `backup` → Cloudflare R2 mã hóa 03:30 (v1.10.4, `deploy/backup.sh`, khôi phục `deploy/restore-offsite.sh`). D7 đổi token tunnel + OA Secret Key webhook (đã lộ trong ảnh chụp 21/09/2026).
- Tra cứu medinet (v1.11.0, `src/lib/medinet.ts` + `medinet-check.ts`): đọc HTML trang Sở Y tế TP.HCM — Sở đổi giao diện thì sửa bộ đọc +
  cập nhật mẫu `tests/fixtures/medinet-*.html` (luôn **ẩn danh**, không commit dữ liệu người thật); không gọi medinet trong test.
- D4 tin Zalo cá nhân (ZNS hay tin tư vấn); Cloudflare Tunnel cho webhook; sản xuất: Windows service, HTTPS trong LAN, backup ra ngoài máy.
