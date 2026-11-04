/** Đọc biến môi trường có kiểm tra. Chỉ dùng phía server. */
function req(name: string, fallbackDev?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallbackDev !== undefined && process.env.NODE_ENV !== "production") return fallbackDev;
  throw new Error(`Thiếu biến môi trường ${name}`);
}

export const env = {
  get sessionSecret() {
    return req("SESSION_SECRET", "dev-session-secret-please-change-0123456789");
  },
  get biometricKey() {
    return req("BIOMETRIC_KEY", "0".repeat(64));
  },
  get cronSecret() {
    return req("CRON_SECRET", "dev-cron-secret");
  },
  get appBaseUrl() {
    return process.env.APP_BASE_URL || "http://localhost:3000";
  },
  get livenessServer() {
    return process.env.LIVENESS_SERVER === "true";
  },
  get cronDisabled() {
    return process.env.DISABLE_CRON === "true";
  },
  /** Dashboard CSKH (bot Zalo): bí mật ký vé đăng nhập một lần, dùng chung với CSKH_DASHBOARD_SSO_SECRET bên bot. */
  get cskhSsoSecret() {
    return process.env.CSKH_SSO_SECRET || "";
  },
  /** Gốc của Dashboard CSKH, ví dụ https://dashboard.ydsgchatbot.io.vn (không kèm /dashboard). */
  get cskhDashboardUrl() {
    return process.env.CSKH_DASHBOARD_URL || "";
  },
};
