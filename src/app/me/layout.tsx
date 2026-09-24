import { requirePageUser } from "@/lib/auth";
import { hasAdminAccess } from "@/lib/permissions";
import { chatbotAllowed } from "@/lib/chatbot";
import { MeNav } from "./me-nav";

export const dynamic = "force-dynamic";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  const [adminAccess, chatbot] = await Promise.all([hasAdminAccess(u), chatbotAllowed(u)]);
  return (
    <MeNav user={{ id: u.id, name: u.name, code: u.code, role: u.role }} adminAccess={adminAccess} chatbot={chatbot}>
      {children}
    </MeNav>
  );
}
