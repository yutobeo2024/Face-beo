# Các quyết định còn mở

Ghi lại những điểm đã phát hiện trong quá trình làm và test, cần chủ dự án quyết định sau. Khi đã chốt, chuyển mục sang phần "Đã chốt" và cập nhật PRD.

## Đang mở

### D4. Tin nhắn Zalo cá nhân tới nhân viên (báo vắng, duyệt đơn, nhắc ca…)

- **Ghi nhận:** 19/09/2026, khi nối Zalo OA thật.
- **Ràng buộc Zalo:** OA chỉ gửi *tin tư vấn* miễn phí trong 48 giờ sau khi nhân viên nhắn cho OA; qua OpenAPI tối đa 7 ngày (có phí); quá 7 ngày
  không gửi được. Nhân viên ít nhắn OA nên phần lớn tin sẽ không tới.
- **Phương án:**
  - **ZNS** (tin theo mẫu, gửi theo số điện thoại, không cần liên kết): ổn định, ~200–800đ/tin, phải đăng ký ~6 mẫu và được Zalo duyệt, nạp tiền ZBS.
  - **Tin tư vấn + quy ước nhân viên nhắn OA hằng ngày**: miễn phí, không đảm bảo tới.
  - **Kết hợp**: tư vấn khi còn trong 48 giờ, không thì ZNS.
- **Trạng thái:** chờ quyết định. Giai đoạn 1 (v1.4) chỉ gửi tin vào nhóm minh bạch; tin cá nhân vẫn ở chế độ hiện có (gửi tin tư vấn nếu nhân viên
  đã liên kết, không thì ghi `SKIPPED_NO_ZALO`).

### D7. Đổi các bí mật đã lộ khi triển khai

- Token Cloudflare Tunnel và `ZALO_WEBHOOK_SECRET` từng hiện trong ảnh chụp màn hình lúc cài đặt (21/09/2026). Cần **Refresh token** tunnel và
  tạo lại OA Secret Key webhook (nếu Zalo cho), dán lại vào `/opt/facebeo/.env`, `up -d --force-recreate`.
- **Trạng thái:** chờ chủ dự án thao tác.

## Đã chốt v1.21.x (30/09 – 05/10/2026) — Kiosk và hiệu chỉnh đồng phục bằng dữ liệu thật

### Kiosk: chạm rồi mới chấm (v1.21.0)

| Điểm | Quyết định |
|---|---|
| Chống chấm nhầm khi đi ngang | **Chế độ chờ — camera TẮT tới khi chạm màn hình**. Chấm xong tự về chờ |
| Tự tắt camera | **Sau vài phút không thấy ai** (`kioskIdleSeconds`, mặc định 120 giây) |
| Giờ cao điểm | `kioskAwakeSeconds` mặc định **0** = chấm xong về chờ ngay. Thấy chậm thì đặt 30 |

Vì sao: chặn quét trùng chỉ có **120 giây**, mà lượt sớm nhất trong ngày là VÀO còn **mọi lượt sau đều là RA** — nên một
lượt đi ngang lỡ là lượt cuối ngày sẽ thành **"về sớm" oan**. Màn hình cũng hiện tên và giờ cho người đứng gần thấy.
Chủ dự án chọn phương án an toàn nhất dù phải chạm thêm một cái.

### Chỉ dẫn trên kiosk: vẽ đúng chỗ máy đang nhìn (v1.20.2)

Vạch nét đứt "ngang ngực" cố định ở 58% **không tự giải thích được** và tệ hơn: khung 2:3 vẽ bằng CSS trên thẻ `<video>`
đang `object-cover` nên **không trùng** vùng `checkGate` thật sự đo. Thay bằng ô bám theo khuôn mặt + dải tô sáng đúng
vùng áo sẽ cắt (dùng chung hằng `SHIRT_CROP`), xanh khi đạt cổng.

### Ba lỗi đo ra từ 13 ảnh chấm công thật (v1.21.1 – v1.21.2)

Ngày đầu chạy thử phòng Hành chính báo "ảnh cắt không đủ, có tấm không thấy logo, có người không có ảnh". Đọc thẳng
dữ liệu trên VPS, đo ra **ba lỗi độc lập** — đều là lỗi thiết kế:

