import { catalogRoutes } from "@/lib/catalogs";

const r = catalogRoutes("jobTitle");
export const PATCH = r.update;
export const DELETE = r.remove;
