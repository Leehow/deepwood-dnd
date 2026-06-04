import { describe, expect, it } from "vitest";

import { getAppQueryClient } from "../../app/queries/queryClient";

describe("queryClient", () => {
  it("reuses a single browser query client instance", () => {
    const first = getAppQueryClient();
    const second = getAppQueryClient();

    expect(first).toBe(second);
  });
});
