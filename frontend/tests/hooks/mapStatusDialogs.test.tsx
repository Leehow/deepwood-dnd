import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MapStatusDialogs } from "~/components/map/MapStatusDialogs";

describe("MapStatusDialogs", () => {
  it("renders concentration info and closes it", () => {
    const setShowConcentrationRulesInfo = vi.fn();

    render(
      <MapStatusDialogs
        showConcentrationRulesInfo={true}
        ritualCastingInfo={null}
        statusEffectDetail={null}
        statusEffectRemoveConfirm={null}
        castingCancelConfirm={null}
        castingCompleteConfirm={null}
        concBreakConfirm={null}
        concDurationEdit={null}
        concDurationInput=""
        setShowConcentrationRulesInfo={setShowConcentrationRulesInfo}
        setRitualCastingInfo={vi.fn()}
        setStatusEffectDetail={vi.fn()}
        setStatusEffectRemoveConfirm={vi.fn()}
        setCastingCancelConfirm={vi.fn()}
        setCastingCompleteConfirm={vi.fn()}
        setConcBreakConfirm={vi.fn()}
        setConcDurationEdit={vi.fn()}
        setConcDurationInput={vi.fn()}
        onConfirmStatusEffectRemove={vi.fn()}
        onConfirmCastingCancel={vi.fn()}
        onConfirmCastingComplete={vi.fn()}
        onConfirmConcentrationBreak={vi.fn()}
        onConfirmConcentrationDurationEdit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(setShowConcentrationRulesInfo).toHaveBeenCalledWith(false);
  });

  it("invokes status-effect removal confirmation", () => {
    const onConfirmStatusEffectRemove = vi.fn();

    render(
      <MapStatusDialogs
        showConcentrationRulesInfo={false}
        ritualCastingInfo={null}
        statusEffectDetail={null}
        statusEffectRemoveConfirm={{
          tokenId: 1,
          effectId: "slow",
          tokenName: "Hero",
          effectName: "Slow",
        }}
        castingCancelConfirm={null}
        castingCompleteConfirm={null}
        concBreakConfirm={null}
        concDurationEdit={null}
        concDurationInput=""
        setShowConcentrationRulesInfo={vi.fn()}
        setRitualCastingInfo={vi.fn()}
        setStatusEffectDetail={vi.fn()}
        setStatusEffectRemoveConfirm={vi.fn()}
        setCastingCancelConfirm={vi.fn()}
        setCastingCompleteConfirm={vi.fn()}
        setConcBreakConfirm={vi.fn()}
        setConcDurationEdit={vi.fn()}
        setConcDurationInput={vi.fn()}
        onConfirmStatusEffectRemove={onConfirmStatusEffectRemove}
        onConfirmCastingCancel={vi.fn()}
        onConfirmCastingComplete={vi.fn()}
        onConfirmConcentrationBreak={vi.fn()}
        onConfirmConcentrationDurationEdit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    expect(onConfirmStatusEffectRemove).toHaveBeenCalledTimes(1);
  });
});
