import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { InstallProvider } from "@/components/pwa-install";

export const metadata: Metadata = {
  title: { default: "Face Beo", template: "%s · Face Beo" },
  description: "Quản trị nhân sự, xếp ca, chấm công khuôn mặt và thông báo Zalo OA",
  applicationName: "Face Beo",
  // Manifest tĩnh (public/manifest.webmanifest) thay vì app/manifest.ts: layout con (kiosk) mới đè được bằng metadata.manifest.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Cài vào màn hình chính iPhone/iPad: mở không có thanh địa chỉ (v1.14.0).
  appleWebApp: { capable: true, title: "Face Beo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#10695a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        {/* Chrome bắn lời mời cài (beforeinstallprompt) một lần, thường trước khi React chạy xong — giữ lại để nút "Cài ứng dụng" còn dùng được. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__fbBip=e},{once:true})`,
          }}
        />
      </head>
      <body className="min-h-dvh">
        <ToastProvider>
          <InstallProvider>{children}</InstallProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
