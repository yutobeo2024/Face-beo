"use client";
/** Hiện câu trả lời dạng Markdown (v1.17.0). Tách riêng để react-markdown chỉ tải ở trang Chat bot. */
import ReactMarkdown, { type Components } from "react-markdown";

const components: Components = {
  // Ảnh minh họa đi qua /api/me/chatbot/static (có kiểm quyền) — chặn ảnh trỏ ra ngoài.
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : "";
    if (!url.startsWith("/api/me/chatbot/static/")) return null;
    // eslint-disable-next-line @next/next/no-img-element -- ảnh lấy qua API có kiểm quyền, không qua next/image
    return <img src={url} alt={alt ?? ""} loading="lazy" decoding="async" className="mt-2 max-w-full rounded-xl ring-1 ring-slate-200" />;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-800 underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="scroll-x my-2">
      <table className="tbl text-xs">{children}</table>
    </div>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat space-y-2 [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:font-semibold">
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
