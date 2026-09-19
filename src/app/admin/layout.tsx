import { requirePageUser } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser(["ADMIN", "MANAGER"]);
  return (
    <AdminNav user={{ name: u.name, code: u.code, role: u.role }}>
      {children}
    </AdminNav>
  );
}