1. **Mất logo (3/6).** Bộ dò BlazeFace phát ra khung mặt **vuông** (202×202, 258×258…, lệch ≤ 1 px) nên `h` ≈ bề ngang
   mặt. Tỉ lệ đầu (`topOffset 1,3`) chọn khi tưởng khung cao hơn rộng ⇒ vùng cắt bắt đầu quá thấp, **đi qua mất logo**.
   Logo nằm **ngay dưới cằm**. Sửa thành `topOffset 1,05 · heightFactor 1,05`.
2. **Cắt hụt đáy (5/13).** Cổng kiosk viết tay `chestRoom = 1,1` trong khi vùng cắt cần `1,2`. Giờ suy ra từ chính
   `SHIRT_CROP` qua `CHEST_ROOM_NEEDED`, hai bên không lệch lại được.
3. **Không có ảnh (5/13).** `minBrightness = 0,10` lấy từ máy cũ (0,16–0,28); webcam kiosk hiện tại cho **0,063–0,192**.
   Hạ xuống 0,04. Lần đầu sửa hụt vì `extractShirtFeature` **viết cứng số 0,1** thay vì dùng `QUALITY_LIMITS` — quét lại
   dữ liệu thật mới phát hiện (v1.21.2).

Kết quả: cắt được **8/13 → 12/13**, logo **3/6 → 6/6**, hết cắt hụt đáy. Ca còn trượt là người đưa tay che camera.

### Mẫu áo: chỉ lấy từ ảnh người mặc, và nên đa dạng

Đo thật: mẫu dựng từ **ảnh áo rời trải phẳng** chấm chính 6 người đang mặc đúng cái áo đó chỉ **0,35–0,40** ⇒ báo oan
hàng loạt. Nên `recomputeTemplate` chỉ lấy trung bình từ **ảnh người mặc** (`kind = WORN`).

Thêm nữa: tăng mẫu từ 3 lên 7 ảnh đa dạng làm điểm hình dáng của ca thấp nhất **tăng +0,051** và vượt ngưỡng, trong khi
các ca vốn đã khớp gần như không đổi (±0,004). Nên **lấy đủ ảnh mẫu ngay từ đầu rồi dừng** — thêm rải rác giữa kỳ chạy
thử sẽ làm dữ liệu đo ngưỡng bị trộn nhiều thước đo.

### Ngưỡng: đo, không đoán — và phải có cả ca mặc SAI áo

Ngưỡng mặc định hiện tại đo trên **ảnh điện thoại**; số thật trên kiosk cho mặc đúng áo là **màu 0,92–0,99 ·
hình dáng 0,85–0,91**, tức vạch `0,85` đang nằm **giữa đám**. Sửa được ở **Cấu hình → Chấm công → Ngưỡng kiểm đồng phục**
(v1.21.3 — tài liệu ghi có từ v1.20.0 mà giao diện chưa làm).

**Chốt cách làm:** không chỉnh tay. Chạy thử 2 tuần, Nhân sự gắn nhãn, rồi `npm run uniform:eval` tìm vạch với ràng buộc
**báo oan ≤ 2 %**. Phép đo **bắt buộc có nhóm mặc SAI áo** (10–15 lượt, gồm cả áo sẫm gần giống navy) — chỉ biết áo đúng
nằm ở đâu thì không đặt được vạch.

### Còn mở

- **Camera cho kiosk**: máy tính webcam ngang (đang dùng) hay tablet camera dọc. Khung dọc dư chỗ hơn hẳn cho vùng ngực;
  đổi thì phải đo lại `minBrightness` vì đó là đặc tính của từng camera.

## Đã chốt v1.20.0 (30/09/2026) — Kiểm áo đồng phục

Bảy quyết định chủ dự án đã chốt trước khi làm:

