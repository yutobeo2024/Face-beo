import { catalogRoutes } from "@/lib/catalogs";

const r = catalogRoutes("specialty");
export const GET = r.list;
export const POST = r.create;
