import { catalogRoutes } from "@/lib/catalogs";

const r = catalogRoutes("specialty");
export const PATCH = r.update;
export const DELETE = r.remove;
