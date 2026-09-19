import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: { default: "Face Beo", template: "%s · Face Beo" },
  description: "Quản trị nhân sự, xếp ca, chấm công khuôn mặt và thông báo Zalo OA",
  applicationName: "Face Beo",
  icons: { icon: "/icon.svg" },
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
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
