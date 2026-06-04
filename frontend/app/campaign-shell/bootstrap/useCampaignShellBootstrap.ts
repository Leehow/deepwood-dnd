import { useEffect, useRef } from "react";
import { campaignShellService } from "~/services/campaignShell.service";

interface UseCampaignShellBootstrapOptions {
  enabled: boolean;
  campaignId?: string;
  userId?: string;
  notFoundMessage?: string;
  navigateHome?: () => void;
  setCurrentMapUrl?: (mapUrl: string | null) => void;
  setMapImageScale?: (scale: number) => void;
  setGridUnitLength?: (gridUnitLength: number) => void;
  setGlobalTerrain?: (terrain: any) => void;
  setIsCombatActive?: (active: boolean) => void;
  onMissingTerrain?: (mapUrl: string) => void;
  onCampaignLoaded?: (campaign: any) => void;
  onError?: (error: unknown) => void;
}

export function useCampaignShellBootstrap({
  enabled,
  campaignId,
  userId,
  notFoundMessage = "战役不存在",
  navigateHome,
  setCurrentMapUrl,
  setMapImageScale,
  setGridUnitLength,
  setGlobalTerrain,
  setIsCombatActive,
  onMissingTerrain,
  onCampaignLoaded,
  onError,
}: UseCampaignShellBootstrapOptions): void {
  const optionsRef = useRef({
    navigateHome,
    setCurrentMapUrl,
    setMapImageScale,
    setGridUnitLength,
    setGlobalTerrain,
    setIsCombatActive,
    onMissingTerrain,
    onCampaignLoaded,
    onError,
  });
  optionsRef.current = {
    navigateHome,
    setCurrentMapUrl,
    setMapImageScale,
    setGridUnitLength,
    setGlobalTerrain,
    setIsCombatActive,
    onMissingTerrain,
    onCampaignLoaded,
    onError,
  };

  useEffect(() => {
    if (!enabled || !campaignId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const result = await campaignShellService.loadState(campaignId, { userId });
        if (cancelled) {
          return;
        }

        if (!result.campaign) {
          if (result.status === 404) {
            alert(notFoundMessage);
            optionsRef.current.navigateHome?.();
          }
          return;
        }

        const { campaign, mapSettings, combatState } = result;

        optionsRef.current.onCampaignLoaded?.(campaign);
        optionsRef.current.setCurrentMapUrl?.(campaign.current_map_url ?? null);

        if (mapSettings) {
          if (typeof mapSettings.scale === "number") {
            optionsRef.current.setMapImageScale?.(mapSettings.scale);
          }
          if (typeof mapSettings.grid_unit_length === "number") {
            optionsRef.current.setGridUnitLength?.(mapSettings.grid_unit_length);
          }
          if (mapSettings.global_terrain !== undefined) {
            optionsRef.current.setGlobalTerrain?.(mapSettings.global_terrain || null);
          } else if (campaign.current_map_url) {
            optionsRef.current.onMissingTerrain?.(campaign.current_map_url);
          }
        }

        if (combatState) {
          optionsRef.current.setIsCombatActive?.(combatState.is_active !== false);
        }
      } catch (error) {
        if (!cancelled) {
          optionsRef.current.onError?.(error);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [
    campaignId,
    enabled,
    notFoundMessage,
    userId,
  ]);
}
