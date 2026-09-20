"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button, Card, Field, PageHeader } from "@/components/ui";
import { useToast } from "@/components/toast";

/** Tự đổi mật khẩu (mọi vai trò). Quên mật khẩu thì nhờ Nhân sự đặt lại trong hồ sơ — luồng đó không đi qua trang này. */
export default function PasswordPage() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== next2) return setErr("Hai mật khẩu mới không khớp");
    setBusy(true);
    try {
      // API cấp phiên mới cho trình duyệt này và thu hồi mọi phiên khác của tài khoản.
      await api("/api/auth/change-password", { body: { currentPassword: current, newPassword: next } });
      setDone(true);
      setCurrent("");
      setNext("");
      setNext2("");
      toast.success("Đã đổi mật khẩu");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Đổi mật khẩu" subtitle="Cần nhập đúng mật khẩu hiện tại. Sau khi đổi, các thiết bị khác đang đăng nhập tài khoản này sẽ bị thoát." />
      <Card className="p-5">
        {done ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Đã đổi mật khẩu. Thiết bị này vẫn đăng nhập; thiết bị khác cần đăng nhập lại bằng mật khẩu mới.</p>
            <Button variant="secondary" onClick={() => setDone(false)}>
              Đổi lần nữa
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Mật khẩu hiện tại">
              {(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
            </Field>
            <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự, có cả chữ và số.">
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />}
            </Field>
            <Field label="Nhập lại mật khẩu mới">
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} minLength={8} required />}
            </Field>
            {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
            <Button type="submit" loading={busy}>
              Lưu mật khẩu mới
            </Button>
          </form>
        )}
      </Card>
      <p className="text-sm text-slate-500">Quên mật khẩu hiện tại? Báo Nhân sự để được đặt lại mật khẩu tạm; đăng nhập bằng mật khẩu tạm rồi hệ thống sẽ yêu cầu đổi.</p>
    </div>
  );
}
