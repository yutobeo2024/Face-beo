// v1.21.0: chế độ chờ của kiosk — khi nào tự ngủ, chấm xong đi đâu.
import { describe, expect, it } from "vitest";
import { isIdle, phaseAfterResult } from "@/lib/face/standby";

describe("isIdle — tự ngủ khi vắng", () => {
  const t0 = 1_700_000_000_000;

  it("chưa tới hạn thì vẫn thức", () => {
    expect(isIdle(t0 + 119_000, t0, 120)).toBe(false);
  });

  it("đúng hạn thì ngủ", () => {
    expect(isIdle(t0 + 120_000, t0, 120)).toBe(true);
  });

  it("quá hạn thì ngủ", () => {
    expect(isIdle(t0 + 600_000, t0, 120)).toBe(true);
  });

  it("vừa thấy người thì đếm lại từ đầu", () => {
    expect(isIdle(t0 + 121_000, t0 + 120_000, 120)).toBe(false);
  });

  it("chưa đặt mốc (chưa từng thấy ai) thì không tự ngủ — tránh ngủ ngay lúc vừa chạm", () => {
    expect(isIdle(t0, null, 120)).toBe(false);
  });

  it("đặt 0 là tắt hẳn việc tự ngủ", () => {
    expect(isIdle(t0 + 86_400_000, t0, 0)).toBe(false);
  });
});

describe("phaseAfterResult — chấm xong đi đâu", () => {
  it("mặc định 0 giây: về chờ ngay, người sau phải chạm", () => {
    expect(phaseAfterResult(0)).toBe("standby");
  });

  it("đặt > 0: giữ camera thức cho người xếp hàng", () => {
    expect(phaseAfterResult(30)).toBe("cooldown");
  });
});
