"use client";
import { useApi } from "@/lib/client/api";
import { Select } from "./ui";

type Dept = { id: number; name: string };

export function useDepartments() {
  return useApi<{ departments: (Dept & { managerId: number | null; manager: { name: string; code: string } | null; employeeCount: number })[] }>("/api/departments");
}

export function DeptSelect({ value, onChange, className, allLabel = "Tất cả phòng ban" }: { value: string; onChange: (v: string) => void; className?: string; allLabel?: string }) {
  const { data } = useDepartments();
  const list = data?.departments ?? [];
  if (list.length <= 1 && !value) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Lọc phòng ban">
      <option value="">{allLabel}</option>
      {list.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}
