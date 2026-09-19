import { requirePageUser } from "@/lib/auth";
import { hasAdminAccess } from "@/lib/permissions";
import { MeNav } from "./me-nav";

export const dynamic = "force-dynamic";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  return (
    <MeNav user={{ id: u.id, name: u.name, code: u.code, role: u.role }} adminAccess={await hasAdminAccess(u)}>
      {children}
    </MeNav>
  );
}
