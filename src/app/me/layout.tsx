import { requirePageUser } from "@/lib/auth";
import { MeNav } from "./me-nav";

export const dynamic = "force-dynamic";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  return <MeNav user={{ id: u.id, name: u.name, code: u.code, role: u.role }}>{children}</MeNav>;
}
