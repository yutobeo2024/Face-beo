# Rà soát bảo mật commit 79baa01

Ngày: 20/09/2026. HEAD kiểm tra: `79baa01616cd93417d6c039033c17d8076724601`.

## Kết luận

Xác nhận 5 vấn đề qua route/API integration test và 1 rủi ro thiết kế liveness qua kiểm thử hàm quyết định. Không kết luận ứng dụng an toàn chỉ vì regression xanh. Chưa sửa mã ứng dụng.

| ID | Mức độ đánh giá | Vấn đề | Mức xác minh |
| --- | --- | --- | --- |
| SEC-01 | Cao | Tài khoản mới dùng mật khẩu mặc định đoán được | Tạo tài khoản → đăng nhập → đổi mật khẩu → truy cập API |
| SEC-02 | Cao | JWT cũ không bị thu hồi sau đổi mật khẩu/logout; hồi phục sau reset | Ba chuỗi thao tác API riêng biệt |
| SEC-03 | Thấp | Thông báo lỗi đăng nhập tiết lộ tài khoản tồn tại | So sánh hai phản hồi HTTP 401 |
| SEC-04 | Trung bình | Đăng nhập đồng thời làm mất lượt đếm sai, suy yếu khóa tài khoản | Handler và DB thật, điều phối thời điểm bcrypt bằng barrier |
| SEC-05 | Trung bình, có điều kiện | Ảnh quét bị từ chối không kiểm tra phạm vi dữ liệu | API trả bytes cho EMPLOYEE đã được cấp hai capability |
| SEC-06 | Cao nếu kiosk bị kiểm soát và L2 tắt/lỗi | Quyết định liveness có thể chỉ dựa trên điểm client khai báo | Hàm quyết định; **chưa chứng minh giả mạo nhận diện end-to-end** |

Mức độ là đánh giá theo điều kiện bên dưới, không phải điểm CVSS đã chuẩn hóa. Không phát hiện Critical đã được chứng minh trong lượt này.

## Môi trường và kết quả

- Branch được fast-forward từ `821582d` tới đúng commit yêu cầu; thay đổi upstream ở commit này chỉ là tài liệu.
- Test chạy với `DATABASE_URL=file:../data/test.db`, dữ liệu file trong `data/test-data`, cron tắt, thông tin Zalo thật bị gỡ trong setup. Test Zalo có sẵn dùng HTTP mock. File security mới chặn `global.fetch` để tránh vô tình gọi mạng.
- Migration/seed do test runner thực hiện **chỉ trên database test**, không trên database vận hành.
- Test mới tạo nhân viên/phòng/ca riêng và dọn fixture; ma trận quyền được khôi phục trong `finally`. Ảnh giả SEC-05 được xóa sau test, không phải dữ liệu người thật.
- Không deploy, không khởi động dịch vụ production, không stress test, không tải model, không chỉnh source ứng dụng/config/dependency/snapshot.

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ Vitest, chế độ PoC mặc định | **25 file pass; 734 test pass, 0 fail, 18 skip / 752; 58.03 giây** |
| File security mới, nằm trong lần chạy trên | 18 test: 9 ca PoC + 9 ca kiểm soát |
| Security strict, yêu cầu hành vi an toàn | **1 file fail; 9 test fail, 9 pass, 0 skip / 18; 3.58 giây** |
| ESLint | Pass |
| TypeScript `tsc --noEmit` | Pass |
| `npm audit --omit=dev` | 0 vulnerabilities được registry báo tại thời điểm chạy |
| `npm audit` | 0 vulnerabilities được registry báo tại thời điểm chạy |
| `git diff --check` | Pass |

18 test skip phụ thuộc model ONNX InsightFace/MiniFASNet chưa có. Không coi các ca này là đã kiểm chứng. Không chạy lại production build hoặc timezone suite trong lượt security này; kết quả của commit/lượt trước không được dùng thay cho xác minh hiện tại.

### Cách chạy lại và đọc kết quả

Chạy từ thư mục repository, với dependency đã cài:

```powershell
# Toàn bộ regression và PoC; global setup tạo/seed DB test.
npx vitest run --silent --reporter=dot --reporter=json --outputFile.json=data/security-79baa01-full.json

# PoC độc lập. PASS = tái hiện đúng hành vi hiện tại, có thể là hành vi không an toàn.
npx vitest run tests/integration/security-79baa01.test.ts --reporter=verbose

# Regression bảo mật theo hành vi mong muốn: hiện dự kiến exit 1, 9 ca fail.
npx cross-env SECURITY_STRICT=1 vitest run tests/integration/security-79baa01.test.ts --reporter=verbose
```

Lần strict đã thực thi dùng thêm `SKIP_DB_SETUP=1` sau full suite để tái sử dụng DB test vừa tạo; test vẫn tạo/dọn fixture của riêng mình. Báo cáo JSON thực tế ở `data/security-79baa01-full.json` và `data/security-79baa01-strict.json` (thư mục bị git ignore).

File test: `tests/integration/security-79baa01.test.ts`. Strict mode là cổng kiểm tra remediation, không nên xem PoC mode xanh là đạt yêu cầu bảo mật. Sau khi sửa cần điều chỉnh các assertion về hành vi cũ để giữ suite regression phù hợp.

Test strict đầu tiên thất bại:

```text
SEC-01 PoC: omitted creation password permits first-login account takeover
AssertionError: expected 200 to be 401
  at tests/integration/security-79baa01.test.ts:87:26
```

## Chi tiết và hướng khắc phục

### SEC-01 — Chiếm tài khoản mới qua mật khẩu mặc định

Nguồn: `src/app/api/employees/route.ts:89`; schema tạo tài khoản cho phép bỏ trường password.

Điều kiện: nhân viên được tạo không truyền password và chưa đổi mật khẩu lần đầu; kẻ tấn công biết/đoán được mã nhân viên hoặc số điện thoại, truy cập được trang đăng nhập. Không cần quyền quản trị để khai thác sau khi tài khoản đã được tạo. Test dùng ADMIN chỉ để chuẩn bị tài khoản theo luồng tạo thật.

Bằng chứng SEC-01:

1. API tạo nhân viên không có password trả 201.
2. Đăng nhập bằng `123456` trả 200 và session cookie.
3. API nghiệp vụ trả 403 do bắt đổi mật khẩu — lớp này hoạt động nhưng không xác minh ai là chủ tài khoản.
4. Gọi change-password với mật khẩu hiện tại `123456`, mật khẩu mới do người đăng nhập chọn: 200.
5. Dùng cookie mới đọc API được bảo vệ: 200.

Ảnh hưởng: chiếm tài khoản trước người dùng thật; mức ảnh hưởng tăng theo vai trò tài khoản được tạo.

Khắc phục đề xuất: bỏ mật khẩu mặc định dùng chung; invitation/activation token ngẫu nhiên, một lần, có hạn và chuyển qua kênh xác minh; hoặc mật khẩu tạm ngẫu nhiên riêng mỗi người, có thời hạn. Không chỉ dựa vào `mustChangePassword`.

### SEC-02 — Không thu hồi phiên khi đổi/reset mật khẩu và logout

Nguồn: `src/lib/session.ts:12` (TTL 7 ngày), `src/lib/auth.ts:19` (chỉ nạp trạng thái hiện tại), `src/app/api/auth/change-password/route.ts:17`, `src/app/api/auth/logout/route.ts:7`.

Điều kiện: đã có bản sao JWT hợp lệ của nạn nhân, chẳng hạn trên thiết bị dùng chung hoặc token bị lộ. Không khẳng định đã tìm ra cách đánh cắp JWT trong audit này.

Bằng chứng:

- SEC-02a: đổi mật khẩu thành công, cookie trước khi đổi vẫn gọi API protected được 200.
- SEC-02b: logout trả cookie `Max-Age=0`, nhưng gửi lại bản sao cookie cũ vẫn nhận 200.
- SEC-02c: ADMIN reset mật khẩu khiến cookie cũ tạm bị chặn 403 vì `mustChangePassword`. Người dùng thật đăng nhập bằng mật khẩu tạm và đổi mật khẩu; cookie cũ **tự dùng lại được**, trả 200.