| Điểm | Quyết định |
|---|---|
| Cách nhận biết | **Mô hình AI chạy trên VPS**, không gửi ảnh ra dịch vụ ngoài |
| Mẫu áo | Khác **màu rõ rệt**, 2–3 mẫu mỗi phòng, mặc mẫu nào cũng đạt |
| Phạm vi | **Theo từng phòng**: mẫu áo riêng, bật/tắt riêng |
| Lúc kiểm | Chỉ **lượt chấm VÀO đầu ca**, một lần mỗi người mỗi ngày |
| Khi máy không chắc | **CẦN XEM LẠI** → Nhân sự xác nhận; không bao giờ ghi vi phạm oan |
| Zalo | **Một tin tổng hợp cuối ngày cho quản lý phòng**, không kèm lý do cá nhân |
| Khung hình | **Sửa khung ngắm kiosk** để ảnh luôn lấy từ ngang ngực trở lên (tỉ lệ ảnh thẻ 4×6), thay vì viết luật chịu đựng ảnh thiếu |

Ba quyết định phát sinh **từ số đo trên ảnh thật** của phòng khám (6 ảnh mặc đúng đồng phục, 4 ảnh mặc sai, chạy qua đúng mã
sản phẩm — xem `scripts/fetch-uniform-model.mjs` phần "VÌ SAO LÀ DINOv2"):

1. **Đổi mô hình sang DINOv2-small.** Mô hình đầu tiên (MobileCLIP-S0) chấm áo đen thường **0,741** — cao hơn cả áo đồng phục
   thật (**0,459**). Nó chỉ nhận ra "người mặc áo sẫm màu". DINOv2 tách đúng hướng: mặc đúng 0,91–0,96 · mặc sai 0,65–0,81.
2. **Siết ngưỡng mặc định** từ 0,55/0,55/0,45 (số đoán) lên **màu ≥ 0,80 · hình dáng ≥ 0,85 · trượt ≤ 0,70 · trọng số màu 0,50**.
   Với ngưỡng cũ, áo thun trắng vẫn được chấm "đạt". Số đo thật: màu 0,919–0,958 (đúng) vs 0,269–0,639 (sai).
3. **Ảnh áo rời không dùng làm mẫu được.** Lấy ảnh áo trải phẳng làm mẫu rồi chấm chính 6 người đang mặc đúng cái áo đó thì
   **cả 6 đều "không đạt"** (0,35–0,40). Mẫu áo chỉ lấy trung bình từ **ảnh người mặc**; chỉ có ảnh áo rời thì `sampleCount = 0`
   nên máy luôn để "cần xem lại". Cách lấy mẫu chuẩn: nhân viên chấm công bình thường → Nhân sự bấm "Dùng ảnh này làm ảnh mẫu".

**Kết quả cổng thử:** 6/6 mặc đúng → Đạt · 3/4 mặc sai → Không đạt · 1 → Cần xem lại (ảnh cắt trúng cổ). Báo oan **0 %**.
Khoảng cách điểm đúng/sai **0,270** (cổng đòi ≥ 0,150).

**Còn phải làm khi vận hành:** ảnh dùng cho cổng thử là ảnh điện thoại, sáng hơn ảnh kiosk (độ sáng vùng áo thật chỉ 0,16–0,28).
Ngưỡng hiện tại là điểm khởi đầu; mỗi phòng vẫn phải chạy **chế độ thử 2 tuần** rồi đo lại bằng `npm run uniform:eval`
(ràng buộc **báo oan ≤ 2 %**) trước khi bật thật.

## Đã chốt v1.19.0 (25/09/2026)

- **Bảng gợi ý của chat bot chia theo mảng tài liệu**, không theo chuyên khoa nữa: 4 mục lớn (TRA CỨU MÃ ICD, CHUYÊN MÔN Y TẾ,
  QUY CHẾ – QUY ĐỊNH, MÔ TẢ CÔNG VIỆC). Mục chưa nạp tài liệu vẫn hiện kèm nhãn "sắp có" nhưng khóa không cho bấm — để nhân viên
  biết sắp có mà không hỏi phải câu trả lời rỗng. Nạp xong bên chat bot thì đổi `ready: true` trong `src/app/me/chatbot/knowledge.ts`.

## Đã chốt v1.18.0 (24/09/2026)

