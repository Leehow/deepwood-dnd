import { useEffect, useRef } from "react";

import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapDueCastResolution");

type CampaignWorldTime = { day?: number; hour?: number; minute?: number; second?: number } | null | undefined;

interface DueCastToken {
  id: number;
  casting_in_progress?: {
    status?: string | null;
    finish_at_campaign?: CampaignWorldTime;
  } | null;
}

interface UseMapDueCastResolutionArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  timeOfDay?: CampaignWorldTime;
  tokens: DueCastToken[];
}

function worldTimeToSeconds(time?: CampaignWorldTime): number | null {
  if (!time) return null;
  return ((((time.day ?? 123) * 24) + (time.hour ?? 0)) * 60 + (time.minute ?? 0)) * 60 + (time.second ?? 0);
}

export function useMapDueCastResolution({
  authedFetch,
  campaignId,
  timeOfDay,
  tokens,
}: UseMapDueCastResolutionArgs) {
  const dueCastResolutionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!campaignId || !timeOfDay) return;

    const nowSeconds = worldTimeToSeconds(timeOfDay);
    if (nowSeconds == null) return;

    const dueTokens = tokens.filter((token) => {
      if (token.casting_in_progress?.status === "ready") return false;
      const finishSeconds = worldTimeToSeconds(token.casting_in_progress?.finish_at_campaign);
      return finishSeconds != null && finishSeconds <= nowSeconds;
    });

    if (dueTokens.length === 0) {
      dueCastResolutionKeyRef.current = null;
      return;
    }

    const resolutionKey = `${nowSeconds}:${dueTokens.map((token) => token.id).sort((a, b) => a - b).join(",")}`;
    if (dueCastResolutionKeyRef.current === resolutionKey) return;
    dueCastResolutionKeyRef.current = resolutionKey;

    authedFetch("/api/spells/resolve-due-casts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: parseInt(campaignId, 10),
        current_time: timeOfDay,
      }),
    }).catch((error) => {
      logger.error("[TacticalMap] Failed to resolve due casts:", error);
      dueCastResolutionKeyRef.current = null;
    });
  }, [authedFetch, campaignId, timeOfDay, tokens]);
}
