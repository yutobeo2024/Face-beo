#!/bin/sh
# Sao lưu Face Beo ra ngoài VPS lên Cloudflare R2, mã hóa bằng rclone crypt (chạy trong container rclone/rclone).
#   sh backup.sh            chạy nền: mỗi ngày 03:30 (sau job db-backup 03:00 của app)
#   sh backup.sh once       chạy một lần ngay
#   sh backup.sh restore [YYYYMMDD]   tải + giải mã + giải nén bản sao lưu (mới nhất nếu bỏ trống) vào /restore
# Mỗi bản: facebeo-YYYYMMDD.tar.gz = bản DB mới nhất trong backups/ (VACUUM INTO — nhất quán) + credentials/ + avatars/ + photos/.
# Cấu hình lấy từ /opt/facebeo/.env: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_CRYPT_PASSWORD, BACKUP_CRYPT_SALT.
set -u
DATA=/data
STATUS=/status/offsite-status.json
KEEP="${BACKUP_KEEP_DAYS:-30}d"

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

configured() {
  [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] \
    && [ -n "${BACKUP_CRYPT_PASSWORD:-}" ] && [ -n "${BACKUP_CRYPT_SALT:-}" ]
}

setup_rclone() {
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true   # token chỉ có quyền trên 1 bucket, không liệt kê / tạo bucket
  export RCLONE_CONFIG_R2CRYPT_TYPE=crypt
  export RCLONE_CONFIG_R2CRYPT_REMOTE="r2:${R2_BUCKET}/facebeo"
  RCLONE_CONFIG_R2CRYPT_PASSWORD="$(rclone obscure "$BACKUP_CRYPT_PASSWORD")"
  RCLONE_CONFIG_R2CRYPT_PASSWORD2="$(rclone obscure "$BACKUP_CRYPT_SALT")"
  export RCLONE_CONFIG_R2CRYPT_PASSWORD RCLONE_CONFIG_R2CRYPT_PASSWORD2
}

write_status() { # ok file size error
  mkdir -p /status
  printf '{"at":"%s","ok":%s,"file":"%s","size":%s,"error":"%s"}\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" "$2" "${3:-0}" "${4:-}" > "$STATUS"
}

run_once() {
  if ! configured; then log "chưa cấu hình R2 / mật khẩu mã hóa trong .env — bỏ qua"; write_status false "" 0 "chưa cấu hình"; return 1; fi
  setup_rclone
  db=$(ls -1 "$DATA"/backups/facebeo-*.db 2>/dev/null | sort | tail -1)
  if [ -z "$db" ]; then log "LỖI: chưa có bản DB nào trong backups/"; write_status false "" 0 "không có bản DB"; return 1; fi
  name="facebeo-$(date +%Y%m%d).tar.gz"
  work=$(mktemp -d)
  mkdir -p "$work/pack/backups"
  cp "$db" "$work/pack/backups/"
  for d in credentials avatars photos; do [ -d "$DATA/$d" ] && cp -r "$DATA/$d" "$work/pack/"; done
  if ! tar -czf "$work/$name" -C "$work/pack" .; then log "LỖI: nén thất bại"; write_status false "$name" 0 "nén thất bại"; rm -rf "$work"; return 1; fi
  size=$(wc -c < "$work/$name" | tr -d ' ')
  if rclone copyto "$work/$name" "r2crypt:daily/$name" --retries 5 --low-level-retries 10 -q; then
    rclone delete "r2crypt:daily" --min-age "$KEEP" -q || log "cảnh báo: không xóa được bản cũ hơn $KEEP"
    log "OK: $name ($size byte, từ $(basename "$db")) → R2 $R2_BUCKET (mã hóa); giữ $KEEP"
    write_status true "$name" "$size" ""
    rm -rf "$work"
    return 0
  fi
  log "LỖI: tải lên R2 thất bại"
  write_status false "$name" "$size" "tải lên R2 thất bại"
  rm -rf "$work"
  return 1
}

restore() {
  configured || { log "chưa cấu hình R2"; exit 1; }
  setup_rclone
  if [ -n "${1:-}" ]; then name="facebeo-$1.tar.gz"; else name=$(rclone lsf "r2crypt:daily" | sort | tail -1); fi
  [ -n "$name" ] || { log "không có bản sao lưu nào trên R2"; exit 1; }
  rm -rf /restore/* 2>/dev/null
  mkdir -p /restore
  rclone copyto "r2crypt:daily/$name" "/restore/$name" -q || { log "LỖI: tải $name thất bại"; exit 1; }
  tar -xzf "/restore/$name" -C /restore && rm -f "/restore/$name"
  log "Đã tải + giải mã + giải nén $name vào /restore:"
  ls -la /restore /restore/backups
}

case "${1:-daemon}" in
  once) run_once ;;
  restore) shift; restore "${1:-}" ;;
  daemon)
    log "chạy nền — sao lưu mỗi ngày lúc ${BACKUP_AT:-03:30}"
    last=""
    while true; do
      now=$(date +%H:%M); today=$(date +%Y%m%d)
      if [ "$now" = "${BACKUP_AT:-03:30}" ] && [ "$last" != "$today" ]; then run_once; last="$today"; fi
      sleep 30
    done
    ;;
  *) echo "cách dùng: backup.sh [once|restore [YYYYMMDD]]"; exit 2 ;;
esac
