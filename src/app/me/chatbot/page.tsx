"use client";
/**
 * Chat bot tra cứu y khoa (v1.18.0) — giao diện nằm hẳn trong Face Beo.
 * Mọi lượt hỏi đi qua /api/me/chatbot/ask/stream (máy chủ Face Beo kiểm đăng nhập + quyền rồi mới gọi chat bot),
 * nên trình duyệt không biết địa chỉ chat bot và chia sẻ link ra ngoài cũng vô nghĩa.
 * Câu trả lời về THEO LUỒNG: Gemini viết một câu dài mất cả phút, chờ đủ rồi mới hiện thì tưởng máy treo.
 * Lịch sử hội thoại CHỈ nằm trên máy người dùng (localStorage) — máy chủ không lưu nội dung.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/client/api";
import { rewriteImagePaths } from "@/lib/client/chatbot-text";
import { Avatar, Button, cx, IconButton } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useMe } from "../me-nav";
import { TOPICS } from "./knowledge";

// react-markdown chỉ nạp ở trang này (khoảng 40 KB nén) — các trang khác không phải tải.
const Markdown = dynamic(() => import("./markdown").then((m) => m.Markdown), {
  ssr: false,
  loading: () => <p className="text-sm text-slate-400">Đang hiện câu trả lời…</p>,
});

/**
 * Lịch sử lưu RIÊNG cho từng mã nhân viên: tablet / máy dùng chung có nhiều người đăng nhập lần lượt,
 * một khóa chung sẽ cho người sau đọc được hội thoại của người trước.
 */
const storageKey = (employeeId: number) => `facebeo.chatbot.v1.${employeeId}`;
/** Khóa dùng chung của bản đầu (v1.17.0 lúc mới ra) — xóa đi cho khỏi còn hội thoại của người khác nằm lại trên máy. */
const LEGACY_STORAGE_KEY = "facebeo.chatbot.v1";
const MAX_CONVERSATIONS = 20;
/** Trần chỗ lưu lịch sử trên máy (ký tự JSON) — 20 hội thoại dài vẫn vừa. */
const MAX_STORED_CHARS = 1_500_000;
const MAX_ATTACHMENTS = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const WELCOME =
  "Xin chào! Mình là trợ lý tra cứu y khoa của phòng khám. Bạn có thể hỏi về quy trình kỹ thuật, phác đồ điều trị, cách sơ cứu… hoặc gửi kèm ảnh để mình xem giúp.";

type Msg = { id: string; role: "user" | "ai"; content: string; images?: number };
type Conversation = { id: string; title: string; messages: Msg[]; at: number };

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const welcome = (): Msg[] => [{ id: "welcome", role: "ai", content: WELCOME }];

/** Đọc lịch sử trên máy. Dữ liệu cũ / hỏng (người dùng tự sửa, bản cũ của trang) thì bỏ qua, không làm vỡ trang. */
function load(key: string): Conversation[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (c): c is Conversation =>
          !!c &&
          typeof c === "object" &&
          typeof (c as Conversation).id === "string" &&
          typeof (c as Conversation).title === "string" &&
          Array.isArray((c as Conversation).messages) &&
          (c as Conversation).messages.every((m) => !!m && typeof m.content === "string" && (m.role === "user" || m.role === "ai")),
      )
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return []; // chế độ ẩn danh / trình duyệt chặn lưu trữ
  }
}
/** Ghi lịch sử, bỏ bớt hội thoại cũ nhất nếu vượt hạn mức chỗ lưu của trình duyệt (~5 MB cho cả tên miền). */
function save(key: string, list: Conversation[]) {
  let keep = list;
  try {
    while (keep.length && JSON.stringify(keep).length > MAX_STORED_CHARS) keep = keep.slice(0, -1);
    localStorage.setItem(key, JSON.stringify(keep));
  } catch {
    /* lịch sử chỉ là tiện ích, mất cũng không sao */
  }
  return keep;
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Không đọc được ảnh"));
    r.readAsDataURL(file);
  });

/** Ba chấm nhấp nháy trong lúc chờ chữ đầu tiên. */
function Dots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

