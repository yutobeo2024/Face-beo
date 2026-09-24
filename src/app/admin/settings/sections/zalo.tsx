"use client";
/** Cấu hình → tab "Zalo OA": trạng thái kết nối, nhóm nhận tin theo loại tin, gửi tin thử, xóa nhóm, 10 tin nhóm gần nhất. */
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, IconButton, Loading } from "@/components/ui";
import { useDepartments } from "@/components/dept-select";
import { fmtDateTimeSafe, type ConfirmFn, type RunFn, type SectionProps } from "./shared";

type ZaloStatus = {
  simulated: boolean;
  env: { appId: boolean; secret: boolean; refreshTokenEnv: boolean; webhookSecret: boolean; appBaseUrl: string };
  token: { exists: boolean; expiresAt: string | null; updatedAt: string | null };
  refreshError: { at: string; msg: string } | null;
  oa: { oaId: string; name: string } | null;
  oaError: string | null;
  recent: { id: number; at: string; status: string; error: string | null; type: string; text: string; group: string | null }[];
};
type ZaloCat = "MINH_BACH" | "CHAM_CONG" | "DON_TU";
type ZaloGroupRow = {
  groupId: string;
  name: string | null;
  status: string | null;
  totalMember: number | null;
  source: string;
  categories: ZaloCat[];
  departmentIds: number[];
  error: string | null;
};
const ZALO_CATS: { key: ZaloCat; label: string; desc: string }[] = [
  { key: "MINH_BACH", label: "Minh bạch (quản trị)", desc: "Duyệt/sửa của Nhân sự & Quản trị, đăng ký/sửa ca, chốt công, đơn quá 48 giờ — kèm lý do/ghi chú, chỉ dành cho nhóm quản lý" },
  { key: "CHAM_CONG", label: "Chấm công nhân viên", desc: "Chưa chấm giờ vào, quên chấm giờ ra, vắng không phép" },
  { key: "DON_TU", label: "Đơn từ nhân viên", desc: "Đã gửi đơn, đã duyệt/từ chối/hủy, đã chấm tay bổ sung công (không kèm lý do)" },
];
const statusTone = (s: string) => (s === "SENT" ? "ontime" : s === "SIMULATED" ? "neutral" : "absent");

