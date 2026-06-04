import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZoneSpellSettlementModal } from "~/components/map/ZoneSpellSettlementModal";
import type { Token } from "~/components/map/types/TacticalMapTypes";

const apiClientMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("~/utils/api-client", () => ({
  apiFetch: apiClientMocks.apiFetch,
}));

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "map://active",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    active_effects: [],
    ...overrides,
  } as Token;
}

describe("ZoneSpellSettlementModal", () => {
  afterEach(() => {
    apiClientMocks.apiFetch.mockReset();
  });

  it("includes active-effect zone spells and posts the selected settlement timing", async () => {
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        spell_name: "油腻术",
        target_results: [],
      }),
    } as Response);

    const caster = createToken({
      id: 20,
      instance_name: "艾尔文·黑焰",
      active_effects: [
        {
          spell_buff: true,
          spell_id: "grease",
          spell_name: "油腻术",
          area_effect: {
            map_url: "map://active",
            shape: "cube",
            center_x: 1.5,
            center_y: 1.5,
            radius: 10,
          },
        },
      ] as any,
    });
    const target = createToken({
      id: 21,
      instance_name: "食尸鬼",
      position_x: 1,
      position_y: 1,
      monster_instance_id: 99,
    });

    render(
      <ZoneSpellSettlementModal
        open
        onClose={vi.fn()}
        campaignId="7"
        tokens={[caster, target]}
        currentMapUrl="map://active"
        gridUnitLength={5}
        isDM
        userId="dm-user"
      />,
    );

    await screen.findByText("油腻术");
    expect(screen.getByText("进入时 / 回合结束 结算")).toBeInTheDocument();
    expect(screen.getByText("⛓️ 倒地")).toBeInTheDocument();

    const endTurnButton = screen.getByRole("button", { name: "回合结束" });
    fireEvent.click(endTurnButton);
    await waitFor(() => {
      expect(endTurnButton.className).toContain("border-blue-400");
    });
    fireEvent.click(screen.getByRole("button", { name: "进行豁免检定" }));

    await waitFor(() => {
      expect(apiClientMocks.apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/combat/zone-spell-settle"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"timing":"end_turn"'),
        }),
      );
    });
  });
});
