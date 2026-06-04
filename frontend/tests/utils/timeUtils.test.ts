import { describe, expect, it } from "vitest";

import { DEFAULT_TIME, isSameWorldTime, normalizeTime } from "~/utils/timeUtils";

describe("timeUtils isSameWorldTime", () => {
  it("returns true for equivalent normalized world time", () => {
    const normalized = normalizeTime({ ...DEFAULT_TIME });
    expect(isSameWorldTime(DEFAULT_TIME, normalized)).toBe(true);
  });

  it("returns false when second differs", () => {
    const t1 = normalizeTime({ ...DEFAULT_TIME, second: 10 });
    const t2 = normalizeTime({ ...DEFAULT_TIME, second: 11 });
    expect(isSameWorldTime(t1, t2)).toBe(false);
  });
});
