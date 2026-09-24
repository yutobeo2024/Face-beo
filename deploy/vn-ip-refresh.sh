#!/bin/sh
# Tạo /etc/caddy/vn-ips.caddy: chỉ cho phép truy cập từ dải IP Việt Nam (v1.16.0).
# Nguồn: danh sách phân bổ của APNIC (cơ quan cấp phát IP khu vực châu Á – Thái Bình Dương).
# Chạy tay sau khi cài, rồi để cron chạy lại hằng tuần (dải IP có thay đổi):
#   0 4 * * 1 sh /opt/facebeo/src/deploy/vn-ip-refresh.sh >/var/log/vn-ip-refresh.log 2>&1
set -eu

OUT=/etc/caddy/vn-ips.caddy
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SRC=https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-latest

echo "== Tải danh sách phân bổ IP của APNIC…"
curl -fsS --retry 3 --max-time 120 "$SRC" -o "$TMP/apnic.txt"

# Dòng dạng: apnic|VN|ipv4|1.52.0.0|32768|20101116|allocated  → 1.52.0.0/17 (32768 địa chỉ = /17)
awk -F'|' '$2=="VN" && $3=="ipv4" && $5+0>0 {
  bits = 32; n = $5; while (n > 1) { n /= 2; bits-- }
  printf "%s/%d\n", $4, bits
}' "$TMP/apnic.txt" | sort -u > "$TMP/vn-cidr.txt"

COUNT=$(wc -l < "$TMP/vn-cidr.txt")
# Chốt an toàn: danh sách quá ngắn nghĩa là tải lỗi — giữ nguyên file cũ, đừng khóa luôn cả phòng khám.
if [ "$COUNT" -lt 300 ]; then
	echo "!! Chỉ lấy được $COUNT dải — nghi tải lỗi, GIỮ NGUYÊN $OUT" >&2
	exit 1
fi

{
	echo "# Sinh tự động bởi deploy/vn-ip-refresh.sh lúc $(date '+%H:%M %d/%m/%Y') — $COUNT dải IP Việt Nam. ĐỪNG sửa tay."
	echo "@ngoai_vn {"
	echo "	not remote_ip 127.0.0.1/8 ::1 $(tr '\n' ' ' < "$TMP/vn-cidr.txt")"
	echo "	not path /api/zalo/webhook*"
	echo "	not path /.well-known/*"
	echo "}"
	echo 'respond @ngoai_vn "Face Beo chi truy cap duoc tu Viet Nam." 403'
} > "$TMP/vn-ips.caddy"

install -m 0644 "$TMP/vn-ips.caddy" "$OUT"
echo "== Đã ghi $OUT ($COUNT dải)."

if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
	caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy && echo "== Đã nạp lại Caddy."
fi