- **Chat bot trả lời theo luồng** thay vì chờ xong cả câu: đo trên máy thật, Gemini viết một câu dài mất 60–70 giây nên chờ đủ rồi
  mới hiện là không chấp nhận được. Chọn stream thật (SSE) chứ không làm hiệu ứng gõ chữ giả như bản gốc của chat bot.
- **Tính lượt khi hỏng giữa chừng**: chưa ra được chữ nào thì hoàn lại lượt; đã ra chữ rồi thì tính một lượt (chat bot đã tốn tiền gọi AI).
- **Chat bot hỏng thì Face Beo vẫn chạy**: mọi lỗi của chat bot quy về thông báo tiếng Việt, không chặn tính năng khác.

## Đã chốt v1.17.0 (24/09/2026)

- **Chat bot tra cứu y khoa nhúng trong Face Beo**: dựng lại giao diện trong Face Beo (không iframe), khóa đường gọi công khai của
  chat bot, lịch sử chỉ lưu trên máy người dùng, cấp quyền theo phòng + từng người. Xem PRD v2.1 mục 31.

## Đã chốt v1.16.0 (24/09/2026)

- **Đi thẳng tới VPS thay vì vòng qua Cloudflare** (nhanh khoảng 10 lần), giữ đường hầm làm dự phòng; chặn truy cập ngoài Việt Nam + fail2ban.
- **Ảnh đại diện được giữ 10 phút trên máy người dùng** — đổi lại là mất quyền xem thì ảnh còn hiện chậm nhất 10 phút. Xem PRD v2.1 mục 30.

## Đã chốt v1.15.0 (24/09/2026)

- **Trang Cấu hình chia 5 tab** (Ca & lịch · Tổ chức · Chấm công · Zalo OA · Hành nghề), tab lưu trong địa chỉ.
- **Xóa nhóm Zalo**: có gửi tin báo vào nhóm trước khi xóa; nhóm nhắn lại thì hiện lại nhưng không nhận tin. Xem PRD v2.1 mục 29.

## Đã chốt v1.14.0 (23/09/2026)

- **Cài web app thành app (PWA)**: thanh nhắc + mục "Cài ứng dụng" trong menu; "Để sau" ẩn 14 ngày; đã cài thì ẩn hẳn; app mở thẳng `/me`
  (chưa đăng nhập thì qua `/login?next=/me`). Kiosk giữ manifest riêng. Xem PRD v2.1 mục 28.

## Đã chốt v1.13.0 (22/09/2026)

- **Ảnh đại diện tự chọn**: khung 3:4, file ≤ 5 MB, nhân viên tự đổi, Nhân sự / Quản trị đổi hộ; không dùng nhận diện; xóa khi nghỉ việc
  (xóa khuôn mặt thì giữ). Xem PRD v2.1 mục 27.

## Đã chốt v1.12.1 (22/09/2026)

- **Ca cố định luôn theo một mẫu tuần có trong Cấu hình** — bỏ lựa chọn ẩn "Ca mặc định, nghỉ Chủ nhật"; dữ liệu cũ tự gán mẫu tương đương (lịch không
  đổi). Ca mặc định chủ yếu cho nhóm xoay ca. Xem PRD v2.1 mục 26.

## Đã chốt v1.12.0 (22/09/2026)

- **Ban Giám đốc / Quản trị không chấm công**: cấu hình theo phòng + từng người (theo phòng / không chấm / vẫn chấm); không cảnh báo, không Zalo,
  ẩn khỏi mọi phần chấm công (Tổng quan, Chấm công, Báo cáo & Excel, Xếp ca, chốt công). Chỉ Quản trị đổi. Xem PRD v2.1 mục 25.

## Đã chốt v1.11.0–v1.11.1 (22/09/2026)

