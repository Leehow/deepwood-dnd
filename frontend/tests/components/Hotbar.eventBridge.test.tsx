import { render } from "../test-utils";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Hotbar } from "~/components/hotbar/Hotbar";
import { publishAppEvent } from "~/events/appEventBus";

const setSlotMock = vi.fn();

vi.mock("~/components/hotbar/useHotbar", () => ({
  useHotbar: () => ({
    slots: Array.from({ length: 12 }, (_, index) => (index === 0 ? { type: "weapon", id: "main", name: "主手", icon: "⚔" } : null)),
    slotCount: 12,
    setSlot: (...args: any[]) => setSlotMock(...args),
    clearSlot: vi.fn(),
  }),
}));

vi.mock("~/utils/characterResourcesCache", () => ({
  fetchCharacterResourcesCached: vi.fn(() => new Promise(() => {})),
}));

describe("Hotbar typed event bridge", () => {
  beforeEach(() => {
    setSlotMock.mockReset();
  });

  it("fills the first empty slot from hotbarAddItem events", () => {
    render(
      <Hotbar
        character={{ id: 7, hotbar: [], equipment: [], feats: [] } as any}
        rightSidebarWidth={320}
        showRightSidebar={false}
        showLeftSidebar={false}
      />,
    );

    const item = {
      type: "item",
      id: "rope",
      name: "麻绳",
      icon: "◆",
      meta: { quantity: 1 },
    };
    act(() => {
      publishAppEvent("hotbarAddItem", item);
    });

    expect(setSlotMock).toHaveBeenCalledWith(1, item);
  });

  it("drops items into a specific slot from hotbarDropToSlot events", () => {
    render(
      <Hotbar
        character={{ id: 7, hotbar: [], equipment: [], feats: [] } as any}
        rightSidebarWidth={320}
        showRightSidebar={false}
        showLeftSidebar={false}
      />,
    );

    const detail = {
      slotIdx: 4,
      item: {
        type: "item",
        id: "torch",
        name: "火把",
        icon: "◆",
        meta: { quantity: 2 },
      },
    };
    act(() => {
      publishAppEvent("hotbarDropToSlot", detail);
    });

    expect(setSlotMock).toHaveBeenCalledWith(4, detail.item);
  });
});
