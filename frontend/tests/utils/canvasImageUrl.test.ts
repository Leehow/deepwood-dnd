import { describe, expect, it } from "vitest";

import { getCanvasImageUrl, shouldProxyCanvasImageUrl } from "~/utils/canvas-image-url";

describe("canvas image url helpers", () => {
  it("appends canvas query to relative assets", () => {
    expect(getCanvasImageUrl("/assets/token.png")).toBe("/assets/token.png?_canvas=1");
    expect(getCanvasImageUrl("/assets/token.png?v=2")).toBe("/assets/token.png?v=2&_canvas=1");
  });

  it("proxies signed temporary oss urls", () => {
    const signedUrl = "https://dashscope-7c2c.oss-accelerate.aliyuncs.com/a.png?Expires=1774589121&OSSAccessKeyId=abc&Signature=def";
    expect(shouldProxyCanvasImageUrl(signedUrl)).toBe(true);
    expect(getCanvasImageUrl(signedUrl)).toContain("http://localhost:8174/api/media/image-proxy?url=");
  });

  it("keeps data urls untouched", () => {
    const dataUrl = "data:image/png;base64,abc123";
    expect(getCanvasImageUrl(dataUrl)).toBe(dataUrl);
  });

  it("does not proxy stable remote urls", () => {
    const stableUrl = "https://deepwood.oss-cn-beijing.aliyuncs.com/dnd-static/assets/spell-icons/fireball.webp";
    expect(shouldProxyCanvasImageUrl(stableUrl)).toBe(false);
    expect(getCanvasImageUrl(stableUrl)).toBe(`${stableUrl}?_canvas=1`);
  });
});
