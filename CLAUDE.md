# Face Beo — ngữ cảnh cho Claude Code

Đọc file này trước khi làm bất cứ việc gì. Chi tiết bàn giao máy: `docs/HANDOFF.md`.

## Dự án
- Web app quản trị nhân sự cho ~100 nhân viên: xếp ca, chấm công khuôn mặt trên tablet kiosk (InsightFace w600k_r50 + liveness
  MiniFASNetV2 phía server), đơn từ, tính công/chốt công tháng, xuất Excel, thông báo Zalo OA (nhiều nhóm theo loại tin: minh bạch / chấm công / đơn từ + tin riêng).
- Stack: Next.js 15 App Router, Prisma 6 (SQLite WAL), zod 4, luxon, exceljs, node-cron, jose JWT (HS256, 7 ngày, `sessionVersion`),
  vitest 4 (test tích hợp gọi thẳng route handler, DB `data/test.db`).
- Phiên bản hiện tại: **v1.8.0** (tag GitHub `v1.8.0`, repo `yutobeo2024/Face-beo`). Phiên bản ghi trong prose (README, PRD,
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
Server production đang được chạy bằng `next start` (không phải dev). Sau khi đổi mã: build lại rồi khởi động lại.

## Cách làm việc đã thống nhất với chủ dự án (tiếng Việt)
- Chạy liền mạch, **không dừng hỏi xác nhận từng bước**; chỉ hỏi khi lựa chọn làm khác hẳn kết quả hoặc thao tác phá hủy/ra ngoài.
- Mỗi tính năng: lên plan ngắn → làm → **song song 1 agent review + 1 agent QC** (agent không tạo worktree, không đụng
  `node_modules`) → lint + typecheck + toàn bộ vitest xanh → build → cập nhật tài liệu → commit (tiếng Việt, có
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`) → push → tag `v1.x.y` khi phát hành → khởi động lại server.
- Giải thích bằng tiếng Việt, có ví dụ số cụ thể; quy tắc công/lương phải **cấu hình được** (theo ca, theo phòng), không hard-code.
- Không commit `.env`, `data/`, `models/*.onnx`, `public/models/`; giữ nguyên `BIOMETRIC_KEY`; không bypass an toàn Prisma;
  không gửi tin Zalo thật hay đăng nhập tài khoản thật khi tự test; không in bí mật ra log/tài liệu.
- Tài liệu: cẩm nang HTML `docs/huong-dan-su-dung.html` (artifact https://claude.ai/artifact/EiMsP9AtirhXTiNUeKyPXz), Zalo OA
  `docs/zalo-oa.html` (artifact https://claude.ai/artifact/KwxtwjjshvwgYp8F9T64gh), đặc tả `docs/PRD-v2-Face-Beo.md` +
  `docs/PRD-v2.1-HR.md`, quyết định mở/đã chốt `docs/OPEN-DECISIONS.md`. Sửa tính năng thì cập nhật cẩm nang + PRD + republish.

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
- Thay đổi cấu hình lịch của nhân viên chỉ có hiệu lực từ hôm nay (`ScheduleAssignment` snapshot).
- Dữ liệu cá nhân (SĐT, CCCD, ngày sinh, giới tính, địa chỉ): chỉ vai trò HR/ADMIN + chính chủ (`canSeePersonal`/`maskPersonal`), không vào Zalo, nhật ký
  dùng `redactPersonal`. Tạo nhân viên qua `createEmployee` (`src/lib/employees.ts`); nhập Excel ở `src/lib/employee-import.ts`.
- Zalo: tin nhóm định tuyến theo `ZaloGroup.categories` (`src/lib/zalo-routing.ts`): MINH_BACH = `announce()` chỉ cho thao tác HR/ADMIN
  (trừ `always: true`); CHAM_CONG/DON_TU = `announceStaff()` tin nhân viên, **không** kèm lý do/ghi chú, lọc theo phòng. `sendZaloMessage`
  không bao giờ ném lỗi; mô phỏng khi thiếu cấu hình. Test: `tests/setup.ts` chặn Next/Prisma nạp `.env` thật (máy server có khóa Zalo thật).
- zod 4: schema PATCH không được có `.default()` (`.partial()` vẫn áp default → xóa dữ liệu). Cột JSON trong SQLite lưu chuỗi.

## Việc còn mở (21/09/2026)
- Chạy thử một phòng. Dữ liệu hiện có (máy cũ và seed demo) chỉ là mockup; máy mới/vận hành thật bắt đầu sạch theo `docs/HANDOFF.md`
  mục 1b: `db:deploy` → `db:seed:base` → `admin:create` (v1.5.4, logic ở `src/lib/bootstrap.ts`). Rà lại hệ số ca, ngày lễ trong năm.
- D4 tin Zalo cá nhân (ZNS hay tin tư vấn); Cloudflare Tunnel cho webhook; sản xuất: Windows service, HTTPS trong LAN, backup ra ngoài máy.