Nguyên nhân: JWT không có session ID/token version được đối chiếu với DB; việc đổi password và xóa cookie không làm JWT đã sao chép hết hiệu lực. Cửa sổ rủi ro còn lại tối đa tới khi JWT hết hạn, bình thường là 7 ngày kể từ lúc phát hành. Deactivate tài khoản vẫn chặn được, có test kiểm soát.

Khắc phục đề xuất: `sessionVersion`/`passwordChangedAt` để vô hiệu phiên cũ khi đổi/reset; session registry hoặc denylist theo `jti` cho logout; phát phiên mới sau rotation. Giảm TTL không thay thế việc thu hồi.

### SEC-03 — Dò tài khoản qua thông báo đăng nhập

Nguồn: `src/app/api/auth/login/route.ts:25` và `:41`.

Điều kiện: truy cập endpoint login, biết hoặc đoán được mẫu mã/SĐT. Rate limit vẫn hạn chế tốc độ, không loại bỏ kênh tiết lộ.

Bằng chứng SEC-03: cùng mật khẩu sai, tài khoản đang hoạt động trả `Sai mật khẩu (còn 4 lần thử)`; tài khoản không tồn tại trả `Sai mã nhân viên/số điện thoại hoặc mật khẩu`. Cả hai cùng HTTP 401 nhưng nội dung phân biệt rõ.

Ảnh hưởng: xác định tài khoản hợp lệ để password spraying, khai thác SEC-01 hoặc gây khóa tài khoản có chủ đích. Chưa phải bypass password riêng lẻ.

Khắc phục đề xuất: phản hồi chung cho sai tài khoản/mật khẩu, thống nhất thông tin trạng thái phù hợp; tiếp tục dùng dummy bcrypt và lưu chi tiết nội bộ thay vì tiết lộ ra client.

### SEC-04 — Race condition trong đếm đăng nhập sai

Nguồn: `src/app/api/auth/login/route.ts:33` và `:37`.

Điều kiện: gửi nhiều yêu cầu đồng thời để các handler cùng đọc `failedLogins` trước khi ghi. Rate limit IP vẫn tồn tại; đây là suy yếu khóa theo tài khoản, **không** chứng minh dò mật khẩu không giới hạn.

Bằng chứng SEC-04: 5 lần nhập sai đồng thời trả `[401,401,401,401,401]`, DB cuối cùng `failedLogins=1`, `lockedUntil=null`. Đối chứng tuần tự trả `[401,401,401,401,423]` và đăng nhập đúng sau đó vẫn bị khóa 423.

Test điều phối 5 phép so bcrypt thật bằng barrier để lặp lại lịch thực thi có lỗi một cách xác định; không mock kết quả mật khẩu hoặc DB. Đây không phải phép đo xác suất khai thác trên HTTP server thật. Header IP test dùng key riêng để tránh nhiễu bucket giữa các ca, không dùng làm bằng chứng bypass proxy.

Khắc phục đề xuất: tăng bộ đếm và đặt khóa bằng thao tác nguyên tử/giao dịch an toàn; kiểm tra lại khóa trong cùng luồng cập nhật. Duy trì rate limit cả IP và account; bổ sung thử nghiệm đa tiến trình nếu deployment có nhiều worker.

### SEC-05 — Ảnh quét không gắn attendance log thiếu kiểm tra phạm vi

Nguồn: `src/app/api/snapshots/[...path]/route.ts:13` và `:16`.

Điều kiện: ADMIN đã cấp cả `snapshots.view` và `suspicious.view` cho vai trò không có phạm vi toàn công ty; người đó biết URL ảnh quét bị từ chối/ảnh không gắn log. UUID làm việc đoán URL khó; audit **không chứng minh** có endpoint liệt kê các URL này cho người đó.

