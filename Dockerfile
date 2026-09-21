# Face Beo — image chạy production (Next.js + Prisma SQLite + onnxruntime-node + sharp).
# Dữ liệu (DB, snapshot, sao lưu, file scan, ảnh đại diện) và mô hình .onnx nằm ở volume, KHÔNG nằm trong image.
# Không dùng alpine: onnxruntime-node và sharp cần glibc.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Cài thư viện trước (tận dụng cache): postinstall = prisma generate + chép mô hình Human sang public/models.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production \
  TZ=Asia/Ho_Chi_Minh \
  LIVENESS_SERVER=true \
  PORT=3000
EXPOSE 3000
ENTRYPOINT ["sh", "/app/deploy/entrypoint.sh"]