export function ZaloSection({ busy, run, confirm }: SectionProps) {
  // Ô dán ID/link nhóm là trạng thái riêng của thẻ — chỉ lưu khi bấm "Thêm nhóm" (server xác minh nhóm trước).
  const [groupInput, setGroupInput] = useState("");
  const z = useApi<ZaloStatus>("/api/settings/zalo");
  const groups = useApi<{ groups: ZaloGroupRow[] }>("/api/settings/zalo/groups");
  const deptList = useDepartments().data?.departments ?? [];
  const [testResult, setTestResult] = useState<Record<string, { status: string; error: string | null }>>({});
  const reload = () => (z.reload(), groups.reload());
  const numericOnly = /^\d{6,}$/.test(groupInput.trim());
  const d = z.data;
  const tone = (ok: boolean) => (ok ? "ontime" : "late");
  const sendTest = (groupId: string) =>
    run(
      async () => {
        const r = await api<{ status: string; error: string | null }>("/api/settings/zalo/test", { method: "POST", body: { groupId } });
        setTestResult((t) => ({ ...t, [groupId]: r }));
      },
      "Đã gửi tin thử — xem kết quả bên dưới",
      () => z.reload(),
    );

  if (!d)
    return (
      <Card>
        <div className="p-4">
          <Loading />
        </div>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Kết nối Zalo OA" actions={<IconButton icon="refresh" label="Tải lại" onClick={reload} />} />
        <div className="space-y-2 p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={d.simulated ? "late" : "ontime"}>{d.simulated ? "MÔ PHỎNG — tin chỉ in ra console" : "Đang gửi thật"}</Badge>
            <Badge tone={tone(d.env.appId && d.env.secret)}>App ID / Secret: {d.env.appId && d.env.secret ? "có" : "thiếu"}</Badge>
            <Badge tone={tone(d.token.exists)}>Token: {d.token.exists ? `có, hết hạn ${d.token.expiresAt ? fmtDateTimeSafe(d.token.expiresAt) : "?"}` : "chưa có"}</Badge>
            <Badge tone={d.env.webhookSecret ? "ontime" : "neutral"}>Webhook secret: {d.env.webhookSecret ? "có" : "chưa (chỉ cần khi liên kết nhân viên)"}</Badge>
          </div>
          {d.refreshError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">Refresh token lỗi lúc {fmtDateTimeSafe(d.refreshError.at)}: {d.refreshError.msg}</p>}
          {!d.simulated && (
            <p className="text-sm text-slate-700">
              OA: {d.oa ? <b>{d.oa.name}</b> : <span className="text-rose-700">không gọi được API ({d.oaError})</span>}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Nhóm nhận tin" />
        <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">
          Mỗi nhóm tích loại tin muốn nhận. Tin nhân viên (chấm công, đơn từ) có thể giới hạn theo phòng — không chọn phòng = mọi phòng. Nhóm không tích loại nào thì không nhận tin.
        </p>
        <div className="space-y-3 p-4 sm:p-5">
          {groups.data?.groups.length ? (
            <ul className="space-y-2">
              {groups.data.groups.map((g) => (
                <ZaloGroupItem
                  key={`${g.groupId}:${g.categories.join()}:${g.departmentIds.join()}`}
                  g={g}
                  depts={deptList}
                  busy={busy}
                  run={run}
                  confirm={confirm}
                  onSaved={reload}
                  onTest={() => sendTest(g.groupId)}
                  test={testResult[g.groupId]}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              Chưa có nhóm nào. Nhóm GMF tạo trong OA Manager tự xuất hiện ở đây (webhook <code>create_group</code>), hoặc dán link nhóm bên dưới.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="input flex-1 font-mono" value={groupInput} onChange={(e) => setGroupInput(e.target.value)} placeholder="Dán link chat nhóm (https://oa.zalo.me/chat?gid=…) hoặc ID nhóm" />
            <Button
              variant="secondary"
              loading={busy}
              disabled={groupInput.trim().length < 4 || numericOnly}
              onClick={() => run(() => api("/api/settings/zalo/groups", { body: { groupId: groupInput.trim() } }), "Đã thêm nhóm — tích loại tin cho nhóm rồi bấm Lưu", () => (setGroupInput(""), reload()))}
            >
              Thêm nhóm
            </Button>
          </div>
          <p className={`text-xs ${numericOnly ? "text-rose-700" : "text-slate-500"}`}>
            {numericOnly
              ? "Chuỗi toàn chữ số là ID của OA (oaid), không phải ID nhóm. ID nhóm là phần gid=… trong link chat, có lẫn chữ a–f."
              : "Link chat nhóm có dạng …/chat?gid=712b67d35bb3b2edeba2&oaid=4184…: gid là ID nhóm (hệ thống tự tách), oaid là ID của OA."}
          </p>
        </div>
      </Card>

      {d.recent.length > 0 && (
        <Card>
          <CardHeader title="10 tin nhóm gần nhất" />
          <ul className="divide-y divide-slate-100 text-xs">
            {d.recent.map((r) => (
              <li key={r.id} className="flex gap-2 px-4 py-1.5 sm:px-5">
                <span className="shrink-0 tabular-nums text-slate-400">{fmtDateTimeSafe(r.at)}</span>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {r.group ? <b className="text-slate-500">[{r.group}] </b> : null}
                  {r.error ? `${r.error} · ` : ""}
                  {r.text}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ZaloGroupItem({
  g,
  depts,
  busy,
  run,
  confirm,
  onSaved,
  onTest,
  test,
}: {
  g: ZaloGroupRow;
  depts: { id: number; name: string }[];
  busy: boolean;
  run: RunFn;
  confirm: ConfirmFn;
  onSaved: () => void;
  onTest: () => void;
  test?: { status: string; error: string | null };
}) {
  const [cats, setCats] = useState<ZaloCat[]>(g.categories);
  // Phòng đã bị xóa không hiện chip để gỡ → bỏ khỏi trạng thái (server cũng tự bỏ khi lưu).
  const [deptIds, setDeptIds] = useState<number[]>(g.departmentIds);
  const dirty = cats.join() !== g.categories.join() || deptIds.join() !== g.departmentIds.join();
  const hasStaff = cats.some((c) => c !== "MINH_BACH");
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ordered = (list: ZaloCat[]) => ZALO_CATS.map((c) => c.key).filter((k) => list.includes(k));
  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${g.categories.length ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">
            {g.name || "(chưa có tên)"} {g.categories.length ? <Badge tone="ontime">đang nhận tin</Badge> : <Badge tone="neutral">không nhận tin</Badge>}
            {g.status && g.status !== "enabled" && <Badge tone="absent">{g.status}</Badge>}
          </p>
          <p className="font-mono text-xs text-slate-500">
            {g.groupId}
            {g.totalMember != null ? ` · ${g.totalMember} thành viên` : ""} · {g.source === "WEBHOOK" ? "dò qua webhook" : "nhập tay"}
          </p>
          {g.error && <p className="text-xs text-rose-700">Không lấy được thông tin nhóm: {g.error}</p>}
        </div>
        <Button size="sm" variant="secondary" loading={busy} onClick={onTest}>
          Gửi tin thử
        </Button>
        {test && (
          <Badge tone={statusTone(test.status)}>
            {test.status}
            {test.error ? ` — ${test.error}` : ""}
          </Badge>
        )}
        <IconButton
          icon="trash"
          label="Xóa nhóm khỏi danh sách"
          className="text-rose-600 hover:bg-rose-50"
          onClick={() =>
            confirm({
              title: "Xóa nhóm Zalo",
              body: `Gỡ nhóm "${g.name || g.groupId}" khỏi danh sách? Hệ thống sẽ gửi một tin báo vào chính nhóm đó rồi ngừng gửi mọi tin. Nhật ký tin đã gửi vẫn giữ nguyên. Nếu sau này nhóm nhắn cho OA lần nữa, nhóm sẽ hiện lại ở danh sách nhưng không nhận tin cho tới khi tích lại loại tin.`,
              ok: "Đã xóa nhóm Zalo",
              fn: () => api(`/api/settings/zalo/groups/${encodeURIComponent(g.groupId)}`, { method: "DELETE" }),
              after: onSaved,
            })
          }
        />
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        {ZALO_CATS.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded-md p-1 hover:bg-slate-50">
            <input type="checkbox" className="mt-1" checked={cats.includes(c.key)} onChange={() => setCats(ordered(toggle(cats, c.key)))} />
            <span>
              <span className="font-medium text-slate-800">{c.label}</span>
              <span className="block text-xs text-slate-500">{c.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {hasStaff && (
        <div className="mt-1">
          <p className="text-xs text-slate-500">Tin nhân viên chỉ của phòng (không chọn = mọi phòng):</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {depts.map((dp) => (
              <label
                key={dp.id}
                className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${deptIds.includes(dp.id) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}
              >
                <input type="checkbox" className="sr-only" checked={deptIds.includes(dp.id)} onChange={() => setDeptIds(toggle(deptIds, dp.id).sort((a, b) => a - b))} />
                {dp.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {dirty && (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              run(() => api(`/api/settings/zalo/groups/${encodeURIComponent(g.groupId)}`, { method: "PATCH", body: { categories: cats, departmentIds: deptIds } }), "Đã lưu loại tin của nhóm", onSaved)
            }
          >
            Lưu
          </Button>
          <Button size="sm" variant="secondary" onClick={() => (setCats(g.categories), setDeptIds(g.departmentIds))}>
            Hủy
          </Button>
        </div>
      )}
    </li>
  );
}
