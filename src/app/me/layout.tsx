import { requirePageUser } from "@/lib/auth";
import { can, hasAdminAccess } from "@/lib/permissions";
import { chatbotAllowed } from "@/lib/chatbot";
import { MeNav } from "./me-nav";

export const dynamic = "force-dynamic";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  const [adminAccess, chatbot, cskhView, cskhAdmin, ...taskCaps] = await Promise.all([
    hasAdminAccess(u),
    chatbotAllowed(u),
    can(u, "cskh.view"),
    can(u, "cskh.admin"),
    can(u, "tasks.use"),
    can(u, "tasks.createProject"),
    can(u, "tasks.manageAll"),
  ]);
  return (
    <MeNav user={{ id: u.id, name: u.name, code: u.code, role: u.role }} adminAccess={adminAccess} chatbot={chatbot} tasks={taskCaps.some(Boolean)} cskh={cskhView || cskhAdmin}>
      {children}
    </MeNav>
  );
}
