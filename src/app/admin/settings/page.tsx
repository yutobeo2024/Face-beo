"use client";
/**
 * Trang Cấu hình (v1.15.0): chia theo tab để mỗi lần chỉ hiện vài thẻ, thay cho một trang cuộn dài.
 * Tab nằm trong địa chỉ (?tab=…) nên gửi link / F5 vẫn đúng chỗ; chỉ tab đang mở mới gọi API của nó.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ErrorBox, Loading, Modal, PageHeader, Segmented } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useCan } from "../admin-nav";
import { ScheduleSection } from "./sections/schedule";
import { OrgSection } from "./sections/org";
import { LicenseSection, ThresholdsSection } from "./sections/thresholds";
import { ZaloSection } from "./sections/zalo";
import type { ConfirmBox } from "./sections/shared";

type TabKey = "lich" | "to-chuc" | "cham-cong" | "zalo" | "hanh-nghe";
const TABS: { key: TabKey; label: string; perm: "org" | "sys" }[] = [
  { key: "lich", label: "Ca & lịch", perm: "org" },
  { key: "to-chuc", label: "Tổ chức", perm: "org" },
  { key: "cham-cong", label: "Chấm công", perm: "sys" },
  { key: "zalo", label: "Zalo OA", perm: "sys" },
  { key: "hanh-nghe", label: "Hành nghề", perm: "sys" },
];
const SUBTITLE: Record<TabKey, string> = {
  lich: "Ca làm việc, mẫu tuần, ngày lễ và hệ số công riêng của phòng.",
  "to-chuc": "Phòng ban, quản lý phòng, cách duyệt đơn, chức danh và chuyên khoa.",
  "cham-cong": "Ngưỡng nhận diện khuôn mặt, mốc tính vắng, làm tròn OT và hạn lưu ảnh.",
  zalo: "Kết nối Zalo OA và các nhóm nhận tin theo loại tin.",
  "hanh-nghe": "Tra cứu GPHN trên medinet và ngưỡng CME / cảnh báo hết hạn.",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsTabs />
    </Suspense>
  );
}

function SettingsTabs() {
  const can = useCan();
  const sys = can("settings.system");
  const org = can("org.manage");
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  // Hộp xác nhận xóa dùng chung (không dùng window.confirm); server vẫn là chốt chặn cuối khi thứ cần xóa đang được dùng.
  const [confirmBox, setConfirmBox] = useState<ConfirmBox | null>(null);
  const [busy, setBusy] = useState(false);

  const tabs = TABS.filter((t) => (t.perm === "sys" ? sys : org));
  const wanted = sp.get("tab") as TabKey | null;
  const active = tabs.find((t) => t.key === wanted)?.key ?? tabs[0]?.key;

  async function run(fn: () => Promise<unknown>, msg: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      after?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!tabs.length || !active) return <ErrorBox message="Bạn không có quyền vào trang cấu hình." />;

  const props = { busy, run, confirm: setConfirmBox };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Cấu hình"
        subtitle={SUBTITLE[active]}
        actions={tabs.length > 1 ? <Segmented value={active} onChange={(v) => router.replace(`/admin/settings?tab=${v}`, { scroll: false })} options={tabs.map((t) => ({ value: t.key, label: t.label }))} /> : undefined}
      />

      {active === "lich" && <ScheduleSection {...props} />}
      {active === "to-chuc" && <OrgSection {...props} />}
      {active === "cham-cong" && <ThresholdsSection {...props} />}
      {active === "zalo" && <ZaloSection {...props} />}
      {active === "hanh-nghe" && <LicenseSection {...props} />}

      <Modal
        open={!!confirmBox}
        onClose={() => setConfirmBox(null)}
        title={confirmBox?.title ?? ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmBox(null)}>
              Hủy
            </Button>
            <Button variant="danger" loading={busy} onClick={() => confirmBox && run(confirmBox.fn, confirmBox.ok, () => (setConfirmBox(null), confirmBox.after()))}>
              Xóa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{confirmBox?.body}</p>
      </Modal>
    </div>
  );
}
