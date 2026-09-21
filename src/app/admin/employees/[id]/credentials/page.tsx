"use client";
import Link from "next/link";
import { use } from "react";
import { useApi } from "@/lib/client/api";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { CredentialsPanel } from "@/components/credentials-panel";

/** Hồ sơ hành nghề của một nhân viên — Nhân sự / Quản trị nhập GPHN, văn bằng, chứng chỉ, CME. */
export default function CredentialsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useApi<{ employee: { code: string; name: string; jobTitle: string | null } }>(`/api/employees/${id}/license`);
  return (
    <>
      <Link href="/admin/employees" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <Icon name="chevronLeft" className="size-4" /> Nhân viên
      </Link>
      <PageHeader
        title="Hồ sơ hành nghề"
        subtitle={data ? [data.employee.code, data.employee.name, data.employee.jobTitle].filter(Boolean).join(" · ") : undefined}
      />
      <CredentialsPanel employeeId={Number(id)} />
    </>
  );
}