- **D5 tự tra cứu GPHN trên medinet (đợt 2)**: làm được — trang tracuu.medinet.org.vn tra bằng 2 yêu cầu dữ liệu (`/chungchihanhnghey`,
  `/chungchihanhngheydetail`), không captcha. Nút "Tra" điền sẵn form GPHN, nút "Tra cứu tự động", job 06:30 (30 ngày / người, ≤ 30 người /
  ngày, cách ≥ 4 giây). Không tự sửa dữ liệu Nhân sự — chỉ cảnh báo khi khác, tự ghi "đã đối chiếu" khi khớp. "Đăng ký nơi khác" xét theo
  **số GPHĐ của phòng khám** (Cấu hình). Hạn chế: chỉ dữ liệu Sở Y tế TP.HCM; trang đổi giao diện phải sửa bộ đọc. Xem PRD v2.1 mục 24.

## Đã chốt v1.10.4 (22/09/2026)

- **D6 sao lưu ra ngoài VPS → Cloudflare R2**: mỗi ngày 03:30, bản DB mới nhất + file scan + ảnh đại diện, mã hóa rclone crypt, giữ 30 ngày;
  `.env` không lên R2 (chủ dự án tự cất ngoài máy). Khôi phục thử bằng `deploy/restore-offsite.sh`. Xem `docs/DEPLOY-VPS.md`.

## Đã chốt v1.10.1–v1.10.2 (21/09/2026)

- **Máy chủ thật = VPS `103.142.27.210` qua Cloudflare Tunnel**, địa chỉ **https://face.ydsg.website**; Docker compose riêng (`facebeo`), không mở
  cổng host, không đụng các dự án khác trên VPS. Chuyển nguyên dữ liệu máy cũ (giữ `BIOMETRIC_KEY`, token Zalo). Máy local chỉ để phát triển.
- **Webhook Zalo**: xác thực domain bằng tệp HTML; chưa có khóa ký thì trả 200 và bỏ qua sự kiện; có khóa thì chữ ký sai → 401.
  Xem PRD v2.1 mục 23, `docs/DEPLOY-VPS.md`.

## Đã chốt v1.10.0 (21/09/2026)

- **Ảnh đại diện = ảnh nhìn thẳng lúc enroll** (cắt khuôn mặt 256×256, không lưu 4 góc còn lại). Xem: chính chủ, Nhân sự, Quản trị, quản lý
  phòng mình (theo quyền xem snapshot). Người enroll trước đây phải enroll lại mới có ảnh. Đổi cam kết "không lưu ảnh enroll" — nội dung
  đồng ý đã cập nhật. Xem PRD v2.1 mục 22.

## Đã chốt v1.9.0 (21/09/2026)

- **Hồ sơ hành nghề** (GPHN, văn bằng / chứng chỉ / CME kèm file scan) do Nhân sự nhập; có số GPHN thì bắt buộc đủ trường. Chu kỳ CME 5 năm tính
  từ ngày cấp / gia hạn GPHN (sửa được). Cảnh báo gửi **nhóm Zalo minh bạch**, mỗi vấn đề tối đa 1 lần / tháng. Làm 2 đợt (D5). Xem PRD v2.1 mục 21.

## Đã chốt (19/09/2026, xem `PRD-v2.1-HR.md`)

- **Vai trò Nhân sự (HR):**
  - Được: xem toàn công ty, quản lý nhân viên, enroll/xóa khuôn mặt, xem snapshot, xuất bảng công.
  - Không được: cấu hình hệ thống, thiết bị, phòng ban/quản lý, ngày lễ, định nghĩa ca.
- **Ma trận phân quyền:** lưu trong DB, chỉ ADMIN chỉnh trên web (phương án B). Các quyền lõi khóa cứng cho ADMIN.
- **Tuyến duyệt:** nhân viên → quản lý; quản lý → HR; HR → ADMIN.
- **Đơn bổ sung công hai bước:** duyệt, sau đó HR chấm tay; đơn của HR do ADMIN chấm tay. Chỉ ADMIN chấm tay trực tiếp.
- **Đăng ký ca tuần:**
  - Quản lý đăng ký trước 00:00 thứ Hai.
  - Sau khi đăng ký, chỉ HR sửa được, bắt buộc có lý do và có tin nhóm Zalo.
  - Bản nháp không được tính công.
