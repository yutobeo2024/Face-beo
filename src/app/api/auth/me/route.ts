import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = handle(async (req) => {
  const u = await requireUser(req, undefined, { allowMustChange: true });
  return json({ user: u });
});
