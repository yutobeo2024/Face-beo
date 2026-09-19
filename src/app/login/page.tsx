import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-slate-900 px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-brand-400/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-emerald-300/10 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="mb-3 size-14 rounded-2xl shadow-lg" />
          <h1 className="text-2xl font-bold tracking-tight">Face Beo</h1>
          <p className="mt-1 text-sm text-brand-100/80">Chấm công khuôn mặt · Xếp ca · Đơn từ</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-xs text-brand-100/60">© {new Date().getFullYear()} Face Beo</p>
      </div>
    </main>
  );
}
