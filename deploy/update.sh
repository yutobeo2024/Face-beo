#!/bin/sh
# Cập nhật Face Beo trên VPS lên bản mới nhất ở GitHub (migration tự áp khi container khởi động).
# Chạy: sh /opt/facebeo/src/deploy/update.sh [tag]   — không truyền tag thì lấy main mới nhất.
set -e
cd /opt/facebeo/src
git fetch --tags --quiet
if [ -n "$1" ]; then git checkout --quiet "$1"; else git checkout --quiet main && git pull --quiet --ff-only; fi
echo "Phiên bản: $(git describe --tags --always)"
COMPOSE="docker compose -f deploy/docker-compose.yml -p facebeo --env-file /opt/facebeo/.env"
$COMPOSE build app
$COMPOSE up -d
echo "Chờ app khởi động…"
for i in $(seq 1 60); do
  if docker exec facebeo-app-1 curl -fsS -o /dev/null http://localhost:3000/login 2>/dev/null; then echo "OK: /login trả 200"; exit 0; fi
  sleep 3
done
echo "LỖI: app chưa lên sau 3 phút — xem: docker logs --tail 100 facebeo-app-1" >&2
exit 1
