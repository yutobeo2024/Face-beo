import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Kiosk chấm công",
  // Kiosk giữ manifest riêng (toàn màn hình, khóa ngang) — manifest gốc /manifest.webmanifest là của app nhân sự.
  manifest: "/kiosk.webmanifest",
  appleWebApp: { capable: true, title: "Face Beo Kiosk", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#020617", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-slate-950 text-white select-none">{children}</div>;
}
