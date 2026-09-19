"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Field } from "@/components/ui";
import { Icon } from "@/components/icons";

type LoginRes = { role: string; mustChangePassword: boolean; name: string };

function destination(role: string, next: string | null) {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    if (next.startsWith("/admin") && role === "EMPLOYEE") return "/me";
    return next;
  }
  return role === "EMPLOYEE" ? "/me" : "/admin";
}

export default function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [step, setStep] = useState<"login" | "change">(sp.get("change") ? "change" : "login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("EMPLOYEE");

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<LoginRes>("/api/auth/login", { body: { login: login.trim(), password } });
      setRole(r.role);
      if (r.mustChangePassword) setStep("change");
      else router.replace(destination(r.role, sp.get("next")));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onChange(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (newPw !== newPw2) return setErr("Hai mật khẩu mới không khớp");
    setBusy(true);
    try {
      const r = await api<{ role: string }>("/api/auth/change-password", { body: { currentPassword: password, newPassword: newPw } });
      router.replace(destination(r.role ?? role, sp.get("next")));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card animate-pop p-6 shadow-[var(--shadow-pop)]">
      {step === "login" ? (
        <form onSubmit={onLogin} className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Đăng nhập</h2>
            <p className="text-sm text-slate-500">Dùng mã nhân viên hoặc số điện thoại.</p>
          </div>
          <Field label="Mã nhân viên / Số điện thoại">
            {(id) => (
              <input id={id} className="input" autoComplete="username" inputMode="text" autoCapitalize="characters" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="VD: NV001 hoặc 0901…" required />
            )}
          </Field>
          <Field label="Mật khẩu">
            {(id) => (
              <div className="relative">
                <input id={id} className="input pr-11" type={showPw ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600" aria-label={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
                  <Icon name="eye" />
                </button>
              </div>
            )}
          </Field>
          {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
          <Button type="submit" className="w-full" size="lg" loading={busy}>
            Đăng nhập
          </Button>
        </form>
      ) : (
        <form onSubmit={onChange} className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Đổi mật khẩu lần đầu</h2>
            <p className="text-sm text-slate-500">Vì bảo mật, bạn cần đặt mật khẩu mới trước khi dùng hệ thống.</p>
          </div>
          {!password && (
            <Field label="Mật khẩu hiện tại">
              {(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
            </Field>
          )}
          <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự, có cả chữ và số.">
            {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} minLength={8} required />}
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} minLength={8} required />}
          </Field>
          {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
          <Button type="submit" className="w-full" size="lg" loading={busy}>
            Lưu và tiếp tục
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
            onClick={async () => {
              await api("/api/auth/logout", { body: {} }).catch(() => {});
              setStep("login");
              setPassword("");
            }}
          >
            Đăng nhập tài khoản khác
          </button>
        </form>
      )}
    </div>
  );
}
