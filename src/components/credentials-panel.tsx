"use client";
/**
 * Hồ sơ hành nghề (v1.9.0): GPHN, văn bằng / chứng chỉ / CME kèm file scan, tiến độ CME, cảnh báo.
 * Dùng chung cho trang Nhân sự (/admin/employees/[id]/credentials — sửa được) và trang cá nhân /me (chỉ đọc).
 */
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { fmtDateTime, fmtDay, todayStr } from "@/lib/client/format";
import { Badge, Button, Card, CardHeader, cx, ErrorBox, Field, IconButton, Loading, Modal, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";

const STATUS: Record<string, string> = { ACTIVE: "Hoạt động", SUSPENDED: "Đình chỉ", REVOKED: "Thu hồi / không còn hoạt động", UNKNOWN: "Chưa rõ" };
const SUBJECTS = ["Bác sĩ", "Y sĩ", "Điều dưỡng", "Hộ sinh", "Kỹ thuật y", "Dược sĩ", "Khác"];
const TYPES: Record<string, string> = {
  DEGREE: "Văn bằng",
  SPECIALTY: "Chứng chỉ chuyên môn / định hướng",
  CME: "CME (đào tạo liên tục)",
  CDNN: "Chức danh nghề nghiệp",
  RADIATION: "An toàn bức xạ",
  LANG_IT: "Ngoại ngữ – tin học",
  TEACHING: "Sư phạm y học",
  OTHER: "Khác",
};
const MAX_FILE = 10 * 1024 * 1024;

type License = {
  number: string;
  issuedAt: string;
  issuer: string;
  subject: string;
  scope: string;
  status: string;
  expiresAt: string | null;
  renewedAt: string | null;
  cmeCycleStart: string;
  workplaceNote: string | null;
  verifiedAt: string | null;
  medinetCheckedAt?: string | null;
  medinetResult?: string | null;
};
type MnWorkplace = { facilityLicense: string | null; facility: string; position: string | null; department: string | null; startDate: string | null; endDate: string | null; schedule: string | null };
type MnRecord = { name: string; number: string; issuedAt: string | null; issuer: string | null; subject: string | null; scope: string | null; statusText: string | null; status: string; workplaces: MnWorkplace[] };
type MnResult = { ok: boolean; found?: boolean; ambiguous?: boolean; record?: MnRecord; diffs?: { field: string; local: string | null; remote: string | null; severity: string }[]; elsewhere?: MnWorkplace[]; atClinic?: boolean | null; error?: string; errorAt?: string };
const MN_FIELD: Record<string, string> = { name: "Họ tên", issuedAt: "Ngày cấp", issuer: "Nơi cấp", subject: "Đối tượng", scope: "Phạm vi chuyên môn", status: "Tình trạng" };
const parseMn = (raw: string | null | undefined): MnResult | null => {
  try {
    return raw ? (JSON.parse(raw) as MnResult) : null;
  } catch {
    return null;
  }
};

/** Kết quả lần tra medinet gần nhất: tình trạng, chỗ khác hồ sơ (tô đỏ), nơi công tác. */
function MedinetBox({ at, r }: { at: string | null | undefined; r: MnResult }) {
  const fmtD = (x: string | null | undefined) => (x ? fmtDay(x) : "—");
  return (
    <div className="mx-4 mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm sm:mx-5">
      <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-slate-800">
        <Icon name="search" className="size-4" /> Kết quả medinet {at && <span className="font-normal text-slate-500">· tra lúc {fmtDateTime(at)}</span>}
        {r.ok === false && <Badge tone="late">Lần tra gần nhất lỗi — đang hiện kết quả cũ</Badge>}
      </p>
      {r.error && <p className="mb-2 text-xs text-amber-800">{r.error}</p>}
      {r.found === false && r.ambiguous && <p className="text-amber-800">medinet có nhiều hồ sơ cùng số GPHN này, không phân định được người nào — bấm “Mở medinet” để tra tay.</p>}
      {r.found === false && !r.ambiguous && <p className="text-amber-800">Không tìm thấy số GPHN này trên medinet (Sở Y tế TP.HCM). Kiểm tra lại số, hoặc GPHN do tỉnh khác cấp — tra tay.</p>}
      {r.found && r.record && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.record.name}</span>
            <Badge tone={r.record.status === "ACTIVE" ? "ontime" : r.record.status === "UNKNOWN" ? "neutral" : "absent"}>{r.record.statusText ?? "?"}</Badge>
            {r.diffs?.length ? <Badge tone="absent">{r.diffs.length} điểm khác hồ sơ</Badge> : <Badge tone="ontime">Khớp hồ sơ</Badge>}
          </div>
          {!!r.diffs?.length && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Mục</th>
                  <th className="py-1 pr-2 font-medium">Hồ sơ</th>
                  <th className="py-1 font-medium">medinet</th>
                </tr>
              </thead>
              <tbody>
                {r.diffs.map((x) => (
                  <tr key={x.field} className={x.severity === "danger" ? "text-rose-700" : "text-amber-800"}>
                    <td className="py-0.5 pr-2">{MN_FIELD[x.field] ?? x.field}</td>
                    <td className="py-0.5 pr-2">{x.field === "status" ? (STATUS[x.local ?? ""] ?? x.local) : x.field === "issuedAt" ? fmtD(x.local) : x.local}</td>
                    <td className="py-0.5 font-semibold">{x.field === "issuedAt" ? fmtD(x.remote) : x.remote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.atClinic === false && <p className="mt-2 text-amber-800">medinet chưa ghi nơi công tác tại phòng khám (theo số GPHĐ trong Cấu hình).</p>}
          {!!r.record.workplaces.length && (
            <details className="mt-2" open={!!r.elsewhere?.length}>
              <summary className="cursor-pointer text-slate-600">
                Nơi công tác trên medinet ({r.record.workplaces.length}){r.elsewhere?.length ? <span className="font-semibold text-amber-800"> · {r.elsewhere.length} nơi khác đang đăng ký</span> : null}
              </summary>
              <ul className="mt-1 space-y-1 text-xs">
                {r.record.workplaces.map((w, i) => {
                  const other = r.elsewhere?.some((e) => e.facility === w.facility && e.facilityLicense === w.facilityLicense);
                  return (
                    <li key={i} className={other ? "text-amber-900" : "text-slate-600"}>
                      {other && "⚠ "}
                      <b>{w.facility}</b>
                      {w.facilityLicense && ` (${w.facilityLicense})`}
                      {w.department && ` · Khoa ${w.department}`} · từ {fmtD(w.startDate)}
                      {w.endDate && ` đến ${fmtD(w.endDate)}`}
                      {w.schedule && <span className="block text-slate-500">{w.schedule}</span>}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
type Cred = { id: number; type: string; name: string; issuer: string | null; number: string | null; issuedAt: string | null; expiresAt: string | null; cmeHours: number | null; hasFile: boolean; fileName: string | null; fileSize: number | null };
type Profile = {
  employee: { id: number; code: string; name: string; jobTitle: string | null };
  license: License | null;
  credentials: Cred[];
  cme: { twoYearFrom: string; twoYearHours: number; twoYearRequired: number; cycle: { from: string; to: string; hours: number; daysLeft: number } | null; cycleRequired: number };
  issues: { kind: string; severity: "danger" | "warn"; text: string }[];
  requiresLicense: boolean;
  medinetUrl: string;
  canEdit: boolean;
};

type LicForm = Record<"number" | "issuedAt" | "issuer" | "subject" | "scope" | "status" | "expiresAt" | "renewedAt" | "cmeCycleStart" | "workplaceNote", string>;
type CredForm = { id?: number; type: string; name: string; issuer: string; number: string; issuedAt: string; expiresAt: string; cmeHours: string; file: File | null };

const d = (s: string | null | undefined) => (s ? fmtDay(s) : "—");

function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const ok = value >= max;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className={cx("font-semibold", ok ? "text-emerald-700" : "text-amber-700")}>
          {value}/{max} tiết
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cx("h-full rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

async function uploadFile(employeeId: number, credId: number, file: File) {
  if (file.size > MAX_FILE) throw new Error("File quá lớn (tối đa 10 MB)");
  const res = await fetch(`/api/employees/${employeeId}/credentials/${credId}/file`, {
    method: "POST",
    body: await file.arrayBuffer(),
    headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Lỗi ${res.status}`);
}

export function CredentialsPanel({ employeeId, readOnly }: { employeeId: number; readOnly?: boolean }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Profile>(`/api/employees/${employeeId}/license`);
  const [lic, setLic] = useState<LicForm | null>(null);
  const [cred, setCred] = useState<CredForm | null>(null);
  const [removing, setRemoving] = useState<Cred | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [prefilling, setPrefilling] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const edit = data.canEdit && !readOnly;
  const L = data.license;

  function openLicense() {
    setLic({
      number: L?.number ?? "",
      issuedAt: L?.issuedAt ?? "",
      issuer: L?.issuer ?? "",
      subject: L?.subject ?? data!.employee.jobTitle ?? "",
      scope: L?.scope ?? "",
      status: L?.status ?? "ACTIVE",
      expiresAt: L?.expiresAt ?? "",
      renewedAt: L?.renewedAt ?? "",
      // Mốc chu kỳ trùng mốc tự tính (gia hạn / ngày cấp) → để trống để lần gia hạn sau tự theo ngày gia hạn mới.
      cmeCycleStart: L && L.cmeCycleStart !== (L.renewedAt ?? L.issuedAt) ? L.cmeCycleStart : "",
      workplaceNote: L?.workplaceNote ?? "",
    });
    setConfirmDel(false);
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await reload();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Tra số GPHN trên medinet và điền sẵn các ô trống / khác (Nhân sự kiểm lại trước khi Lưu). */
  async function prefill() {
    if (!lic) return;
    setPrefilling(true);
    try {
      const r = await api<{ found: boolean; record: MnRecord | null }>("/api/medinet/lookup", { body: { number: lic.number } });
      if (!r.found || !r.record) {
        toast.info("Không tìm thấy số GPHN này trên medinet — nhập tay");
        return;
      }
      const rec = r.record;
      const st = rec.status === "ACTIVE" || rec.status === "SUSPENDED" || rec.status === "REVOKED" ? rec.status : lic.status;
      setLic((p) =>
        p ? { ...p, number: rec.number || p.number, issuedAt: rec.issuedAt ?? p.issuedAt, issuer: rec.issuer ?? p.issuer, subject: rec.subject ? rec.subject.charAt(0) + rec.subject.slice(1).toLowerCase() : p.subject, scope: rec.scope ?? p.scope, status: st } : p,
      );
      toast.success(`Đã điền từ medinet: ${rec.name} — kiểm tra lại rồi Lưu`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPrefilling(false);
    }
  }

  async function saveLicense() {
    if (!lic) return;
    const body = { ...lic, cmeCycleStart: lic.cmeCycleStart || null, expiresAt: lic.expiresAt || null, renewedAt: lic.renewedAt || null };
    if (await run(() => api(`/api/employees/${employeeId}/license`, { method: "PUT", body }), "Đã lưu Giấy phép hành nghề")) setLic(null);
  }

  async function saveCred() {
    if (!cred) return;
    const f = cred;
    const body = { type: f.type, name: f.name, issuer: f.issuer, number: f.number, issuedAt: f.issuedAt, expiresAt: f.expiresAt, cmeHours: f.type === "CME" ? f.cmeHours : null };
    const ok = await run(async () => {
      let id = f.id;
      if (id) await api(`/api/employees/${employeeId}/credentials/${id}`, { method: "PATCH", body });
      else {
        id = (await api<{ item: { id: number } }>(`/api/employees/${employeeId}/credentials`, { body })).item.id;
        // Đã tạo: lỗi tải file sau đó thì bấm Lưu lại chỉ sửa + tải file, không tạo bản trùng.
        setCred((p) => (p ? { ...p, id } : p));
      }
      if (f.file) await uploadFile(employeeId, id, f.file);
    }, f.id ? "Đã cập nhật" : "Đã thêm");
    if (ok) setCred(null);
  }

  const items = data.credentials.filter((c) => !filter || c.type === filter);
  const types = [...new Set(data.credentials.map((c) => c.type))];
  const set = <K extends keyof LicForm>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setLic((p) => (p ? { ...p, [k]: e.target.value } : p));
  const setC = <K extends keyof CredForm>(k: K, v: CredForm[K]) => setCred((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="space-y-4">
      {!!data.issues.length && (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Icon name="alert" className="size-4" /> Cần chú ý
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {data.issues.map((i) => (
              <li key={i.kind} className={i.severity === "danger" ? "text-rose-700" : "text-amber-800"}>
                • {i.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Giấy phép hành nghề (GPHN)"
          actions={
            <div className="flex flex-wrap gap-2">
              <a href={data.medinetUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50">
                <Icon name="externalLink" className="size-4" /> Mở medinet
              </a>
              {edit && L && (
                <Button size="sm" variant="secondary" icon="search" loading={busy} onClick={() => run(() => api(`/api/employees/${employeeId}/license/medinet`, { method: "POST" }), "Đã tra cứu medinet")}>
                  Tra cứu tự động
                </Button>
              )}
              {edit && L && (
                <Button size="sm" variant="secondary" icon="check" loading={busy} onClick={() => run(() => api(`/api/employees/${employeeId}/license/verify`, { method: "POST" }), "Đã ghi nhận đối chiếu hôm nay")}>
                  Đã đối chiếu hôm nay
                </Button>
              )}
              {edit && (
                <Button size="sm" icon={L ? "edit" : "plus"} onClick={openLicense}>
                  {L ? "Sửa" : "Nhập GPHN"}
                </Button>
              )}
            </div>
          }
        />
        {L ? (
          <dl className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[11rem_1fr] sm:px-5">
            {(
              [
                ["Số GPHN", <span key="n" className="font-semibold">{L.number}</span>],
                ["Tình trạng", <Badge key="s" tone={L.status === "ACTIVE" ? "ontime" : L.status === "UNKNOWN" ? "neutral" : "absent"}>{STATUS[L.status] ?? L.status}</Badge>],
                ["Ngày cấp / nơi cấp", `${d(L.issuedAt)} · ${L.issuer}`],
                ["Đối tượng", L.subject],
                ["Phạm vi chuyên môn", L.scope],
                ["Hết hạn", L.expiresAt ? d(L.expiresAt) : "Không ghi thời hạn"],
                ["Gia hạn gần nhất", d(L.renewedAt)],
                ["Mốc chu kỳ CME", d(L.cmeCycleStart)],
                ["Nơi đăng ký hành nghề", L.workplaceNote || "—"],
                ["Đối chiếu medinet", L.verifiedAt ? fmtDateTime(L.verifiedAt) : "Chưa đối chiếu"],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="mb-1 text-slate-800 sm:mb-0">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">{data.requiresLicense ? "Chức danh này bắt buộc GPHN nhưng chưa nhập." : "Chưa có GPHN."}</p>
        )}
        {L && parseMn(L.medinetResult) && <MedinetBox at={L.medinetCheckedAt} r={parseMn(L.medinetResult)!} />}
      </Card>

      {L && (
        <Card className="space-y-3 p-4 sm:p-5">
          <p className="text-[15px] font-semibold text-slate-800">Đào tạo liên tục (CME)</p>
          <Progress label={`2 năm gần nhất (từ ${d(data.cme.twoYearFrom)})`} value={data.cme.twoYearHours} max={data.cme.twoYearRequired} />
          {data.cme.cycle && (
            <Progress
              label={`Chu kỳ ${d(data.cme.cycle.from)} – ${d(data.cme.cycle.to)} · còn ${data.cme.cycle.daysLeft} ngày`}
              value={data.cme.cycle.hours}
              max={data.cme.cycleRequired}
            />
          )}
          <p className="text-xs text-slate-500">Tiết của chu kỳ trước không cộng sang chu kỳ sau. Ngưỡng chỉnh trong Cấu hình → Hành nghề.</p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Văn bằng · chứng chỉ · CME"
          actions={
            <div className="flex flex-wrap gap-2">
              {types.length > 1 && (
                <Select className="h-9 w-auto py-0 text-sm" aria-label="Lọc theo loại" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">Mọi loại</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {TYPES[t] ?? t}
                    </option>
                  ))}
                </Select>
              )}
              {edit && (
                <Button size="sm" icon="plus" onClick={() => setCred({ type: "CME", name: "", issuer: "", number: "", issuedAt: "", expiresAt: "", cmeHours: "", file: null })}>
                  Thêm
                </Button>
              )}
            </div>
          }
        />
        {!items.length ? (
          <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">Chưa có mục nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((c) => {
              const expired = c.expiresAt && c.expiresAt < todayStr();
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">
                      {c.name} {c.type === "CME" && c.cmeHours != null && <Badge tone="brand">{c.cmeHours} tiết</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {[TYPES[c.type] ?? c.type, c.issuer, c.number && `Số ${c.number}`, c.issuedAt && `cấp ${d(c.issuedAt)}`].filter(Boolean).join(" · ")}
                      {c.expiresAt && <span className={expired ? "font-semibold text-rose-600" : ""}> · hạn {d(c.expiresAt)}</span>}
                    </p>
                  </div>
                  {c.hasFile && (
                    <a
                      href={`/api/employees/${employeeId}/credentials/${c.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                      title={c.fileName ?? "Xem file"}
                    >
                      <Icon name="file" className="size-4" /> Xem
                    </a>
                  )}
                  {edit && (
                    <>
                      <IconButton
                        icon="edit"
                        label="Sửa"
                        onClick={() =>
                          setCred({ id: c.id, type: c.type, name: c.name, issuer: c.issuer ?? "", number: c.number ?? "", issuedAt: c.issuedAt ?? "", expiresAt: c.expiresAt ?? "", cmeHours: c.cmeHours != null ? String(c.cmeHours) : "", file: null })
                        }
                      />
                      <IconButton icon="trash" label="Xóa" onClick={() => setRemoving(c)} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={!!lic}
        onClose={() => setLic(null)}
        title="Giấy phép hành nghề"
        wide
        footer={
          <>
            {L && (
              <Button
                variant={confirmDel ? "danger" : "ghost"}
                className="sm:mr-auto"
                loading={busy}
                onClick={async () => {
                  if (!confirmDel) return setConfirmDel(true);
                  if (await run(() => api(`/api/employees/${employeeId}/license`, { method: "DELETE" }), "Đã xóa GPHN")) setLic(null);
                }}
              >
                {confirmDel ? "Bấm lần nữa để xóa" : "Xóa GPHN"}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setLic(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={saveLicense}>
              Lưu
            </Button>
          </>
        }
      >
        {lic && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số GPHN *" hint="vd. 0015578/BYT-CCHN — bấm Tra để điền sẵn từ medinet">
              {(id) => (
                <div className="flex gap-2">
                  <input id={id} className="input" value={lic.number} onChange={set("number")} />
                  <Button type="button" variant="secondary" icon="search" loading={prefilling} disabled={lic.number.trim().length < 3} onClick={prefill}>
                    Tra
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Tình trạng *">
              {(id) => (
                <Select id={id} value={lic.status} onChange={set("status")}>
                  {Object.entries(STATUS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Ngày cấp *">{(id) => <input id={id} type="date" className="input" value={lic.issuedAt} onChange={set("issuedAt")} />}</Field>
            <Field label="Nơi cấp *" hint="Bộ Y tế / Sở Y tế …">{(id) => <input id={id} className="input" value={lic.issuer} onChange={set("issuer")} />}</Field>
            <Field label="Đối tượng cấp *">
              {(id) => (
                <>
                  <input id={id} className="input" list="gphn-subjects" value={lic.subject} onChange={set("subject")} />
                  <datalist id="gphn-subjects">
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Ngày hết hạn" hint="GPHN mới: 5 năm. CCHN cũ không thời hạn: để trống">{(id) => <input id={id} type="date" className="input" value={lic.expiresAt} onChange={set("expiresAt")} />}</Field>
            <Field label="Phạm vi chuyên môn *" className="sm:col-span-2">{(id) => <textarea id={id} className="input min-h-20 py-2" value={lic.scope} onChange={set("scope")} />}</Field>
            <Field label="Ngày gia hạn gần nhất">{(id) => <input id={id} type="date" className="input" value={lic.renewedAt} onChange={set("renewedAt")} />}</Field>
            <Field label="Mốc chu kỳ CME" hint="Trống = ngày gia hạn, không có thì ngày cấp">{(id) => <input id={id} type="date" className="input" value={lic.cmeCycleStart} onChange={set("cmeCycleStart")} />}</Field>
            <Field label="Nơi đăng ký hành nghề / ghi chú" className="sm:col-span-2" hint="Ghi nếu medinet hiển thị đăng ký hành nghề ở nơi khác">
              {(id) => <input id={id} className="input" value={lic.workplaceNote} onChange={set("workplaceNote")} />}
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!cred}
        onClose={() => setCred(null)}
        title={cred?.id ? "Sửa văn bằng / chứng chỉ" : "Thêm văn bằng / chứng chỉ"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCred(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={saveCred}>
              Lưu
            </Button>
          </>
        }
      >
        {cred && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loại *">
              {(id) => (
                <Select id={id} value={cred.type} onChange={(e) => setC("type", e.target.value)}>
                  {Object.entries(TYPES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Tên *" hint={cred.type === "CME" ? "vd. Cập nhật kiến thức hồi sức cấp cứu" : "vd. Bằng Bác sĩ đa khoa"}>
              {(id) => <input id={id} className="input" value={cred.name} onChange={(e) => setC("name", e.target.value)} />}
            </Field>
            <Field label="Nơi cấp">{(id) => <input id={id} className="input" value={cred.issuer} onChange={(e) => setC("issuer", e.target.value)} />}</Field>
            <Field label="Số hiệu">{(id) => <input id={id} className="input" value={cred.number} onChange={(e) => setC("number", e.target.value)} />}</Field>
            <Field label={cred.type === "CME" ? "Ngày cấp *" : "Ngày cấp"}>{(id) => <input id={id} type="date" className="input" value={cred.issuedAt} onChange={(e) => setC("issuedAt", e.target.value)} />}</Field>
            {cred.type === "CME" ? (
              <Field label="Số tiết CME *">{(id) => <input id={id} type="number" min={0.5} step={0.5} className="input" value={cred.cmeHours} onChange={(e) => setC("cmeHours", e.target.value)} />}</Field>
            ) : (
              <Field label="Hạn dùng" hint="Trống nếu không có hạn">{(id) => <input id={id} type="date" className="input" value={cred.expiresAt} onChange={(e) => setC("expiresAt", e.target.value)} />}</Field>
            )}
            <Field label={cred.id ? "Thay file scan (PDF / JPG / PNG, ≤ 10 MB)" : "File scan (PDF / JPG / PNG, ≤ 10 MB)"} className="sm:col-span-2">
              {(id) => <input id={id} type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm" onChange={(e) => setC("file", e.target.files?.[0] ?? null)} />}
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Xóa mục này?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Giữ lại
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => removing && (await run(() => api(`/api/employees/${employeeId}/credentials/${removing.id}`, { method: "DELETE" }), "Đã xóa")) && setRemoving(null)}
            >
              Xóa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Xóa “{removing?.name}”{removing?.hasFile ? " và file scan đính kèm" : ""}. Không khôi phục được.
        </p>
      </Modal>
    </div>
  );
}
