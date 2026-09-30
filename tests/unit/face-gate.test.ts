// v1.20.0: cổng chất lượng của kiosk — đặc biệt luật "còn chỗ cho vùng áo" (đứng quá sát thì ảnh mất phần áo).
import { describe, expect, it } from "vitest";
import type { FaceResult } from "@vladmandic/human";
import { checkGate } from "@/lib/face/engine";

const VIDEO = { videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
const SCRATCH = {} as unknown as HTMLCanvasElement;
const KIOSK = { minFace: 180, maxAngle: 20, chestRoom: 1.1 };

/** Một khuôn mặt "đạt" ở vị trí / kích cỡ cho trước. */
function face(box: [number, number, number, number], yaw = 0, pitch = 0): FaceResult {
  return {
    box,
    faceScore: 0.95,
    score: 0.95,
    rotation: { angle: { yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, roll: 0 } },
    mesh: new Array(478).fill([0, 0, 0]),
  } as unknown as FaceResult;
}

describe("cổng chất lượng kiosk", () => {
  it("đứng đúng khoảng cách (mặt vừa phải, còn chỗ cho ngực) → qua cổng", () => {
    const g = checkGate([face([540, 120, 200, 250])], VIDEO, SCRATCH, KIOSK); // cằm ở 370, còn 350 px
    expect(g.ok).toBe(true);
    expect(g.reason).toBeNull();
  });

  it("đứng quá sát camera → nhắc lùi lại, dù mặt rất rõ", () => {
    const g = checkGate([face([400, 60, 480, 600])], VIDEO, SCRATCH, KIOSK); // cằm ở 660, chỉ còn 60 px
    expect(g.ok).toBe(false);
    expect(g.reason).toBe("Lùi lại một bước");
    expect(g.faceWidth).toBeGreaterThan(KIOSK.minFace); // không phải lỗi "mặt nhỏ"
  });

  it("mặt quá nhỏ vẫn nhắc lại gần (luật cũ không đổi)", () => {
    expect(checkGate([face([600, 100, 120, 150])], VIDEO, SCRATCH, KIOSK).reason).toBe("Lại gần camera hơn");
  });

  it("nghiêng đầu quá nhiều → nhắc nhìn thẳng", () => {
    expect(checkGate([face([540, 120, 200, 250], 35)], VIDEO, SCRATCH, KIOSK).reason).toBe("Nhìn thẳng vào camera");
  });

  it("không bật luật vùng áo thì đứng sát vẫn qua (giữ nguyên hành vi cũ cho enroll)", () => {
    const g = checkGate([face([400, 60, 480, 600])], VIDEO, SCRATCH, { minFace: 180, maxAngle: 20 });
    expect(g.ok).toBe(true);
  });

  it("không có mặt hoặc nhiều mặt → báo đúng", () => {
    expect(checkGate([], VIDEO, SCRATCH, KIOSK).reason).toBe("Hãy nhìn vào camera");
    expect(checkGate([face([100, 100, 200, 250]), face([700, 100, 200, 250])], VIDEO, SCRATCH, KIOSK).reason).toBe("Chỉ một người trước camera");
  });

  it("ranh giới: đúng 1,1 lần chiều cao mặt thì vẫn qua, thiếu một chút thì không", () => {
    // mặt cao 250, cằm ở y+250; cần còn ≥ 275 px bên dưới → y + 250 + 275 ≤ 720 ⇒ y ≤ 195
    expect(checkGate([face([540, 195, 200, 250])], VIDEO, SCRATCH, KIOSK).ok).toBe(true);
    expect(checkGate([face([540, 205, 200, 250])], VIDEO, SCRATCH, KIOSK).reason).toBe("Lùi lại một bước");
  });
});
