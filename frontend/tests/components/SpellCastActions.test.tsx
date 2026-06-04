import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpellCastActions } from "~/components/spell/SpellCastActions";

vi.mock("~/components/spell/UpcastLevelSelector", () => ({
  UpcastLevelSelector: () => null,
}));

vi.mock("~/components/ui/Rules_SpellDetail", () => ({
  analyzeSpellTargeting: () => null,
  isSelfCenteredAreaSpell: () => false,
}));

vi.mock("~/components/character/CharacterDisplay/utils/rules", () => ({
  getIconPath: () => "",
}));

vi.mock("~/components/spell/spellMaterialUtils", () => ({
  needsMaterialCheck: () => false,
  getRequiredComponents: () => [],
  hasMaterialComponent: () => false,
  getAvailableMaterials: () => [],
  ensureComponentsLoaded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/api-client", () => ({
  apiFetch: vi.fn(),
}));

describe("SpellCastActions", () => {
  it("passes confirmBreakConcentration after ritual confirmation", () => {
    const onCast = vi.fn();

    render(
      <SpellCastActions
        spell={{
          id: "detect_magic",
          name: "侦测魔法",
          level: 1,
          ritual: true,
          castingTime: "1 动作",
          range: "自身",
          concentration: true,
        } as any}
        selectedCastLevel={1}
        onSelectCastLevel={vi.fn()}
        spellSlots={[0, 4]}
        remainingSlots={[0, 4]}
        concentrationSpellName="脚底抹油"
        onCast={onCast}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /仪式施法/ }));
    });

    expect(screen.getByRole("button", { name: /确认施放/ })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /确认施放/ }));
    });

    expect(onCast).toHaveBeenCalledWith(
      expect.objectContaining({
        ritualCast: true,
        confirmBreakConcentration: true,
      }),
    );
  });

  // Chrome QA revision 2026-05-28: clicking 选择目的地并施放 on Misty Step
  // closed the modal but never entered the destination picker because
  // SpellCastData wasn't carrying `targetingMode`. Parent castSpellAction
  // then fell into the default `self` self-buff branch. Lock the payload
  // contract: SpellCastActions MUST stamp ui.targetingMode on every cast.
  it("includes ui.targetingMode in the SpellCastData payload (Misty Step)", () => {
    const onCast = vi.fn();
    render(
      <SpellCastActions
        spell={{
          id: "misty_step",
          name: "迷踪步",
          level: 2,
          range: "自身",
          castingTime: "1 附赠动作",
          components: ["V"],
          effects: [
            {
              trigger: "on_cast",
              target: { type: "self" },
              effects: [
                { type: "narrative", description: "..." },
                { type: "teleport", range: 30, mode: "self", mustSee: true },
              ],
            },
          ],
        } as any}
        selectedCastLevel={2}
        onSelectCastLevel={vi.fn()}
        spellSlots={[0, 4, 3]}
        remainingSlots={[0, 4, 2]}
        onCast={onCast}
      />,
    );

    // Cast button label is the middleware-derived prompt.
    const button = screen.getByRole("button", { name: /选择目的地并施放/ });
    expect(button).not.toBeDisabled();

    act(() => {
      fireEvent.click(button);
    });

    expect(onCast).toHaveBeenCalledTimes(1);
    expect(onCast).toHaveBeenCalledWith(
      expect.objectContaining({
        targetingMode: "teleport_destination",
        level: 2,
      }),
    );
  });
});