Bằng chứng SEC-05: tạo ảnh giả bằng storage thật, không tạo AttendanceLog (cùng hình thức lưu của ảnh spoof bị từ chối). EMPLOYEE được cấp hai quyền trên đọc URL qua handler thật nhận 200 và đúng bytes. EMPLOYEE có `deptScope=[]`, không có phạm vi quản lý phòng nào.

Nguyên nhân: nhánh có AttendanceLog kiểm tra phòng; nhánh không có log chỉ kiểm tra capability `suspicious.view`, bỏ qua scope. Việc API danh sách suspicious đã được giới hạn không đủ bảo vệ endpoint file trực tiếp.

Khắc phục đề xuất: ảnh không xác định chủ thể chỉ cho HR/ADMIN có phạm vi toàn công ty và quyền cần thiết; hoặc lưu metadata scope rõ ràng rồi kiểm tra ở endpoint ảnh. Không xem URL ngẫu nhiên là lớp phân quyền.

### SEC-06 — Rủi ro liveness tin client / fail-open khi L2 lỗi

Nguồn: `src/lib/liveness.ts:67` và `:72`; route scan gọi bộ quyết định này trước khi nhận diện khuôn mặt.

Điều kiện khai thác tiềm năng: kiểm soát kiosk hoặc token thiết bị hợp lệ; L2 bị tắt hoặc không hoạt động; có ảnh phù hợp để bước nhận diện phía server khớp nhân viên. Không thể chỉ gửi `employeeId` tùy ý để chấm công, vì nhận diện vẫn chạy phía server.

Bằng chứng ở mức hàm quyết định:

- SEC-06a: 3 frame có `real=live=1` do test cung cấp, L2 tắt → `verified=true`, không kiểm tra hình ảnh ở lớp này.
- SEC-06b: bật L2 nhưng checker báo lỗi mô hình (test hook) → `server.status=unavailable`, vẫn `verified=true` dựa trên các điểm client đó.

Đây là hành vi fallback có chủ đích đã được chú thích trong code, nhưng có đánh đổi bảo mật. Buffer không phải ảnh trong test chỉ dùng chứng minh quyết định liveness không kiểm chứng ảnh ở các nhánh đó; **không** có nghĩa route scan chấp nhận ảnh rác, bypass face matching, hoặc đã chấm công giả thành công. Model thật không có nên không đưa ra kết luận chống ảnh chụp/video end-to-end.

Khắc phục đề xuất: nếu chống gian lận là yêu cầu bắt buộc, L2 lỗi phải fail-closed hoặc chuyển sang quy trình ngoại lệ có người duyệt, không gắn cờ đã xác minh người thật; giám sát tình trạng model. Cân nhắc challenge gắn nonce/thời hạn và bằng chứng từ nguồn tin cậy; điểm do client tự báo không đủ làm bằng chứng.

## Phạm vi đã rà soát và giới hạn

| Nhóm | Bằng chứng/kiểm tra trong lượt này | Giới hạn |
| --- | --- | --- |
| Xác thực, phiên | Login/change/reset/logout, chữ ký JWT, inactive, role lấy lại từ DB | Chưa kiểm thử trình duyệt thật, cookie theft hoặc toàn bộ vòng đời nhiều thiết bị |
| RBAC, cô lập dữ liệu | Full suite CRUD/RBAC hiện có; test không tự nâng quyền qua JWT, IDOR hồ sơ; SEC-05 | Không chứng nhận mọi tổ hợp capability đều an toàn |
| Đầu vào, upload | Zod, storage, đường dẫn snapshot, giới hạn bytes/JPEG; regression Excel formula injection | Body JSON được đọc trước khi validate; chưa thử payload gây cạn RAM hay fuzz mọi schema |
| Dữ liệu nhạy cảm | Biometric AES-GCM và test chống sửa ciphertext; chọn trường trả API; cookie HttpOnly | Không kiểm tra ACL filesystem, backup, mã hóa ổ đĩa hoặc máy chủ thật |
| Nghiệp vụ, audit | Chạy lại roster/requests/corrections/payroll/lock/race và audit-side-effect tests có sẵn | Audit helper bắt lỗi ghi log rồi tiếp tục; chưa fault-injection lỗi ổ đĩa/DB để đánh giá mất audit |
| Tích hợp ngoài | Đọc webhook, cron secret, token refresh; test chữ ký webhook sai và suite Zalo HTTP mock | Không gọi OA thật hoặc cron vận hành; webhook chưa có kiểm tra tuổi timestamp tổng quát |
| Chống lạm dụng | SEC-03/04, rate limiter, thời hạn kiosk capture, giới hạn report range | Không load test, DDoS test, proxy/cluster test |
| Triển khai | Đọc next.config, middleware, README, env example, npm audit | Không quét server public, TLS/DNS/firewall/CDN/container, không chạy DAST trình duyệt |

