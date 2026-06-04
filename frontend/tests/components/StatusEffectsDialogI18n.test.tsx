/**
 * Locale-aware display behavior for the character status/effects dialog.
 *
 * Verifies that StatusEffectsDialog reads the current frontend locale and
 * routes its localized chrome + spell helper calls through it.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getI18n, setLocale } from "~/i18n";
import { StatusEffectsDialog } from "~/components/character/StatusEffectsDialog";

getI18n();

describe("StatusEffectsDialog — en-US chrome", () => {
  beforeEach(async () => {
    await setLocale("en-US");
  });

  it("renders concentration section with English labels", () => {
    render(
      <StatusEffectsDialog
        open={true}
        onOpenChange={vi.fn()}
        embedded={true}
        isDM
        concentrationSpell={{
          spell_id: "hex",
          spell_name: "Hex",
          slot_level: 1,
          duration_rounds: 600,
          current_round: 0,
        }}
        onConcentrationBreak={vi.fn()}
      />,
    );

    expect(screen.getByText("Concentration")).toBeInTheDocument();
    expect(screen.getByTitle("What is concentration?")).toBeInTheDocument();
    expect(screen.getByTitle("Break concentration")).toBeInTheDocument();
    expect(screen.getByTitle("View spell details")).toBeInTheDocument();
    // DM toolbar uses English labels when the dialog has active content.
    expect(screen.getByText("Short Rest (1h)")).toBeInTheDocument();
    expect(screen.getByText("Long Rest (8h)")).toBeInTheDocument();
  });

  it("renders English buff title and locale-aware spell summary labels", () => {
    render(
      <StatusEffectsDialog
        open={true}
        onOpenChange={vi.fn()}
        embedded={true}
        incomingSpellBuffs={[
          {
            id: "spell_buff_hex",
            name: "Hex",
            icon: "💫",
            color: "#f472b6",
            from_caster: "Elwin",
            spell_id: "hex",
            duration_rounds: 600,
          },
        ]}
        runtimeSpellOverlays={[
          {
            spell_id: "hex",
            role: "target",
            selected_option: "dexterity",
            selected_option_label: "Dexterity",
          },
        ]}
      />,
    );

    // ASCII parentheses for en-US, user-provided name kept
    expect(screen.getByText("Hex (Dexterity)")).toBeInTheDocument();
    // From-caster label is localized; caster name stays as-is
    expect(screen.getByText("From Elwin")).toBeInTheDocument();
    // Section heading is English
    expect(screen.getByText("Incoming Spell Buffs")).toBeInTheDocument();
    // Spell-summary helper now resolves with locale=en-US
    expect(
      screen.getByText("When caster hits: take 1d6 extra Necrotic damage"),
    ).toBeInTheDocument();
    expect(screen.getByText("Disadvantage: Dexterity Check")).toBeInTheDocument();
  });

  it("renders English condition labels, removal badges, and remaining time", () => {
    render(
      <StatusEffectsDialog
        open={true}
        onOpenChange={vi.fn()}
        embedded={true}
        currentWorldTime={{ day: 124, hour: 7, minute: 0, second: 0, cycle: "day", realTimeActive: false, environment: "normal" }}
        tokenActiveEffects={[
          {
            id: "web_restrained",
            name: "Restrained",
            icon: "🕸️",
            color: "#22c55e",
            source: "Web",
            spell_id: "web",
            condition: "restrained",
            is_concentration: true,
            source_token_id: 491,
            from_caster: "Aliviet",
            duration: 600,
            expires_at: { day: 124, hour: 8, minute: 0, second: 0 },
          },
        ]}
      />,
    );

    expect(screen.getByText("Active Conditions")).toBeInTheDocument();
    expect(screen.getAllByText("Restrained").length).toBeGreaterThan(0);
    expect(screen.getByText("Speed 0, attacks disadvantage")).toBeInTheDocument();
    expect(screen.getByText(/Concentration/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining 1 h/)).toBeInTheDocument();
    // Quick reference grid heading is localized
    expect(screen.getByText("Quick Reference")).toBeInTheDocument();
  });

  it("renders empty-state copy in English when nothing is active", () => {
    render(<StatusEffectsDialog open={true} onOpenChange={vi.fn()} embedded={true} />);
    expect(screen.getByText("No active status effects")).toBeInTheDocument();
  });

  it("joins custom aura applied-conditions with the en-US list separator", () => {
    render(
      <StatusEffectsDialog
        open={true}
        onOpenChange={vi.fn()}
        embedded={true}
        customEffects={[
          {
            id: "custom_aura_1",
            name: "Dread Aura",
            modifiers: [],
            duration: { type: "permanent", value: 0, remaining: 0 },
            aura: {
              enabled: true,
              radius: 10,
              affects_enemies: true,
              applies_conditions: ["blinded", "restrained"],
            },
          },
        ]}
      />,
    );

    const applies = screen.getByText(/^Applies:/);
    expect(applies).toHaveTextContent("Applies: Blinded, Restrained");
    expect(applies.textContent ?? "").not.toContain("、");
  });
});

describe("StatusEffectsDialog — zh-CN preserves Chinese chrome", () => {
  beforeEach(async () => {
    await setLocale("zh-CN");
  });

  it("falls back to the existing Chinese title in zh-CN", () => {
    render(<StatusEffectsDialog open={true} onOpenChange={vi.fn()} embedded={true} />);
    expect(screen.getByText("无活跃状态效果")).toBeInTheDocument();
  });
});