- **Nhóm cố định theo mẫu tuần:** hai mẫu T2–T6 + T7 nửa ngày và T2–T7 cả ngày.
  - Nhân viên xoay ca mà tuần chưa đăng ký: trạng thái "Chưa có lịch", không báo vắng, báo HR.
  - Quyết định này thay quyết định cũ "chấm theo ca mặc định".
- **OT ngày không có ca:** tính theo đơn tăng ca đã duyệt.
- **Minh bạch:** thao tác duyệt/sửa của HR và ADMIN được gửi vào nhóm Zalo OA. Không gửi lần quét chấm công, cũng như thao tác ngang quyền nhân viên.

## Đã chốt v1.8.0 (21/09/2026)

- **Hồ sơ nhân viên có CCCD, ngày sinh, giới tính, địa chỉ; SĐT không bắt buộc.** Chỉ Nhân sự, Quản trị và chính chủ xem.
- **Nhập Excel**: chỉ Mã NV + Họ tên bắt buộc; mã đã có → cập nhật ô có điền; phòng trống → "Chưa phân phòng"; ca / mẫu tuần mặc định chọn khi
  nhập; còn lỗi thì không nhập dòng nào. Xem PRD v2.1 mục 20.

## Đã chốt v1.7.0 (21/09/2026)

- **Phòng ban = đơn vị quản lý** (ai duyệt, ai xếp ca); chuyên môn là **Chức danh / Chuyên khoa** của nhân viên (không ảnh hưởng quyền).
- **Cách duyệt đơn cấu hình theo phòng**: Trưởng phòng hoặc Nhân sự (mặc định) / Trưởng phòng → Nhân sự (2 bước) / Chỉ trưởng phòng.
- **Chỉ Nhân sự xếp ca**: bỏ quyền "Xếp ca" của vai trò Quản lý trong Phân quyền. Xem PRD v2.1 mục 19.

## Đã chốt v1.6.0 (21/09/2026)

- **Nhiều nhóm Zalo, mỗi nhóm chọn loại tin** (cấu hình được, không hard-code): Minh bạch / Chấm công nhân viên / Đơn từ nhân viên, lọc
  theo phòng cho tin nhân viên. Nhóm nhân viên (vd. "YDSG-NHÂN VIÊN"): **gửi ngay từng người** (không gom tin), đơn từ **chỉ trạng thái**
  (không lý do xin nghỉ, không ghi chú duyệt/từ chối), nhóm minh bạch cũ **giữ nguyên** luồng. "Vắng không phép" = hết ca, không lần quét
  nào, không có đơn nghỉ (đã duyệt hoặc đang chờ) — chỉ là tin báo, không đổi cách tính công. Xem PRD v2.1 mục 18.

## Đã chốt v1.5.4 (21/09/2026)

- **Đưa vào vận hành thật không qua dữ liệu mẫu.** `npm run db:seed:base` chỉ tạo cấu hình nền (ca, mẫu tuần, ngày lễ, quyền, cấu
  hình; ca "Sáng thứ Bảy" 4 giờ = 0.5 công), không xóa, không tạo nhân viên/phòng ban. `npm run admin:create` tạo Quản trị đầu tiên
  (chỉ khi chưa có Quản trị đang hoạt động), `--reset <mã>` cấp lại mật khẩu tạm cho Quản trị đang hoạt động. Seed demo tự dừng khi DB
  đã có nhân viên hoặc ca (ép bằng `npm run db:seed:force`). Xem PRD v2.1 mục 17.

## Đã chốt v1.5.3 (20/09/2026)

- **Không xóa cứng nhân viên đã có lịch sử.** Nút "Xóa tài khoản" chỉ dành cho tài khoản tạo nhầm (server từ chối khi có bất kỳ
  log/đơn/lịch/ngày chốt/nhật ký); nhân viên nghỉ việc dùng "bỏ tích Đang làm việc". Lý do: giữ bảng công đã chốt, nhật ký, không tái
  dùng mã NV/SĐT. Xem PRD mục 16.

## Đã chốt v1.5.1 (20/09/2026)