## Các điểm cần hardening/xác minh tiếp, không gộp vào lỗ hổng đã tái hiện

1. `next.config.ts` chưa đặt CSP/frame-ancestors/X-Frame-Options hoặc HSTS. Proxy có thể bổ sung, chưa đọc cấu hình vận hành. Cần kiểm tra response qua HTTPS thực tế trong staging; không kết luận clickjacking đã khai thác được từ kiểm tra source này.
2. Cookie dùng SameSite=Lax và HttpOnly; secure phụ thuộc production và `INSECURE_COOKIES`. Route JSON không có kiểm tra Origin/CSRF token chung. Chưa tái hiện CSRF trong browser; cần kiểm tra same-site subdomain và deployment thực tế trước khi kết luận.
3. `clientIp` mặc định tin một hop X-Forwarded-For; cần bảo đảm app chỉ nhận traffic qua proxy tin cậy và proxy nối/ghi đè header đúng. Rate limiter ở RAM, riêng từng tiến trình. Không tuyên bố spoof IP qua proxy production đã được chứng minh.
4. `parseJson`/webhook đọc body trước khi giới hạn schema. Cần giới hạn request bytes tại proxy/runtime, giữ mức phù hợp enroll 5 ảnh. Không gửi payload khổng lồ trong audit.
5. `/api/me/overview?week=...` tính khoảng từ tuần yêu cầu tới hôm nay, chưa có giới hạn khoảng thời gian như report 62 ngày. `summarizeRange` lặp từng ngày. Đây là ứng viên lạm dụng tài nguyên qua khoảng ngày lớn; chưa stress/reproduce cạn tài nguyên.
6. Token Zalo trong SQLite và ảnh snapshot không được mã hóa ở lớp ứng dụng như face descriptor; backup DB cần được bảo vệ tương ứng. Không đọc/export bí mật thật, không đánh giá tính an toàn của ổ đĩa production.
7. Login/change-password/logout chưa gọi AuditLog chuyên biệt; cần sự kiện giám sát không chứa mật khẩu/token. Các luồng nghiệp vụ đã có audit không thay thế audit xác thực.
8. Commit này quyết định `org.manage` là quyền toàn công ty và hướng dẫn không cấp cho quản lý. Code vẫn cho ADMIN cấp capability này; đây là rủi ro cấu hình/chính sách, không tự động coi là bypass do người dùng thường. Nếu muốn ràng buộc kỹ thuật ADMIN-only, cần khóa capability trong code ở một thay đổi được phê duyệt riêng.

## Trạng thái bàn giao

Chỉ bổ sung file test và báo cáo này; source ứng dụng vẫn nguyên bản commit `79baa01`. JSON kết quả và DB/cache test nằm trong `data/` bị ignore. Không commit/push thay đổi. Các vấn đề chưa được sửa theo đúng phạm vi yêu cầu.


## Trạng thái khắc phục (v1.4.4, 20/09/2026)

SEC-01…SEC-06 đã sửa trong commit v1.4.4 (xem `docs/PRD-v2.1-HR.md` mục 12). `tests/integration/security-79baa01.test.ts` nay luôn kiểm tra hành vi an toàn (không còn chế độ PoC). Riêng SEC-06a (L2 tắt bằng cấu hình => chỉ L1) là chấp nhận có chủ đích; vận hành thật phải bật `LIVENESS_SERVER=true`.
