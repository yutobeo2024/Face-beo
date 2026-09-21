"use client";
import { useEffect, useId, useState } from "react";
import { Icon, type IconName } from "./icons";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Button
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
  danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; icon?: IconName; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition select-none disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-9 px-3 text-sm" : size === "lg" ? "h-13 px-6 text-base" : "h-11 px-4 text-[15px]",
        BTN[variant],
        className,
      )}
    >
      {loading ? <Spinner className="size-4" /> : icon ? <Icon name={icon} className={size === "sm" ? "size-4" : "size-5"} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx("inline-flex size-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40", className)}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------- Layout bits
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 max-sm:w-full max-sm:[&>*:first-child]:flex-1">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("card", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, actions, className }: { title: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5", className)}>
      <h2 className="shrink-0 text-[15px] font-semibold text-slate-800">{title}</h2>
      {actions}
    </div>
  );
}

const TONE = {
  ontime: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-600/20", dot: "bg-emerald-500" },
  late: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-600/25", dot: "bg-amber-500" },
  absent: { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-600/20", dot: "bg-rose-500" },
  leave: { bg: "bg-sky-50", text: "text-sky-700", ring: "ring-sky-600/20", dot: "bg-sky-500" },
  neutral: { bg: "bg-slate-100", text: "text-slate-600", ring: "ring-slate-500/15", dot: "bg-slate-400" },
  brand: { bg: "bg-brand-50", text: "text-brand-800", ring: "ring-brand-600/20", dot: "bg-brand-500" },
  violet: { bg: "bg-violet-50", text: "text-violet-700", ring: "ring-violet-600/20", dot: "bg-violet-500" },
} as const;
export type Tone = keyof typeof TONE;

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset", t.bg, t.text, t.ring, className)}>
      {dot && <span className={cx("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

export function StatCard({ label, value, tone = "neutral", hint, active, onClick }: { label: string; value: number | string; tone?: Tone; hint?: string; active?: boolean; onClick?: () => void }) {
  const t = TONE[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cx(
        "card relative flex min-w-0 flex-col items-start overflow-hidden p-3.5 text-left transition sm:p-4",
        onClick && "hover:border-slate-300 active:scale-[.99]",
        active && "ring-2 ring-brand-500",
      )}
    >
      <span className={cx("absolute inset-y-0 left-0 w-1", t.dot)} />
      <span className="truncate text-xs font-medium text-slate-500 sm:text-sm">{label}</span>
      <span className={cx("mt-1 text-2xl font-bold tabular-nums sm:text-3xl", t.text)}>{value}</span>
      {hint && <span className="mt-0.5 truncate text-xs text-slate-400">{hint}</span>}
    </Comp>
  );
}

export function EmptyState({ icon = "inbox", title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-2xl bg-slate-100 p-3 text-slate-400">
        <Icon name={icon} className="size-7" />
      </div>
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2">
        <Icon name="alert" className="size-5 shrink-0" /> {message}
      </span>
      {onRetry && (
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function Loading({ label = "Đang tải…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-slate-200/70", className)} />;
}

// ---------------------------------------------------------------- Form
export function Field({ label, error, hint, children, className }: { label?: string; error?: string | null; hint?: string; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      {children(id)}
      {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx("input appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cx("no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition",
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Modal / Sheet
/** Mobile: bottom sheet; desktop: hộp thoại giữa màn hình. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-slate-900/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx(
          "relative flex max-h-[92dvh] w-full animate-slide-up flex-col rounded-t-3xl bg-white shadow-[var(--shadow-pop)] sm:rounded-2xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 sm:pt-4">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <IconButton icon="x" label="Đóng" onClick={onClose} className="-mr-2" />
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

/** Chữ viết tắt trên nền màu theo tên; có `src` (ảnh khuôn mặt đại diện, v1.10.0) thì hiện ảnh, tải lỗi thì quay về chữ viết tắt. */
export function Avatar({ name, className, src }: { name: string; className?: string; src?: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (src && broken !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ảnh sau API có kiểm quyền, không qua next/image
      <img src={src} alt={name} loading="lazy" onError={() => setBroken(src)} className={cx("inline-block size-9 shrink-0 rounded-full bg-slate-100 object-cover", className)} />
    );
  }
  const parts = name.trim().split(/\s+/);
  const initials = ((parts.at(-2)?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", className)}
      style={{ background: `hsl(${hue} 45% 45%)` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
