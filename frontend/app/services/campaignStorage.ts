import { API_BASE_URL } from "~/config/api";
import { apiFetch } from "~/utils/api-client";
import type { CampaignStorageObject } from "~/types/campaign-storage";

export const CampaignStorageAPI = {
  async list(
    campaignId: string | number,
    opts?: { object_type?: string; category?: string; tags?: string[]; include_inactive?: boolean }
  ): Promise<CampaignStorageObject[]> {
    const sp = new URLSearchParams();
    if (opts?.object_type) sp.append("object_type", opts.object_type);
    if (opts?.category) sp.append("category", opts.category);
    if (opts?.tags) opts.tags.forEach((t) => sp.append("tags", t));
    if (opts?.include_inactive) sp.append("include_inactive", String(opts.include_inactive));

    const resp = await apiFetch(`${API_BASE_URL}/api/campaigns/${campaignId}/storage?${sp}`);
    if (!resp.ok) throw new Error(`Failed to list storage: ${resp.status}`);
    return resp.json();
  },

  async create(
    campaignId: string | number,
    body: {
      object_type: string; object_id: string; object_name: string;
      category?: string; tags?: string[]; data: any;
      visibility?: 'dm_only'|'all_players'|'specific_players';
      source?: string; source_id?: string;
      created_by: string;
    }
  ): Promise<CampaignStorageObject> {
    const resp = await apiFetch(`${API_BASE_URL}/api/campaigns/${campaignId}/storage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Failed to create: ${resp.status}`);
    return resp.json();
  },

  async get(
    campaignId: string | number,
    objectType: string,
    objectId: string
  ): Promise<CampaignStorageObject | null> {
    const resp = await apiFetch(
      `${API_BASE_URL}/api/campaigns/${campaignId}/storage/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}`
    );
    if (!resp.ok) throw new Error(`Failed to get storage: ${resp.status}`);
    return resp.json();
  },

  async listACL(
    campaignId: string | number,
    objectType: string,
    objectId: string
  ): Promise<string[]> {
    const resp = await apiFetch(
      `${API_BASE_URL}/api/campaigns/${campaignId}/storage/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}/acl`
    );
    if (!resp.ok) throw new Error(`Failed to list ACL: ${resp.status}`);
    return resp.json();
  },

  async addACL(
    campaignId: string | number,
    objectType: string,
    objectId: string,
    targetUserId: string
  ): Promise<string[]> {
    const resp = await apiFetch(
      `${API_BASE_URL}/api/campaigns/${campaignId}/storage/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}/acl`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetUserId }),
      }
    );
    if (!resp.ok) throw new Error(`Failed to add ACL: ${resp.status}`);
    return resp.json();
  },

  async removeACL(
    campaignId: string | number,
    objectType: string,
    objectId: string,
    targetUserId: string
  ): Promise<string[]> {
    const resp = await apiFetch(
      `${API_BASE_URL}/api/campaigns/${campaignId}/storage/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}/acl/${encodeURIComponent(targetUserId)}`,
      { method: "DELETE" }
    );
    if (!resp.ok) throw new Error(`Failed to remove ACL: ${resp.status}`);
    return resp.json();
  },
};