- **Xóa cấu hình tổ chức chỉ khi chưa đi vào lịch sử**: ca chỉ xóa khi chưa ai dùng; mẫu tuần chỉ xóa khi không nhân viên đang làm
  dùng (người đã nghỉ được gỡ liên kết); phòng ban chỉ xóa khi trống hoàn toàn (kể cả nhân viên đã nghỉ, tuần đã đăng ký, ngày đã
  chốt). Không có "xóa mềm" cho ca/phòng — muốn ngừng dùng thì đổi tên. Ngày lễ sửa được cả tên lẫn ngày. Xem PRD mục 14.

## Đã chốt v1.5.0 (20/09/2026)

- **Mục "Thông tin" (thư viện liên kết)** trong trang cá nhân: quyền mới `links.manage`, mặc định Nhân sự; Quản lý chỉ khi được cấp và
  bị giới hạn theo phòng mình phụ trách (phải chọn ≥ 1 phòng). Hiển thị theo luật giao vai trò ∩ phòng ban, trống = tất cả, không có
  ngoại lệ cho HR/Quản trị. Trên điện thoại mục này nằm trong ngăn "Thêm" (thanh dưới đã đủ 4 mục). Xem PRD mục 13.

## Đã chốt v1.4.3 (20/09/2026)

- **Giữ `org.manage` là quyền gộp toàn công ty**, không tách quyền "hệ số công của phòng mình" cho Quản lý. Ghi chú trong cẩm nang
  (mục 3) và PRD mục 2: không cấp `org.manage` cho Quản lý.

## Đã chốt v1.4 (19/09/2026)

- **Zalo OA giai đoạn 1: chỉ nhóm minh bạch (GMF).** OA có gói dịch vụ, nhóm đã tạo. Tin cá nhân để D4.
- **Webhook mở bằng Cloudflare Tunnel** khi cần liên kết nhân viên.

## Đã chốt v1.3 (19/09/2026)

- **Nhận diện khuôn mặt chuyển sang server (InsightFace R50):** do mô hình trên tablet nhận nhầm người có nét giống (đo trên dữ liệu thật). Phải enroll lại toàn bộ.
- Tuỳ chọn mô hình nhẹ `mbf` cho máy chủ yếu (`FACE_EMBED_MODEL=mbf`).

## Đã chốt v1.2 (19/09/2026, xem `PRD-v2.1-HR.md` mục 8–10)

- **Ngày công theo hệ số ca (mới):**
  - Mỗi ca có hệ số công chung (mặc định 1).
  - Quản trị đặt hệ số riêng theo phòng ban (ví dụ Hành chính: Sáng thứ Bảy = 0.5).
  - Khi triển khai, mọi hệ số đều bằng 1.
- **Nửa ngày phép:** đi làm nửa ngày, nửa còn lại nghỉ phép đã duyệt thì tính 0.5 công + 0.5 phép (nhân với hệ số).
  - Được coi là nửa ngày khi đơn che ≥ một nửa thời gian làm thực của ca, hoặc che trọn một buổi (trước hoặc sau giờ nghỉ trưa).
  - Đơn về sớm (VE_SOM) không trừ công.
- **D1 – Trừ giờ nghỉ:** ca có "Giờ bắt đầu nghỉ" thì giờ công chỉ trừ phần giờ nghỉ giao với khoảng có mặt. Ví dụ vào 13:00, ra 17:00 được 4 giờ.
  - Khoảng có mặt được kẹp trong giờ ca.
  - Chỉ ảnh hưởng cột "Giờ công"; ngày công và OT không đổi.
- **D2 – Chốt công tháng:**
  - HR hoặc Quản trị chốt tháng đã kết thúc, từ ngày 2 của tháng sau. Hệ thống lưu bản chụp kết quả từng ngày.
  - Sau khi chốt, chặn mọi thao tác ghi làm đổi công trong tháng (trả lỗi 409).
  - Chỉ Quản trị mở khóa, bắt buộc có lý do, có nhật ký và gửi tin nhóm Zalo.
- **D3 – Đơn chờ quá hạn:** quá 24 giờ thì nhắc người xử lý; quá 48 giờ thì báo Quản trị và nhóm Zalo. Không bao giờ tự duyệt.
