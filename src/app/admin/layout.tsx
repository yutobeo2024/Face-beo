import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { capabilitiesOf, hasAdminAccess } from "@/lib/permissions";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  if (!(await hasAdminAccess(u))) redirect("/me");
  const caps = [...(await capabilitiesOf(u.role))];
  return (
    <AdminNav user={{ id: u.id, name: u.name, code: u.code, role: u.role }} caps={caps}>
      {children}
    </AdminNav>
  );
}
