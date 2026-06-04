import { act } from "@testing-library/react";
import { render, screen } from "../test-utils";
import { describe, expect, it } from "vitest";

import { CombatActionModal } from "~/components/combat/CombatActionModal";
import { publishAppEvent } from "~/events/appEventBus";

describe("CombatActionModal", () => {
  it("opens when openCombatActionModal is published through the typed bus", async () => {
    render(
      <CombatActionModal
        tokens={[
          {
            id: 42,
            campaign_id: 7,
            map_url: "/maps/test-map.png",
            position_x: 0,
            position_y: 0,
            token_size: "1x1",
            instance_name: "哥布林",
            current_hp: 12,
          } as any,
        ]}
        isDM={true}
        campaignId="7"
      />,
    );

    act(() => {
      publishAppEvent("openCombatActionModal", { tokenId: 42 });
    });

    expect(await screen.findByText("哥布林")).toBeInTheDocument();
    expect(screen.getByText("HP: 12")).toBeInTheDocument();
  });
});
