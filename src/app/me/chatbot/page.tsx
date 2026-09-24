"use client";
/**
 * Chat bot tra cứu y khoa (v1.17.0) — giao diện nằm hẳn trong Face Beo.
 * Mọi lượt hỏi đi qua /api/me/chatbot/ask (máy chủ Face Beo kiểm đăng nhập + quyền rồi mới gọi chat bot),
 * nên trình duyệt không biết địa chỉ chat bot và chia sẻ link ra ngoài cũng vô nghĩa.
 * Lịch sử hội thoại CHỈ nằm trên máy người dùng (localStorage) — máy chủ không lưu nội dung.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, ApiError } from "@/lib/client/api";
import { Avatar, Badge, Button, Card, cx, IconButton, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useMe } from "../me-nav";
import { SPECIALTIES } from "./knowledge";

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

export default function ChatbotPage() {
  const me = useMe();
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>(welcome);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState(newId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState<{ used: number; limit: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const skipSave = useRef(false);

  const convsRef = useRef<Conversation[]>([]);
  convsRef.current = convs;
  const key = storageKey(me.id);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY); // dọn khóa dùng chung của bản đầu
    } catch {
      /* trình duyệt chặn lưu trữ */
    }
    setConvs(load(key));
  }, [key]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
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
    if (!first) return;
    const title = first.content.length > 40 ? `${first.content.slice(0, 40).trim()}…` : first.content;
    // Ghi ra localStorage ở ngoài hàm cập nhật state (React có thể gọi hàm đó hai lần ở chế độ kiểm tra).
    const next = [{ id: convId, title, messages, at: Date.now() }, ...convsRef.current.filter((c) => c.id !== convId)].slice(0, MAX_CONVERSATIONS);
    setConvs(save(key, next));
  }, [messages, convId, key]);

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
      setText("");
      const mine: Msg = { id: newId(), role: "user", content: q || "(Gửi ảnh)", images: files.length || undefined };
      const history = messages.filter((m) => m.id !== "welcome").slice(-10).map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, mine]);
      const sending = files;
      setFiles([]);
      try {
        const attachments = await Promise.all(sending.map(async (f) => ({ data: await fileToBase64(f), mime_type: f.type })));
        const r = await api<{ reply_text: string; sources: unknown[]; used: number; limit: number }>("/api/me/chatbot/ask", {
          body: { message: q, attachments, history },
        });
        setUsed({ used: r.used, limit: r.limit });
        setMessages((prev) => [...prev, { id: newId(), role: "ai", content: r.reply_text || "(Chat bot không trả lời được câu này)" }]);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Không gọi được Chat bot. Thử lại sau ít phút.";
        setMessages((prev) => [...prev, { id: newId(), role: "ai", content: `⚠️ ${msg}` }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, files, messages],
  );

  function openConv(c: Conversation) {
    if (busy) return;
    skipSave.current = true;
    setConvId(c.id);
    setMessages(c.messages);
    setShowHistory(false);
  }
  function newChat() {
    if (busy) return;
    skipSave.current = true;
    setConvId(newId());
    setMessages(welcome());
    setFiles([]);
    setShowHistory(false);
  }
  function clearHistory() {
    setConvs([]);
    save(key, []);
    toast.success("Đã xóa lịch sử trên máy này");
  }

  return (
    <>
      <PageHeader
        title="Chat bot tra cứu"
        subtitle="Hỏi về quy trình kỹ thuật, phác đồ điều trị, sơ cứu. Câu trả lời do AI tổng hợp từ tài liệu đã nạp — vẫn phải tự kiểm chứng trước khi áp dụng."
        actions={
          <div className="flex items-center gap-2">
            {used && (
              <Badge tone={used.used >= used.limit ? "absent" : "neutral"}>
                {used.used}/{used.limit} câu hôm nay
              </Badge>
            )}
            <Button size="sm" variant="secondary" icon="plus" onClick={newChat} disabled={busy}>
              Hỏi mới
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <Card className="flex min-h-[60dvh] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            {messages.map((m) => (
              <div key={m.id} className={cx("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "ai" && (
                  <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-800">
                    <Icon name="chat" className="size-4" />
                  </span>
                )}
                <div
                  className={cx(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user" ? "bg-brand-700 text-white" : "bg-slate-50 text-slate-800 ring-1 ring-slate-100",
                  )}
                >
                  {m.role === "ai" ? <Markdown>{m.content}</Markdown> : <p className="whitespace-pre-wrap">{m.content}</p>}
                  {!!m.images && <p className="mt-1 text-xs opacity-80">📎 {m.images} ảnh</p>}
                </div>
                {m.role === "user" && <Avatar name={me.name} className="mt-1 size-8" />}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-brand-800">
                  <Icon name="chat" className="size-4" />
                </span>
                <span className="animate-pulse">Đang tra tài liệu…</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {!!files.length && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 pt-3 sm:px-5">
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
              className="input min-h-11 flex-1 resize-none py-2.5"
              rows={1}
              placeholder="Nhập câu hỏi… (Enter để gửi, Shift+Enter xuống dòng)"
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            <Button type="submit" loading={busy} disabled={!text.trim() && !files.length}>
              Gửi
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 sm:px-5" onClick={() => setShowHistory((v) => !v)}>
              Hội thoại đã hỏi ({convs.length})
              <Icon name={showHistory ? "chevronLeft" : "chevronRight"} className="size-4" />
            </button>
            {showHistory && (
              <div className="border-t border-slate-100">
                <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
                  {convs.map((c) => (
                    <li key={c.id}>
                      <button type="button" className={cx("w-full truncate px-4 py-2 text-left hover:bg-slate-50 sm:px-5", c.id === convId && "bg-brand-50 text-brand-800")} onClick={() => openConv(c)}>
                        {c.title}
                      </button>
                    </li>
                  ))}
                  {!convs.length && <li className="px-4 py-3 text-xs text-slate-500 sm:px-5">Chưa có hội thoại nào.</li>}
                </ul>
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 sm:px-5">
                  <p className="text-xs text-slate-500">Lịch sử chỉ nằm trên máy này.</p>
                  {!!convs.length && (
                    <Button size="sm" variant="ghost" onClick={clearHistory}>
                      Xóa
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <p className="px-4 pt-3 text-sm font-semibold text-slate-700 sm:px-5">Gợi ý theo chuyên khoa</p>
            <ul className="max-h-[26rem] space-y-1 overflow-y-auto p-3 sm:px-5">
              {SPECIALTIES.map((s) => (
                <li key={s.name}>
                  <details className="rounded-lg border border-slate-100">
                    <summary className="cursor-pointer px-2.5 py-2 text-sm text-slate-700">{s.name}</summary>
                    <ul className="space-y-1 px-2 pb-2">
                      {s.questions.map((q) => (
                        <li key={q}>
                          <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-brand-800 hover:bg-brand-50" disabled={busy} onClick={() => void send(q)}>
                            {q}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