export default function ChatbotPage() {
  const me = useMe();
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>(welcome);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState(newId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  /** Đã nhận được chữ đầu tiên chưa (để đổi "Đang tra tài liệu…" sang chữ chạy). */
  const [streaming, setStreaming] = useState(false);
  const [used, setUsed] = useState<{ used: number; limit: number } | null>(null);
  const [panel, setPanel] = useState(false);
  /** Màn hình rộng: bảng bên nằm cạnh; điện thoại: bảng trượt đè. Chỉ dựng một bản trong DOM. */
  const [wide, setWide] = useState(false);
  const stopRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const skipSave = useRef(false);
  const convsRef = useRef<Conversation[]>([]);
  convsRef.current = convs;
  const key = storageKey(me.id);

  // Màn hình rộng thì mở sẵn bảng bên (vẫn đóng được); điện thoại thì để dành chỗ cho khung chat.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      setWide(mq.matches);
      setPanel(mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Rời trang giữa chừng thì buông luôn câu đang hỏi (máy chủ trả lại lượt nếu chưa ra chữ nào).
  useEffect(() => () => stopRef.current?.abort(), []);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY); // dọn khóa dùng chung của bản đầu
    } catch {
      /* trình duyệt chặn lưu trữ */
    }
    setConvs(load(key));
  }, [key]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  useEffect(() => {
    api<{ used: number; limit: number }>("/api/me/chatbot/ask")
      .then(setUsed)
      .catch(() => {});
  }, []);

  // Lưu hội thoại hiện tại vào máy sau mỗi tin nhắn (không gửi lên máy chủ).
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const first = messages.find((m) => m.role === "user");
    if (!first || busy) return; // đang chạy luồng thì đợi xong mới ghi, khỏi ghi 100 lần
    const title = first.content.length > 40 ? `${first.content.slice(0, 40).trim()}…` : first.content;
    // Ghi ra localStorage ở ngoài hàm cập nhật state (React có thể gọi hàm đó hai lần ở chế độ kiểm tra).
    const next = [{ id: convId, title, messages, at: Date.now() }, ...convsRef.current.filter((c) => c.id !== convId)].slice(0, MAX_CONVERSATIONS);
    setConvs(save(key, next));
  }, [messages, convId, key, busy]);

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) return toast.error(`Tối đa ${MAX_ATTACHMENTS} ảnh mỗi câu hỏi`);
    const ok = picked.slice(0, room).filter((f) => {
      if (!f.type.startsWith("image/")) return toast.error("Chỉ gửi được ảnh"), false;
      if (f.size > MAX_FILE_BYTES) return toast.error(`Ảnh ${(f.size / 1024 / 1024).toFixed(1)} MB — tối đa 10 MB`), false;
      return true;
    });
    if (ok.length) setFiles((f) => [...f, ...ok]);
  };

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if ((!q && !files.length) || busy) return;
      setBusy(true);
      setStreaming(false);
      setText("");
      setPanel(false);
      const mine: Msg = { id: newId(), role: "user", content: q || "(Gửi ảnh)", images: files.length || undefined };
      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      const aiId = newId();
      setMessages((prev) => [...prev, mine]);
      const sending = files;
      setFiles([]);

      /** Nối thêm chữ vào câu trả lời đang viết dở (tạo bong bóng nếu chưa có). */
      const appendToAnswer = (chunk: string) =>
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === aiId);
          if (i < 0) return [...prev, { id: aiId, role: "ai", content: chunk }];
          const next = [...prev];
          next[i] = { ...next[i], content: next[i].content + chunk };
          return next;
        });

      try {
        const attachments = await Promise.all(sending.map(async (f) => ({ data: await fileToBase64(f), mime_type: f.type })));
        const stop = new AbortController();
        stopRef.current = stop;
        const res = await fetch("/api/me/chatbot/ask/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: q, attachments, history }),
          signal: stop.signal,
        });
        if (!res.ok || !res.body) {
          const detail = await res
            .json()
            .then((b: { error?: string }) => b.error)
            .catch(() => null);
          throw new Error(detail || "Không gọi được Chat bot. Thử lại sau ít phút.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let got = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Mỗi sự kiện SSE kết thúc bằng một dòng trống.
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const name = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim();
            const raw = /^data:\s*(.*)$/m.exec(part)?.[1] ?? "{}";
            let data: { text?: string; used?: number; limit?: number; detail?: string } = {};
            try {
              data = JSON.parse(raw);
            } catch {
              continue;
            }
            if (name === "chunk" && data.text) {
              got = true;
              setStreaming(true);
              appendToAnswer(data.text);
            } else if (name === "used" && typeof data.used === "number" && typeof data.limit === "number") {
              setUsed({ used: data.used, limit: data.limit });
            } else if (name === "error") {
              appendToAnswer(`${got ? "\n\n" : ""}⚠️ ${data.detail || "Chat bot trả lời lỗi. Thử lại sau ít phút."}`);
              got = true;
            }
          }
        }
        if (!got) appendToAnswer("⚠️ Chat bot không trả lời được câu này. Thử lại sau ít phút.");
      } catch (e) {
        // Người dùng bấm Dừng / rời trang: không phải lỗi, giữ nguyên phần đã nhận.
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          const msg = e instanceof Error ? e.message : "Không gọi được Chat bot. Thử lại sau ít phút.";
          appendToAnswer(`⚠️ ${msg}`);
        }
      } finally {
        stopRef.current = null;
        setBusy(false);
        setStreaming(false);
      }
    },
    [busy, files, messages],
  );

  function openConv(c: Conversation) {
    if (busy) return;
    skipSave.current = true;
    setConvId(c.id);
    setMessages(c.messages);
    setPanel(false);
  }
  function newChat() {
    if (busy) return;
    skipSave.current = true;
    setConvId(newId());
    setMessages(welcome());
    setFiles([]);
    setPanel(false);
  }
  function removeConv(id: string) {
    const next = convsRef.current.filter((c) => c.id !== id);
    setConvs(save(key, next));
    if (id === convId) newChat();
  }
  function clearHistory() {
    setConvs([]);
    save(key, []);
    toast.success("Đã xóa lịch sử trên máy này");
  }

  const panelBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <Button className="w-full" variant="secondary" icon="plus" onClick={newChat} disabled={busy}>
          Hỏi mới
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-1 flex items-center justify-between px-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gần đây</p>
          {!!convs.length && (
            <button type="button" className="text-[11px] font-medium text-slate-500 hover:text-rose-600" onClick={clearHistory}>
              Xóa hết
            </button>
          )}
        </div>
        <ul className="mb-4 space-y-0.5">
          {convs.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                className={cx("min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100", c.id === convId ? "bg-brand-50 font-medium text-brand-800" : "text-slate-700")}
                onClick={() => openConv(c)}
              >
                {c.title}
              </button>
              <button type="button" className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => removeConv(c.id)} aria-label={`Xóa hội thoại ${c.title}`}>
                <Icon name="trash" className="size-4" />
              </button>
            </li>
          ))}
          {!convs.length && <li className="px-2 py-1.5 text-xs text-slate-500">Chưa có hội thoại nào.</li>}
        </ul>

        <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tra cứu theo chủ đề</p>
        <ul className="space-y-1">
          {TOPICS.map((t) => (
            <li key={t.key}>
              <details className="rounded-lg border border-slate-100">
                <summary className="cursor-pointer rounded-lg px-2.5 py-2 hover:bg-slate-50">
                  <span className="text-[13px] font-semibold tracking-wide text-slate-800">{t.label}</span>
                  {!t.ready && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">sắp có</span>}
                  <span className="block text-[11px] font-normal text-slate-500">{t.hint}</span>
                </summary>
                {!t.ready && (
                  <p className="mx-2 mb-1 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                    Chưa nạp tài liệu cho mục này — câu hỏi mẫu để sẵn, bấm được ngay khi tài liệu lên.
                  </p>
                )}
                <ul className="space-y-0.5 pb-1 pl-1.5">
                  {t.groups.map((g) => (
                    <li key={g.name}>
                      <details className="rounded-lg">
                        <summary className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">{g.name}</summary>
                        <ul className="space-y-0.5 py-1 pl-2">
                          {g.questions.map((q) => (
                            <li key={q}>
                              <button
                                type="button"
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-brand-800 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                                disabled={busy || !t.ready}
                                onClick={() => void send(q)}
                              >
                                {q}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Lịch sử chỉ nằm trên máy này, máy chủ không lưu nội dung.</p>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-11.5rem)] gap-4 lg:h-[calc(100dvh-5rem)]">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70">
        {/* Thanh trên: nút đóng/mở bảng bên phải nằm ngay cạnh tên trang, giống chat bot gốc */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <IconButton icon="menu" label={panel ? "Đóng bảng hội thoại" : "Mở bảng hội thoại"} onClick={() => setPanel((v) => !v)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">Chat bot tra cứu y khoa</p>
            <p className="truncate text-[11px] text-slate-500">Câu trả lời do AI tổng hợp — đối chiếu tài liệu gốc trước khi áp dụng.</p>
          </div>
          {used && (
            <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", used.used >= used.limit ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600")}>
              {used.used}/{used.limit}
              <span className="hidden sm:inline"> câu hôm nay</span>
            </span>
          )}
          <Button size="sm" variant="ghost" icon="plus" onClick={newChat} disabled={busy}>
            Hỏi mới
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
          {messages.map((m) => (
            <div key={m.id} className={cx("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "ai" && (
                <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-800">
                  <Icon name="chat" className="size-4" />
                </span>
              )}
              <div className={cx("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", m.role === "user" ? "bg-brand-700 text-white" : "bg-slate-50 text-slate-800 ring-1 ring-slate-100")}>
                {m.role === "ai" ? <Markdown>{rewriteImagePaths(m.content)}</Markdown> : <p className="whitespace-pre-wrap">{m.content}</p>}
                {!!m.images && <p className="mt-1 text-xs opacity-80">📎 {m.images} ảnh</p>}
              </div>
              {m.role === "user" && <Avatar name={me.name} className="mt-1 size-8" />}
            </div>
          ))}
          {busy && !streaming && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-brand-800">
                <Icon name="chat" className="size-4" />
              </span>
              <span>Đang tra tài liệu</span>
              <Dots />
            </div>
          )}
          <div ref={endRef} />
        </div>

        {!!files.length && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 pt-3 sm:px-5">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
                📎 {f.name.length > 22 ? `${f.name.slice(0, 22)}…` : f.name}
                <button type="button" className="text-slate-500 hover:text-rose-600" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))} aria-label={`Bỏ ảnh ${f.name}`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <form
          className="flex items-end gap-2 border-t border-slate-100 p-3 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickFiles} />
          <IconButton icon="camera" label="Đính kèm ảnh" onClick={() => fileRef.current?.click()} disabled={busy} />
          <textarea
            className="input max-h-32 min-h-11 flex-1 resize-none py-2.5"
            rows={1}
            placeholder="Nhập câu hỏi… (Enter để gửi, Shift+Enter xuống dòng)"
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              // Cao dần theo nội dung, tối đa 8rem (max-h-32) rồi mới cuộn.
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => stopRef.current?.abort()}>
              Dừng
            </Button>
          ) : (
            <Button type="submit" disabled={!text.trim() && !files.length}>
              Gửi
            </Button>
          )}
        </form>
      </section>

      {/* Bảng bên: máy tính thì nằm cạnh, điện thoại thì trượt đè lên (như chat bot gốc) */}
      {wide && panel && <aside className="w-72 shrink-0 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70">{panelBody}</aside>}
      {!wide && panel && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Đóng bảng hội thoại" onClick={() => setPanel(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[85%] max-w-xs flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">Hội thoại</p>
              <IconButton icon="x" label="Đóng" onClick={() => setPanel(false)} />
            </div>
            <div className="min-h-0 flex-1">{panelBody}</div>
          </div>
        </div>
      )}
    </div>
  );
}
