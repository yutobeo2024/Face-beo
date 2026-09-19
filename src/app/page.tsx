import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await getPageUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword) redirect("/login?change=1");
  redirect(u.role === "EMPLOYEE" ? "/me" : "/admin");
}
