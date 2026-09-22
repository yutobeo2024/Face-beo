#!/bin/sh
# Thử / thực hiện khôi phục từ Cloudflare R2 (chạy trên VPS): tải + giải mã + giải nén vào /opt/facebeo/restore, kiểm tra toàn vẹn DB.
# KHÔNG tự ghi đè dữ liệu đang chạy — in hướng dẫn thay thế ở cuối.
#   sh /opt/facebeo/src/deploy/restore-offsite.sh            # bản mới nhất
#   sh /opt/facebeo/src/deploy/restore-offsite.sh 20260922   # đúng ngày
set -e
cd /opt/facebeo/src
COMPOSE="docker compose -f deploy/docker-compose.yml -p facebeo --env-file /opt/facebeo/.env"
mkdir -p /opt/facebeo/restore
$COMPOSE run --rm -v /opt/facebeo/restore:/restore backup restore "${1:-}"
DB=$(ls -1 /opt/facebeo/restore/backups/facebeo-*.db | tail -1)
echo "== Kiểm tra toàn vẹn $(basename "$DB")"
docker run --rm -v /opt/facebeo/restore:/restore:ro --entrypoint node facebeo-app:latest --experimental-sqlite --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/restore/backups/$(basename "$DB")', { readOnly: true });
console.log('integrity_check:', db.prepare('PRAGMA integrity_check').get().integrity_check);
for (const t of ['Employee', 'AttendanceLog', 'LeaveRequest', 'Credential', 'FaceTemplate'])
  console.log(t.padEnd(14), db.prepare('SELECT COUNT(*) AS n FROM \"' + t + '\"').get().n);
"
echo "== File đi kèm: credentials $(find /opt/facebeo/restore/credentials -type f 2>/dev/null | wc -l) file, avatars $(find /opt/facebeo/restore/avatars -type f 2>/dev/null | wc -l) file, photos $(find /opt/facebeo/restore/photos -type f 2>/dev/null | wc -l) file"
cat <<EOF

Muốn THAY dữ liệu đang chạy bằng bản này (mất dữ liệu phát sinh sau thời điểm sao lưu):
  $COMPOSE stop app
  cp $DB /opt/facebeo/data/facebeo.db && rm -f /opt/facebeo/data/facebeo.db-wal /opt/facebeo/data/facebeo.db-shm
  rm -rf /opt/facebeo/data/credentials /opt/facebeo/data/avatars /opt/facebeo/data/photos
  cp -r /opt/facebeo/restore/credentials /opt/facebeo/restore/avatars /opt/facebeo/restore/photos /opt/facebeo/data/ 2>/dev/null || true
  $COMPOSE start app
Xong việc thì xóa bản tạm: rm -rf /opt/facebeo/restore
EOF
