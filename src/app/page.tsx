import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/auth";
import { hasAdminAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await getPageUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword) redirect("/login?change=1");
  redirect((await hasAdminAccess(u)) ? "/admin" : "/me");
}
