import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapDueCastResolution } from "../../app/components/map/hooks/useMapDueCastResolution";

describe("useMapDueCastResolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a resolve request for due casts and deduplicates the same resolution key", async () => {
    const authedFetch = vi.fn(async () => ({ ok: true } as Response));
    const tokens = [
      {
        id: 4,
        casting_in_progress: {
          status: "casting",
          finish_at_campaign: { day: 1, hour: 10, minute: 0, second: 0 },
        },
      },
    ];

    const { rerender } = renderHook(
      ({ fetcher, nextTokens }) =>
        useMapDueCastResolution({
          authedFetch: fetcher,
          campaignId: "7",
          timeOfDay: { day: 1, hour: 10, minute: 0, second: 0 },
          tokens: nextTokens,
        }),
      {
        initialProps: { fetcher: authedFetch, nextTokens: tokens },
      },
    );

    await waitFor(() => {
      expect(authedFetch).toHaveBeenCalledTimes(1);
    });

    rerender({ fetcher: authedFetch, nextTokens: [...tokens] });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authedFetch).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed resolve attempt resets the dedupe key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rejectedFetch = vi.fn(async (): Promise<Response> => {
      throw new Error("boom");
    });
    const resolvedFetch = vi.fn(async (): Promise<Response> => ({ ok: true } as Response));
    const tokens = [
      {
        id: 9,
        casting_in_progress: {
          status: "casting",
          finish_at_campaign: { day: 1, hour: 11, minute: 30, second: 0 },
        },
      },
    ];

    const { rerender } = renderHook(
      ({ fetcher }) =>
        useMapDueCastResolution({
          authedFetch: fetcher,
          campaignId: "7",
          timeOfDay: { day: 1, hour: 11, minute: 30, second: 0 },
          tokens,
        }),
      {
        initialProps: { fetcher: rejectedFetch },
      },
    );

    await waitFor(() => {
      expect(rejectedFetch).toHaveBeenCalledTimes(1);
    });

    rerender({ fetcher: resolvedFetch });

    await waitFor(() => {
      expect(resolvedFetch).toHaveBeenCalledTimes(1);
    });
  });
});
