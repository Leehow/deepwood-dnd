import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getI18n, setLocale } from "~/i18n";
import { StatusEffectsDialog } from "~/components/character/StatusEffectsDialog";

// Drive real i18next so useTranslation('common') / useCurrentLocale resolve to
// the actual translations.
getI18n();

describe("StatusEffectsDialog (zh-CN)", () => {
  beforeEach(async () => {
    await setLocale("zh-CN");
  });

  it("renders runtime spell summaries for incoming spell buffs", () => {
    render(
      <StatusEffectsDialog
        open={true}
        onOpenChange={vi.fn()}
        embedded={true}
        incomingSpellBuffs={[
          {
            id: "spell_buff_hex",
            name: "脆弱诅咒",
            icon: "💫",
            color: "#f472b6",
            from_caster: "艾尔文·黑焰",
            spell_id: "hex",
            duration_rounds: 600,
          },
        ]}
        runtimeSpellOverlays={[
          {
            spell_id: "hex",
            role: "target",
            selected_option: "dexterity",
            selected_option_label: "敏捷",
          },
        ]}
      />,
    );

    expect(screen.getByText("脆弱诅咒（敏捷）")).toBeInTheDocument();
    expect(screen.getByText("施法者命中时：额外受到 1d6 黯蚀伤害")).toBeInTheDocument();
    expect(screen.getByText("劣势: 敏捷属性检定")).toBeInTheDocument();
  });

  it("renders spell-applied token conditions in the status panel", () => {
    render(
      <StatusEffectsDialog
        open={true}
        onOpenChange={vi.fn()}
        embedded={true}
        currentWorldTime={{ day: 124, hour: 7, minute: 0, second: 0, cycle: "day", realTimeActive: false, environment: "normal" }}
        tokenActiveEffects={[
          {
            id: "web_restrained",
            name: "束缚",
            icon: "🕸️",
            color: "#22c55e",
            source: "蛛网术",
            spell_id: "web",
            condition: "restrained",
            is_concentration: true,
            source_token_id: 491,
            from_caster: "艾莉薇特·宁叶",
            duration: 600,
            expires_at: { day: 124, hour: 8, minute: 0, second: 0 },
            escape_action: { type: "check", ability: "str", dc: 14 },
            escapeHint: "可使用动作进行力量检定对抗法术DC尝试挣脱",
          },
        ]}
      />,
    );

    expect(screen.getByText("当前状态")).toBeInTheDocument();
    expect(screen.getAllByText("束缚").length).toBeGreaterThan(0);
    expect(screen.getByText(/蛛网术/)).toBeInTheDocument();
    expect(screen.getByText(/专注维持/)).toBeInTheDocument();
    expect(screen.getByText(/剩余 1小时/)).toBeInTheDocument();
    expect(screen.getByText("可使用动作进行力量检定对抗法术DC尝试挣脱")).toBeInTheDocument();
  });
});
