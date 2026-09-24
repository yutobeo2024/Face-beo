"use client";
/**
 * Cấu hình → tab "Chấm công" (ngưỡng nhận diện, vắng, OT, lưu ảnh) và tab "Hành nghề" (tra cứu medinet + ngưỡng CME).
 * Mỗi thẻ chỉ PUT các khóa của chính nó — thẻ khác vừa lưu không bị ghi đè bằng giá trị cũ đang nằm trong form.
 */
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Loading } from "@/components/ui";
import type { SectionProps, Settings, SettingsField, SystemInfo } from "./shared";

const FACE_FIELDS: SettingsField[] = [
  { key: "matchThreshold", label: "Ngưỡng khớp khuôn mặt", hint: "Cosine InsightFace tối thiểu (mặc định 0.45; cùng người thường ≥ 0.5, khác người ≤ 0.35).", step: 0.01 },
  { key: "matchMargin", label: "Chênh lệch top-1/top-2", hint: "Top-1 phải hơn top-2 ít nhất (mặc định 0.08) — chống nhận nhầm người có nét giống.", step: 0.01 },
  { key: "livenessThreshold", label: "Ngưỡng liveness", hint: "Trung bình điểm antispoof + liveness của 5 khung.", step: 0.01 },
  { key: "livenessServerThreshold", label: "Ngưỡng liveness L2 (server)", hint: "Xác suất “mặt thật” tối thiểu của MiniFASNetV2. Chỉ dùng khi LIVENESS_SERVER=true.", step: 0.01 },
];
const WORK_FIELDS: SettingsField[] = [
  { key: "absentAfterMinutes", label: "Tính vắng sau (phút)", hint: "Quá số phút này sau giờ vào ca mà chưa chấm => vắng.", step: 1 },
  { key: "otRoundMinutes", label: "Làm tròn OT (phút)", hint: "Phút OT làm tròn xuống theo bội số này.", step: 1 },
  { key: "snapshotRetentionDays", label: "Lưu snapshot (ngày)", hint: "Job 02:00 tự xóa ảnh quá hạn.", step: 1 },
];
const CME_FIELDS: SettingsField[] = [
  { key: "cmeTwoYearHours", label: "CME tối thiểu 2 năm (tiết)", hint: "TT 32/2023: ≥ 48 tiết trong 2 năm liên tiếp.", step: 1 },
  { key: "cmeCycleHours", label: "CME tối thiểu mỗi chu kỳ (tiết)", hint: "≥ 120 tiết / chu kỳ để gia hạn GPHN; chu kỳ trước không cộng sang.", step: 1 },
  { key: "cmeCycleYears", label: "Độ dài chu kỳ CME (năm)", hint: "Tính từ ngày cấp / gia hạn GPHN (mặc định 5).", step: 1 },
  { key: "credentialWarnDays", label: "Báo trước hết hạn (ngày)", hint: "Cảnh báo GPHN / chứng chỉ sắp hết hạn; chu kỳ CME thiếu tiết khi còn ≤ 2 × số ngày này.", step: 1 },
];

/** Tải /api/settings một lần cho thẻ đang mở, giữ bản nháp trong form. */
function useSettingsForm() {
  const s = useApi<{ settings: Settings; system: SystemInfo }>("/api/settings");
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (s.data) setForm(s.data.settings);
  }, [s.data]);
  /** Sau khi một thẻ lưu xong: tải lại rồi chỉ đồng bộ các ô của thẻ đó (thẻ khác có thể đang sửa dở). */
  const saved = async (fields: SettingsField[]) => {
    const fresh = await api<{ settings: Settings }>("/api/settings");
    setForm((f) => (f ? { ...f, ...Object.fromEntries(fields.map((x) => [x.key, fresh.settings[x.key]])) } : fresh.settings));
  };
  return { s, form, setForm, saved };
}

