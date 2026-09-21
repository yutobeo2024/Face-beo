import { catalogRoutes } from "@/lib/catalogs";

const r = catalogRoutes("jobTitle");
export const GET = r.list;
export const POST = r.create;
