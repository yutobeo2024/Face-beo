"use client";

/**
 * Cài Face Beo thành app (v1.14.0): bắt lời mời cài của trình duyệt, hiện thanh nhắc + mục "Cài ứng dụng" trong menu,
 * ẩn hẳn khi đã cài. iOS Safari không có hộp thoại cài → hướng dẫn 3 bước. Đăng ký service worker (chỉ khi kết nối an toàn).
 * Luồng quyết định nằm ở src/lib/pwa.ts (có test).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button, Modal, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SNOOZE_KEY, detectPlatform, isInstalled, parseSnooze, shouldShowBanner, shouldShowMenuItem, snoozeUntil, type Platform } from "@/lib/pwa";

type BipEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

type Ctx = {
  installed: boolean;
  platform: Platform;
  canPrompt: boolean;
  showBanner: boolean;
  install: () => void;
  snooze: () => void;
};
const InstallCtx = createContext<Ctx | null>(null);
export const useInstall = () => useContext(InstallCtx);

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // chế độ ẩn danh / chặn lưu trữ
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* bỏ qua: chỉ mất phần ghi nhớ "Để sau" */
  }
};

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [deferred, setDeferred] = useState<BipEvent | null>(null);
  const [installed, setInstalled] = useState(true); // mặc định "đã cài" để không nháy thanh nhắc trước khi kiểm tra xong
  const [platform, setPlatform] = useState<Platform>("unsupported");
  const [snoozed, setSnoozed] = useState(0);
  const [iosHelp, setIosHelp] = useState(false);
  const kiosk = pathname.startsWith("/kiosk");

  useEffect(() => {
    if (kiosk) return; // kiosk có manifest + luồng camera riêng, không đụng vào
    const mql = window.matchMedia("(display-mode: standalone)");
    // Safari / iOS cũ chỉ có addListener — không bọc thì cả ứng dụng trắng màn hình (component này nằm ở layout gốc).
    const listen = (on: boolean) => {
      const m = mql as MediaQueryList & { addListener?: (cb: () => void) => void; removeListener?: (cb: () => void) => void };
      if (m.addEventListener) (on ? m.addEventListener : m.removeEventListener).call(m, "change", check);
      else (on ? m.addListener : m.removeListener)?.call(m, check);
    };
    const check = () =>
      setInstalled(isInstalled({ standalone: mql.matches, iosStandalone: !!(navigator as { standalone?: boolean }).standalone, referrer: document.referrer }));
    check();
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
    setSnoozed(parseSnooze(read(SNOOZE_KEY)));

    const onBip = (e: Event) => {
      e.preventDefault(); // giữ lại để hiện lời mời đúng lúc người dùng bấm
      setDeferred(e as BipEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      write(SNOOZE_KEY, "0");
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    listen(true);
    // Chrome bắn beforeinstallprompt rất sớm, thường trước khi React chạy → đoạn script ở layout gốc giữ hộ, lấy lại ở đây.
    const early = (window as { __fbBip?: BipEvent }).__fbBip;
    if (early) setDeferred(early);

    // Service worker: bắt buộc để Chrome cho cài. Chỉ chạy khi kết nối an toàn (https / localhost) — LAN http thì bỏ qua.
    if (window.isSecureContext && "serviceWorker" in navigator) {
      const reg = () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
      if (document.readyState === "complete") reg();
      else window.addEventListener("load", reg, { once: true });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      listen(false);
    };
  }, [kiosk]);

  const closeHelp = useCallback(() => setIosHelp(false), []);

  const install = useCallback(() => {
    if (deferred) {
      void deferred.prompt().then(() =>
        deferred.userChoice.then(({ outcome }) => {
          setDeferred(null); // lời mời chỉ dùng được một lần
          if (outcome === "dismissed") {
            const until = snoozeUntil(Date.now());
            write(SNOOZE_KEY, String(until));
            setSnoozed(until);
          }
        }),
      );
      return;
    }
    setIosHelp(true); // iOS / webview / Chrome lỡ mất lời mời: chỉ có thể hướng dẫn tay
  }, [deferred]);

  const snooze = useCallback(() => {
    const until = snoozeUntil(Date.now());
    write(SNOOZE_KEY, String(until));
    setSnoozed(until);
  }, []);

  const value: Ctx = {
    installed,
    platform,
    canPrompt: !!deferred,
    showBanner: !kiosk && shouldShowBanner({ installed, canPrompt: !!deferred, platform, snoozedUntil: snoozed, now: Date.now(), pathname }),
    install,
    snooze,
  };

  return (
    <InstallCtx.Provider value={value}>
      {children}
      <InstallHelp open={iosHelp} platform={platform} onClose={closeHelp} />
    </InstallCtx.Provider>
  );
}

/** Thanh nhắc cài (ẩn sau khi bấm "Để sau" 14 ngày, ẩn hẳn khi đã cài). */
export function InstallBanner() {
  const s = useInstall();
  if (!s?.showBanner) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white shadow-[var(--shadow-pop)]">
      <Icon name="download" className="size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Cài Face Beo vào máy</p>
        <p className="text-sm text-brand-100">Mở nhanh như một ứng dụng, không còn thanh địa chỉ.</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={s.snooze} className="h-9 rounded-xl px-3 text-sm font-medium text-brand-100 hover:bg-white/10">
          Để sau
        </button>
        <button type="button" onClick={s.install} className="h-9 rounded-xl bg-white px-4 text-sm font-semibold text-brand-800 hover:bg-brand-50">
          {s.canPrompt ? "Cài đặt" : "Xem cách cài"}
        </button>
      </div>
    </div>
  );
}