function NumberCard({ title, hint, fields, form, setForm, busy, run, saved }: {
  title: string;
  hint?: string;
  fields: SettingsField[];
  form: Settings;
  setForm: (s: Settings) => void;
  busy: boolean;
  run: SectionProps["run"];
  /** Chỉ ghi đè các ô của thẻ này bằng giá trị máy chủ vừa nhận — ô đang sửa dở ở thẻ bên cạnh giữ nguyên. */
  saved: (fields: SettingsField[]) => void;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {hint && <p className="px-4 pt-3 text-xs text-slate-500 sm:px-5">{hint}</p>}
      <form
        className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api("/api/settings", { method: "PUT", body: Object.fromEntries(fields.map((f) => [f.key, form[f.key]])) }), "Đã lưu cấu hình", () => saved(fields));
        }}
      >
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {(id) => <input id={id} type="number" step={f.step} className="input tabular-nums" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />}
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>
            Lưu
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Tab "Chấm công": trạng thái mô hình nhận diện + các ngưỡng quét và tính công. */
export function ThresholdsSection({ busy, run }: SectionProps) {
  const { s, form, setForm, saved } = useSettingsForm();
  if (s.error) return <ErrorBox message={s.error} onRetry={s.reload} />;
  if (!form || !s.data) return <Loading />;
  const sysInfo = s.data.system;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Tình trạng nhận diện" />
        <div className="flex flex-wrap gap-2 p-4 sm:p-5">
          <Badge tone={sysInfo.face.modelExists && !sysInfo.face.error ? "ontime" : "absent"}>
            Nhận diện: {!sysInfo.face.modelExists ? "THIẾU mô hình — chạy npm run models:face" : sysInfo.face.error ? "lỗi" : sysInfo.face.label}
          </Badge>
          <Badge tone={!sysInfo.livenessServer ? "neutral" : sysInfo.l2.modelExists && !sysInfo.l2.error ? "ontime" : "absent"}>
            Liveness L2 server: {!sysInfo.livenessServer ? "tắt" : !sysInfo.l2.modelExists ? "bật nhưng thiếu mô hình" : sysInfo.l2.error ? "lỗi" : "bật (MiniFASNetV2)"}
          </Badge>
          <Badge tone="neutral">Mô hình: {sysInfo.faceModelVersion}</Badge>
        </div>
      </Card>
      <NumberCard
        title="Ngưỡng nhận diện khuôn mặt"
        hint="Tăng ngưỡng thì chặt hơn (ít nhận nhầm, dễ quét lại); giảm thì dễ quét hơn. Đổi xong nên thử quét trên kiosk."
        fields={FACE_FIELDS}
        form={form}
        setForm={setForm}
        busy={busy}
        run={run}
        saved={saved}
      />
      <NumberCard title="Tính công & lưu ảnh" fields={WORK_FIELDS} form={form} setForm={setForm} busy={busy} run={run} saved={saved} />
    </div>
  );
}

/** Tab "Hành nghề": tra cứu GPHN trên medinet + ngưỡng CME / cảnh báo hết hạn. */
export function LicenseSection({ busy, run }: SectionProps) {
  const { s, form, setForm, saved } = useSettingsForm();
  return (
    <div className="space-y-4">
      <MedinetCard busy={busy} run={run} />
      {s.error ? (
        <ErrorBox message={s.error} onRetry={s.reload} />
      ) : !form ? (
        <Loading />
      ) : (
        <NumberCard
          title="CME & cảnh báo hết hạn"
          hint="Áp cho mọi nhân viên có Giấy phép hành nghề; job 07:30 gom cảnh báo vào tin nhóm minh bạch."
          fields={CME_FIELDS}
          form={form}
          setForm={setForm}
          busy={busy}
          run={run}
          saved={saved}
        />
      )}
    </div>
  );
}

/** Tra cứu medinet (v1.11.0): tự đối chiếu GPHN với trang của Sở Y tế TP.HCM, số GPHĐ của phòng khám. */
function MedinetCard({ busy, run }: { busy: boolean; run: SectionProps["run"] }) {
  const d = useApi<{ medinetAutoCheck: number; medinetCheckDays: number; clinicFacilityLicenses: string }>("/api/settings/medinet");
  const [f, setF] = useState<{ medinetAutoCheck: number; medinetCheckDays: number; clinicFacilityLicenses: string } | null>(null);
  const v = f ?? d.data;
  if (!v) return null;
  return (
    <Card>
      <CardHeader title="Tra cứu GPHN trên medinet" />
      <form
        className="grid gap-3 p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api("/api/settings/medinet", { method: "PUT", body: v }), "Đã lưu", () => (setF(null), d.reload()));
        }}
      >
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={v.medinetAutoCheck === 1} onChange={(e) => setF({ ...v, medinetAutoCheck: e.target.checked ? 1 : 0 })} />
          <span>
            <b>Tự tra cứu hằng ngày</b> lúc 06:30: mỗi GPHN được đối chiếu lại sau số ngày bên dưới; chỗ khác nhau / tình trạng không còn hoạt động / đăng ký nơi khác vào tin tổng hợp hồ sơ
            hành nghề 07:30 của nhóm Zalo minh bạch.
          </span>
        </label>
        <Field label="Tra lại mỗi người sau (ngày)" hint="Mặc định 30. Tra thưa, mỗi lượt cách nhau ≥ 4 giây, để không làm phiền trang của Sở Y tế.">
          {(id) => <input id={id} type="number" min={7} max={365} className="input tabular-nums" value={v.medinetCheckDays} onChange={(e) => setF({ ...v, medinetCheckDays: Number(e.target.value) })} />}
        </Field>
        <Field
          label="Số GPHĐ của phòng khám"
          hint="Giấy phép hoạt động của cơ sở mình, vd. 06410/HCM-GPHĐ (nhiều số: cách nhau dấu phẩy). Dùng để nhận biết nhân viên đang đăng ký hành nghề ở nơi khác; để trống thì không xét."
        >
          {(id) => <input id={id} className="input" placeholder="vd. 06410/HCM-GPHĐ" value={v.clinicFacilityLicenses} onChange={(e) => setF({ ...v, clinicFacilityLicenses: e.target.value })} />}
        </Field>
        <p className="text-xs text-slate-500">Nguồn: tracuu.medinet.org.vn (Sở Y tế TP.HCM) — trang công khai, không có API chính thức. GPHN do tỉnh khác cấp có thể không có trên trang này.</p>
        <div>
          <Button type="submit" loading={busy}>
            Lưu
          </Button>
        </div>
      </form>
    </Card>
  );
}
