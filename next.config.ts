import type { NextConfig } from "next";
import path from "node:path";

const humanBrowser = path.join(process.cwd(), "node_modules", "@vladmandic", "human", "dist", "human.esm.js");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "node-cron", "exceljs", "onnxruntime-node", "sharp"],
  poweredByHeader: false,
  webpack(config) {
    // Human chỉ chạy trên trình duyệt (kiosk/enroll). Luôn dùng bản ESM cho browser,
    // tránh webpack chọn bản Node (cần @tensorflow/tfjs-node) ở lượt biên dịch SSR.
    config.resolve.alias = { ...config.resolve.alias, "@vladmandic/human$": humanBrowser };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        ],
      },
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }],
      },
    ];
  },
};

export default nextConfig;
