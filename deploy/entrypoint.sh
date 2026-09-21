#!/bin/sh
# Khởi động container: áp migration còn thiếu (an toàn chạy lại, không xóa dữ liệu) rồi chạy Next.js.
set -e
cd /app
mkdir -p data models
npx prisma migrate deploy
exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