/** Mục "Cài ứng dụng" trong menu (thanh bên máy tính / ngăn kéo điện thoại). */
export function InstallMenuItem({ variant }: { variant: "sidebar" | "drawer" }) {
  const s = useInstall();
  if (!s || !shouldShowMenuItem(s)) return null;
  return (
    <button
      type="button"
      onClick={s.install}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl",
        variant === "sidebar" ? "px-3 py-2 text-sm text-brand-100/80 hover:bg-white/10 hover:text-white" : "px-3 py-2.5 text-[15px] text-slate-600 hover:bg-slate-100",
      )}
    >
      <Icon name="download" className={variant === "sidebar" ? "size-5" : undefined} /> Cài ứng dụng
    </button>
  );
}

function InstallHelp({ open, platform, onClose }: { open: boolean; platform: Platform; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Cài Face Beo vào máy">
      {platform === "prompt" ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p>Trình duyệt chưa sẵn sàng mời cài (thường do vừa mở trang). Bạn có thể cài bằng tay:</p>
          <p>
            <b>Máy tính</b>: bấm biểu tượng cài ở cuối thanh địa chỉ, hoặc menu <b>⋮</b> → <b>Truyền, lưu và chia sẻ</b> → <b>Cài Face Beo</b>.
          </p>
          <p>
            <b>Android</b>: menu <b>⋮</b> → <b>Thêm vào Màn hình chính</b> (hoặc <b>Cài ứng dụng</b>).
          </p>
        </div>
      ) : platform === "webview" ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p>Bạn đang mở Face Beo bên trong một ứng dụng khác (Zalo, Facebook…), nên chưa cài được.</p>
          <p>
            Bấm nút <b>…</b> (hoặc <b>Chia sẻ</b>) ở góc màn hình → chọn <b>Mở trong trình duyệt</b> (Safari trên iPhone, Chrome trên Android), rồi cài từ đó.
          </p>
        </div>
      ) : (
        <ol className="space-y-3 text-sm text-slate-700">
          <li>
            1. Bấm nút <b>Chia sẻ</b> <span aria-hidden>⬆︎</span> ở thanh dưới của Safari.
          </li>
          <li>
            2. Kéo xuống, chọn <b>Thêm vào MH chính</b> (Add to Home Screen).
          </li>
          <li>
            3. Bấm <b>Thêm</b>. Biểu tượng Face Beo hiện trên màn hình chính, mở ra không còn thanh địa chỉ.
          </li>
          <li className="text-slate-500">Lần đầu mở từ biểu tượng, bạn cần đăng nhập lại một lần (app và trình duyệt đăng nhập riêng).</li>
        </ol>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Đã hiểu
        </Button>
      </div>
    </Modal>
  );
}
