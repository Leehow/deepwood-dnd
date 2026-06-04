/**
 * React Query hook for fetching campaign-scoped rule options.
 *
 * Returns lightweight id/name sets that the character wizard uses
 * to filter the full local JSON data. When campaignId is absent or
 * the request fails, returns null (= allow everything).
 */

import { useQuery } from '@tanstack/react-query';
import { createLogger } from '~/utils/logger';

const logger = createLogger('useRuleOptions');
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8174';

interface RuleOptionRef {
  id: string;
  name: string;
  name_en?: string | null;
}

interface RuleOptionsResponse {
  campaign_id: number;
  toggles: { deity_system: boolean };
  catalog: {
    classes: Array<RuleOptionRef & { subclasses?: RuleOptionRef[] }>;
    races: Array<RuleOptionRef & { subraces?: RuleOptionRef[] }>;
    backgrounds: RuleOptionRef[];
    deities: Array<RuleOptionRef & { pantheon_id?: string; domains?: string[] }>;
  };
  warnings: string[];
}

export interface RuleOptions {
  allowedClassIds: Set<string>;
  allowedRaceIds: Set<string>;
  allowedBackgroundIds: Set<string>;
  allowedDeityIds: Set<string>;
  enableDeitySystem: boolean;
}

function transformResponse(data: RuleOptionsResponse): RuleOptions {
  return {
    allowedClassIds: new Set(data.catalog.classes.map((c) => c.id)),
    allowedRaceIds: new Set(data.catalog.races.map((r) => r.id)),
    allowedBackgroundIds: new Set(data.catalog.backgrounds.map((b) => b.id)),
    allowedDeityIds: new Set(data.catalog.deities.map((d) => d.id)),
    enableDeitySystem: data.toggles.deity_system,
  };
}

/**
 * Fetch campaign-scoped rule options.
 *
 * @returns `ruleOpts` — a RuleOptions object when available, null otherwise
 *          (null means "allow everything", used as fallback).
 */
export function useRuleOptions(campaignId?: string) {
  const { data: ruleOpts = null, isLoading } = useQuery<RuleOptions | null>({
    queryKey: ['ruleOptions', campaignId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/campaigns/${campaignId}/rule-options`);
      if (!res.ok) {
        logger.warn(`[useRuleOptions] Failed to fetch rule-options (${res.status}), falling back to all`);
        return null;
      }
      const json: RuleOptionsResponse = await res.json();
      logger.debug('[useRuleOptions] Loaded rule-options for campaign', campaignId, json.warnings);
      return transformResponse(json);
    },
    enabled: !!campaignId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return { ruleOpts, isLoading };
}
