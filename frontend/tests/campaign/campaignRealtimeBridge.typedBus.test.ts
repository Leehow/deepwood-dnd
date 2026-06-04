import { describe, expect, it, vi } from "vitest";

import { bridgeCampaignRealtimeMessage } from "../../app/campaign-shell/realtime/campaignRealtimeBridge";

describe("campaignRealtimeBridge typed bus integration", () => {
  it("publishes combat storage updates through the typed bus bridge", () => {
    const storageListener = vi.fn();
    window.addEventListener("combatStorageUpdated", storageListener as EventListener);

    const handled = bridgeCampaignRealtimeMessage(
      {
        type: "storage_updated",
        data: {
          object: {
            object_type: "combat",
            object_id: "current",
            is_active: true,
          },
        },
      } as any,
      {
        role: "dm",
        setIsCombatActive: vi.fn(),
      },
    );

    expect(handled).toBe(true);
    expect((storageListener.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toEqual({
      object_type: "combat",
      object_id: "current",
      is_active: true,
    });

    window.removeEventListener("combatStorageUpdated", storageListener as EventListener);
  });

  it("publishes combat storage deletions through the typed bus bridge", () => {
    const storageListener = vi.fn();
    window.addEventListener("combatStorageDeleted", storageListener as EventListener);

    const handled = bridgeCampaignRealtimeMessage(
      {
        type: "storage_deleted",
        data: {
          object_type: "combat",
          object_id: "current",
        },
      } as any,
      {
        role: "player",
        setIsCombatActive: vi.fn(),
      },
    );

    expect(handled).toBe(true);
    expect((storageListener.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toEqual({
      type: "storage_deleted",
      data: {
        object_type: "combat",
        object_id: "current",
      },
    });

    window.removeEventListener("combatStorageDeleted", storageListener as EventListener);
  });
});
